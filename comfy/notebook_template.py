# %% 1. Settings
# ── freegen ComfyUI backend ───────────────────────────────────────────────────
# PROFILE decides which models are downloaded (disk and VRAM are the limits):
#   "image"      flux2_klein_t2i, flux2_klein_edit, qwen21_t2i, qwen21_edit, qwen21_bgremove   (~25 GB, fits a 15 GB T4)
#   "image-fast" flux2_klein_t2i, flux2_klein_edit                                              (~10 GB)
#   "video-5b"   image-fast + wan22_5b_t2v/i2v                                                   (~22 GB, fits a T4)
#   "video-14b"  wan22_14b_t2v, wan22_14b_i2v, wan22_14b_flf2v                                    (needs 24 GB VRAM: L4/A10G)
#   "ltx"        ltx25_t2v, ltx25_i2v, ltx25_flf2v                                                (needs 40 GB VRAM: A100)
#   "ltx2-distilled" ltx2_t2v_distilled, ltx2_i2v_distilled                                       (needs 24 GB VRAM)
#   "lipsync"    infinitetalk_i2v                                                                 (needs 24 GB VRAM)
#   "upscale"    seedvr2_image, seedvr2_video                                                     (custom node, weights auto-download)
#   "s2v"        wan22_s2v                                                                        (needs 24 GB VRAM)
# Or set WORKFLOWS to an explicit list of aliases.
PROFILE = "image"
WORKFLOWS = []            # e.g. ["flux2_klein_t2i", "wan22_5b_i2v"]; overrides PROFILE when non-empty
TOKEN = ""                # leave empty to auto-generate; paste it into `freegen set-backend <url> <token>`
IDLE_MINUTES = 0          # >0: stop the notebook after this many minutes with nothing queued (saves the weekly GPU quota)
HANDOFF_TOPIC = ""        # optional: an unguessable ntfy.sh topic; the set-backend line is posted there so the Mac can attach itself
COMFY_ARGS = "--lowvram"  # try "--normalvram" on 24 GB+ cards; "--cpu-vae" if VAE decode OOMs
HF_TOKEN = ""             # only needed for gated repos (Qwen-Image-2.1 and LTX-2.5 are gated: accept the license on Hugging Face)

PROFILES = {
    "image": ["flux2_klein_t2i", "flux2_klein_edit", "qwen21_t2i", "qwen21_edit", "qwen21_bgremove"],
    "image-fast": ["flux2_klein_t2i", "flux2_klein_edit"],
    "video-5b": ["flux2_klein_t2i", "flux2_klein_edit", "wan22_5b_t2v", "wan22_5b_i2v"],
    "video-14b": ["wan22_14b_t2v", "wan22_14b_i2v", "wan22_14b_flf2v"],
    "ltx": ["ltx25_t2v", "ltx25_i2v", "ltx25_flf2v"],
    "ltx2-distilled": ["ltx2_t2v_distilled", "ltx2_i2v_distilled"],
    "lipsync": ["infinitetalk_i2v"],
    "upscale": ["seedvr2_image", "seedvr2_video"],
    "s2v": ["wan22_s2v"],
}
import os, secrets
WORKFLOWS = WORKFLOWS or PROFILES[PROFILE]
TOKEN = TOKEN or secrets.token_urlsafe(24)
WORK = "/kaggle/tmp" if os.path.isdir("/kaggle") else ("/content" if os.path.isdir("/content") else os.path.expanduser("~/freegen-backend"))
os.makedirs(WORK, exist_ok=True)
os.environ["HF_HOME"] = f"{WORK}/hf"  # keep weights under the work dir (set before huggingface_hub is imported)
print("workflows:", WORKFLOWS); print("work dir:", WORK)

# %% 2. Install ComfyUI
import subprocess, sys, json
COMFY = f"{WORK}/ComfyUI"
if not os.path.isdir(COMFY):
    subprocess.run(["git", "clone", "--depth", "1", "https://github.com/comfyanonymous/ComfyUI.git", COMFY], check=True)
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", f"{COMFY}/requirements.txt"], check=True)
subprocess.run([sys.executable, "-m", "pip", "install", "-q", "huggingface_hub[hf_transfer]", "aiohttp"], check=True)
import torch; print("torch", torch.__version__, "cuda", torch.cuda.is_available(), torch.cuda.get_device_name(0) if torch.cuda.is_available() else "")

# %% 3. Download only the models these workflows need
MODELS = json.loads(__MODELS_JSON__)
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"
if HF_TOKEN: os.environ["HF_TOKEN"] = HF_TOKEN
from huggingface_hub import hf_hub_download
import re, shutil
def download(entry):
    dest_dir = f"{COMFY}/models/{entry['directory']}"; os.makedirs(dest_dir, exist_ok=True)
    dest = f"{dest_dir}/{entry['name']}"
    if os.path.exists(dest): return "cached"
    if os.path.lexists(dest): os.unlink(dest)  # dangling link from an earlier run
    m = re.match(r"https://huggingface\.co/([^/]+/[^/]+)/resolve/([^/]+)/(.+)$", entry["url"])
    if m:
        repo, rev, fn = m.groups()
        got = hf_hub_download(repo_id=repo, filename=fn, revision=rev, token=HF_TOKEN or None)
        os.symlink(os.path.abspath(got), dest)
    else:
        subprocess.run(["wget", "-q", "-O", dest, entry["url"]], check=True)
    return "downloaded"
