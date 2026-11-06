// Build every manifest workflow with sample parameters and ask a ComfyUI server
// to validate it (POST /prompt). On a server without the model weights the only
// acceptable errors are "value_not_in_list" on loader/file fields; anything else
// (missing required input, unknown node, bad type) means the binding is wrong.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrompt } from '../gateway/providers/comfy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WF = path.join(ROOT, 'comfy', 'workflows');
const COMFY = process.env.COMFY_LOCAL || 'http://127.0.0.1:8188';
const manifest = JSON.parse(fs.readFileSync(path.join(WF, 'manifest.json'), 'utf8'));
const only = process.argv.slice(2);
const FILE_FIELDS = new Set(['unet_name', 'clip_name', 'vae_name', 'lora_name', 'ckpt_name', 'model_name', 'audio_encoder_name', 'name', 'text_encoder', 'image', 'audio', 'file', 'video', 'model']);

let bad = 0;
for (const [alias, spec] of Object.entries(manifest)) {
  if (only.length && !only.includes(alias)) continue;
  const api = JSON.parse(fs.readFileSync(path.join(WF, spec.file), 'utf8'));
  const uploaded = { image: 'sample.png', image2: 'sample2.png', last_image: 'last.png', audio: 'voice.mp3', video: 'clip.mp4' };
  const params = { prompt: 'a test prompt', negative: 'blurry', aspect_ratio: '16:9', duration: 5, seed: 1 };
  let prompt;
  try { prompt = buildPrompt(spec, api, params, uploaded); } catch (e) { console.log(`✖ ${alias}: build failed: ${e.message}`); bad++; continue; }
  // Dangling links?
  const ids = new Set(Object.keys(prompt));
  const dangling = [];
  for (const [id, n] of Object.entries(prompt)) for (const [k, v] of Object.entries(n.inputs)) if (Array.isArray(v) && typeof v[0] === 'string' && !ids.has(v[0])) dangling.push(`${id}.${k}->${v[0]}`);
  const res = await fetch(`${COMFY}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, client_id: 'validate' }) });
  const data = await res.json();
  const issues = [];
  for (const [nid, ne] of Object.entries(data.node_errors || {})) {
    for (const err of ne.errors || []) {
      const field = err.extra_info?.input_name;
      if (err.type === 'value_not_in_list' && FILE_FIELDS.has(field)) continue; // expected: no weights/inputs on the validator box
      if (err.type === 'value_not_in_list' && ['device', 'offload_device'].includes(field)) continue; // cuda vs mps on the validator box
      issues.push(`${nid}(${ne.class_type}).${field || ''}: ${err.type} ${err.message} ${err.details || ''}`.slice(0, 200));
    }
  }
  if (data.error && !data.node_errors) issues.push(`${data.error.type}: ${data.error.message}`);
  if (res.status === 200 && data.prompt_id) {
    // It got queued (would only happen if models exist); cancel so the CPU box does not try to run it.
    await fetch(`${COMFY}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [data.prompt_id] }) }).catch(() => {});
  }
  const ok = issues.length === 0 && dangling.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? '✔' : '✖'} ${alias.padEnd(20)} nodes=${Object.keys(prompt).length} ${dangling.length ? 'DANGLING ' + dangling.join(',') : ''}`);
  for (const i of issues) console.log(`     ${i}`);
}
process.exit(bad ? 1 : 0);
