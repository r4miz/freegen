#!/bin/bash
# Push the freegen ComfyUI notebook to Kaggle as a private GPU kernel, wait for
# it to post its tunnel address, and attach the local gateway to it.
#
#   scripts/kaggle-launch.sh [profile]      # default profile: video-5b
#
# Needs a Kaggle login: ~/.kaggle/access_token (Settings > API > Create New Token) or kaggle.json.
# The notebook posts "freegen set-backend <url> <token>" to a random ntfy.sh
# topic that only this machine knows; we poll it, then run that line.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${1:-video-5b}"
KAGGLE="$ROOT/.local/ComfyUI/.venv/bin/kaggle"
[ -x "$KAGGLE" ] || KAGGLE=kaggle
USER_NAME=$("$KAGGLE" config view 2>/dev/null | awk -F": " '/username/ {print $2}' | tr -d " ")
[ -n "$USER_NAME" ] || { echo "kaggle is not authenticated (need ~/.kaggle/access_token or kaggle.json)"; exit 1; }
TOPIC="freegen-$(python3 -c 'import secrets;print(secrets.token_hex(16))')"
DIR="$ROOT/data/kaggle-kernel"; mkdir -p "$DIR"
echo "$TOPIC" > "$ROOT/data/handoff-topic"

# Notebook copy with the profile and hand-off topic filled in.
python3 - "$ROOT" "$DIR" "$PROFILE" "$TOPIC" <<'EOF'
import json, sys, os
root, out, profile, topic = sys.argv[1:5]
nb = json.load(open(f"{root}/comfy/notebooks/freegen_comfyui.ipynb"))
for c in nb["cells"]:
    src = "".join(c["source"])
    src = src.replace("IDLE_MINUTES = 0", f"IDLE_MINUTES = {os.environ.get('FREEGEN_IDLE_MINUTES', '0')}").replace('PROFILE = "image"', f'PROFILE = "{profile}"').replace('HANDOFF_TOPIC = ""', f'HANDOFF_TOPIC = "{topic}"')
    c["source"] = src.splitlines(keepends=True)
json.dump(nb, open(f"{out}/freegen-comfyui.ipynb", "w"))
EOF
cat > "$DIR/kernel-metadata.json" <<EOF
{
  "id": "$USER_NAME/freegen-comfyui",
  "title": "freegen-comfyui",
  "code_file": "freegen-comfyui.ipynb",
  "language": "python",
  "kernel_type": "notebook",
  "is_private": true,
  "enable_gpu": true,
  "enable_tpu": false,
  "enable_internet": true,
  "dataset_sources": [],
  "competition_sources": [],
  "kernel_sources": [],
  "model_sources": []
}
EOF
echo "pushing kernel $USER_NAME/freegen-comfyui (profile $PROFILE)"
"$KAGGLE" kernels push -p "$DIR"
echo "waiting for the notebook to hand off its tunnel (topic $TOPIC) ..."
for i in $(seq 1 180); do
  sleep 30
  LINE=$(curl -s -m 15 "https://ntfy.sh/$TOPIC/json?poll=1" | python3 -c "import json,sys
for l in sys.stdin:
    try: d=json.loads(l)
    except Exception: continue
    if d.get('event')=='message' and 'set-backend' in d.get('message',''): print(d['message'])" | tail -1)
  if [ -n "$LINE" ]; then
    echo "got: ${LINE%% *} ..."
    URL=$(echo "$LINE" | awk '{print $3}'); TOK=$(echo "$LINE" | awk '{print $4}')
    node "$ROOT/gateway/cli.js" set-backend "$URL" "$TOK"
    node "$ROOT/gateway/cli.js" status >/dev/null
    echo "ATTACHED $URL"
    exit 0
  fi
  if [ $((i % 10)) -eq 0 ]; then "$KAGGLE" kernels status "$USER_NAME/freegen-comfyui" || true; fi
done
echo "timed out waiting for the hand-off"; exit 2