custom_nodes = set()
seen = set()
for alias in WORKFLOWS:
    spec = MODELS[alias]
    for cn in spec.get("customNodes", []): custom_nodes.add(cn)
    for entry in spec["models"]:
        key = f"{entry['directory']}/{entry['name']}"
        if key in seen: continue
        seen.add(key); print(f"{key:70s}", download(entry), flush=True)
for repo in custom_nodes:
    name = repo.rstrip("/").split("/")[-1]; d = f"{COMFY}/custom_nodes/{name}"
    if not os.path.isdir(d): subprocess.run(["git", "clone", "--depth", "1", repo, d], check=True)
    req = f"{d}/requirements.txt"
    if os.path.exists(req): subprocess.run([sys.executable, "-m", "pip", "install", "-q", "-r", req], check=True)
    print("custom node:", name)
print("disk:", shutil.disk_usage(WORK).free // 2**30, "GB free")

# %% 4. Start ComfyUI + token proxy + Cloudflare tunnel
import time, threading, urllib.request, platform
open(f"{WORK}/proxy.py", "w").write(__PROXY_PY__)
log = open(f"{WORK}/comfy.log", "w")
comfy = subprocess.Popen([sys.executable, "main.py", "--listen", "127.0.0.1", "--port", "8188", "--disable-auto-launch", *COMFY_ARGS.split()], cwd=COMFY, stdout=log, stderr=subprocess.STDOUT)
for _ in range(180):
    try:
        urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=2); break
    except Exception: time.sleep(2)
else:
    raise SystemExit("ComfyUI did not start; see comfy.log")
print("ComfyUI up")
proxy = subprocess.Popen([sys.executable, f"{WORK}/proxy.py", "--upstream", "http://127.0.0.1:8188", "--port", "8189", "--token", TOKEN])
arch = "arm64" if platform.machine() in ("aarch64", "arm64") else "amd64"
cf = f"{WORK}/cloudflared"
if not os.path.exists(cf):
    urllib.request.urlretrieve(f"https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-{arch}", cf); os.chmod(cf, 0o755)
tunnel = subprocess.Popen([cf, "tunnel", "--url", "http://127.0.0.1:8189", "--no-autoupdate"], stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
url = None
tail = []
deadline = time.time() + 90
while time.time() < deadline and url is None:
    line = tunnel.stdout.readline()
    if not line:
        if tunnel.poll() is not None: break
        time.sleep(0.2); continue
    tail.append(line.strip())
    m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
    if m: url = m.group(0)
if not url:
    raise SystemExit("cloudflared did not return a tunnel URL. Last log lines:\n" + "\n".join(tail[-15:]))
threading.Thread(target=lambda: [None for _ in tunnel.stdout], daemon=True).start()
open(f"{WORK}/FREEGEN_URL.txt", "w").write(f"{url}\n{TOKEN}\n")
print("\n" + "=" * 70)
print("BACKEND READY. On your Mac run:")
print(f"  freegen set-backend {url} {TOKEN}")
print("=" * 70 + "\n")
if HANDOFF_TOPIC:
    try:
        urllib.request.urlopen(urllib.request.Request(f"https://ntfy.sh/{HANDOFF_TOPIC}", data=f"freegen set-backend {url} {TOKEN}".encode(), method="POST"), timeout=20)
        print("hand-off posted")
    except Exception as e:
        print("hand-off failed:", e)

# %% 5. Keep alive (leave this cell running). Shows queue + GPU memory every minute.
import datetime
idle, worked = 0, False
while True:
    try:
        st = json.load(urllib.request.urlopen("http://127.0.0.1:8188/system_stats", timeout=5))
        q = json.load(urllib.request.urlopen("http://127.0.0.1:8188/queue", timeout=5))
        dev = st["devices"][0]
        print(f"{datetime.datetime.now():%H:%M} running={len(q['queue_running'])} pending={len(q['queue_pending'])} vram_free={dev['vram_free']//2**20} MB  url={url}", flush=True)
        busy = bool(q["queue_running"] or q["queue_pending"])
        worked, idle = worked or busy, 0 if busy else idle + 1
        if IDLE_MINUTES and idle >= IDLE_MINUTES and (worked or idle >= 3 * IDLE_MINUTES):
            print(f"idle {idle} min: stopping to save GPU quota", flush=True); comfy.terminate(); break
    except Exception as e:
        print("status error:", e, flush=True)
    if comfy.poll() is not None:
        print("ComfyUI exited; last log lines:"); print(open(f"{WORK}/comfy.log").read()[-3000:]); break
    time.sleep(60)
