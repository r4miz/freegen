"""freegen ComfyUI backend on Modal (serverless GPUs, ~$30/month free credits).

Use this for the workflows that do not fit a free 15 GB T4: Wan 2.2 14B,
LTX-2.5, InfiniteTalk. Models are downloaded once into a persistent Volume.

    pip install modal && modal setup
    modal secret create huggingface HF_TOKEN=hf_...      # gated repos (Qwen-Image-2.1, LTX-2.5)
    modal run  comfy/modal_comfyui.py::download --profile video-14b
    modal deploy comfy/modal_comfyui.py
    # prints https://<you>--freegen-comfyui-serve.modal.run ; then on the Mac:
    freegen set-backend https://<...>.modal.run <token from `modal secret`>

GPU choice (env FREEGEN_GPU before deploy): L4 (24 GB, cheapest for 14B/distilled),
A10G (24 GB), A100-40GB (needed for LTX-2.5 22B int8 + Gemma 12B), A100-80GB.
Token: `modal secret create freegen-token FREEGEN_TOKEN=<random>`.

This file is written against the Modal 1.x API (modal.App, modal.Image.debian_slim,
modal.Volume, @modal.web_server). It has not been executed from the authoring
machine (no Modal account there), so expect to adjust small details on first run.
"""
import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

import modal

GPU = os.environ.get("FREEGEN_GPU", "L4")
HERE = Path(__file__).parent
# Inside the container only this .py is mounted, so the sidecar files are added to the image
# explicitly (see image below) and read lazily from /root/freegen.
SIDE = Path("/root/freegen")


def _side(name: str) -> Path:
    local = HERE / name
    return local if local.exists() else SIDE / name

PROFILES = {
    "image": ["flux2_klein_t2i", "flux2_klein_edit", "qwen21_t2i", "qwen21_edit", "qwen21_bgremove"],
    "video-5b": ["flux2_klein_t2i", "flux2_klein_edit", "wan22_5b_t2v", "wan22_5b_i2v"],
    "video-14b": ["wan22_14b_t2v", "wan22_14b_i2v", "wan22_14b_flf2v"],
    "ltx": ["ltx25_t2v", "ltx25_i2v", "ltx25_flf2v"],
    "ltx2-distilled": ["ltx2_t2v_distilled", "ltx2_i2v_distilled"],
    "lipsync": ["infinitetalk_i2v"],
    "s2v": ["wan22_s2v"],
    "upscale": ["seedvr2_image", "seedvr2_video"],
}

app = modal.App("freegen-comfyui")
vol = modal.Volume.from_name("freegen-models", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "wget", "ffmpeg", "libgl1", "libglib2.0-0")
    .run_commands(
        "git clone --depth 1 https://github.com/comfyanonymous/ComfyUI.git /root/ComfyUI",
        "pip install -r /root/ComfyUI/requirements.txt",
        "pip install huggingface_hub[hf_transfer]",
        "git clone --depth 1 https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler /root/ComfyUI/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler",
        "pip install -r /root/ComfyUI/custom_nodes/ComfyUI-SeedVR2_VideoUpscaler/requirements.txt || true",
        "rm -rf /root/ComfyUI/models && ln -s /models /root/ComfyUI/models",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
    .add_local_file(HERE / "models.json", "/root/freegen/models.json")
    .add_local_file(HERE / "proxy.py", "/root/freegen/proxy.py")
)


# `modal secret create huggingface HF_TOKEN=hf_...` once (needed for the gated Qwen-Image-2.1 / LTX-2.5 repos).
@app.function(image=image, volumes={"/models": vol}, timeout=3 * 60 * 60, secrets=[modal.Secret.from_name("huggingface")])
def download(profile: str = "video-14b", workflows: str = ""):
    """Download the model files for a profile into the shared Volume (resumable, commits per file)."""
    import re
    import shutil
    from huggingface_hub import hf_hub_download

    models = json.loads(_side("models.json").read_text())
    aliases = [w for w in workflows.split(",") if w] or PROFILES[profile]
    seen = set()
    for alias in aliases:
        for entry in models[alias]["models"]:
            key = f"{entry['directory']}/{entry['name']}"
            if key in seen:
                continue
            seen.add(key)
            dest = Path("/models") / entry["directory"] / entry["name"]
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                print("cached", key)
                continue
            m = re.match(r"https://huggingface\.co/([^/]+/[^/]+)/resolve/([^/]+)/(.+)$", entry["url"])
            if m:
                repo, rev, fn = m.groups()
                # local_dir gives a real file (not a cache symlink); the Volume is a different filesystem,
                # so copy with shutil rather than rename, then free the scratch copy.
                got = hf_hub_download(repo_id=repo, filename=fn, revision=rev, token=os.environ.get("HF_TOKEN"), local_dir="/tmp/hf")
                shutil.move(os.path.realpath(got), dest)
                shutil.rmtree("/tmp/hf", ignore_errors=True)
            else:
                subprocess.run(["wget", "-q", "-O", str(dest), entry["url"]], check=True)
            vol.commit()
            print("downloaded", key)


@app.function(
    image=image,
    gpu=GPU,
    volumes={"/models": vol},
    secrets=[modal.Secret.from_name("freegen-token")],
    timeout=60 * 60,
    scaledown_window=300,
    max_containers=1,
)
@modal.concurrent(max_inputs=10)
@modal.web_server(8000, startup_timeout=600)
def serve():
    """ComfyUI behind the freegen token proxy, exposed as a Modal web endpoint."""
    token = os.environ.get("FREEGEN_TOKEN", "")
    Path("/root/proxy.py").write_text(_side("proxy.py").read_text())
    subprocess.Popen(
        ["python", "main.py", "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch", "--normalvram"],
        cwd="/root/ComfyUI",
    )
    for _ in range(300):
        try:
            urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2)
            break
        except Exception:
            time.sleep(2)
    subprocess.Popen(["python", "/root/proxy.py", "--upstream", "http://127.0.0.1:8188", "--port", "8000", "--token", token])
