// Build comfy/models.json: for each workflow alias, the exact model files
// (directory, filename, download url) that the official template declares.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEMPLATES } from './template-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UI = path.join(ROOT, 'comfy', 'templates-ui');
const out = {};
for (const [alias, tpl] of Object.entries(TEMPLATES)) {
  const d = JSON.parse(fs.readFileSync(path.join(UI, `${tpl}.json`), 'utf8'));
  const nodes = [...(d.nodes || [])];
  for (const sg of d.definitions?.subgraphs || []) nodes.push(...(sg.nodes || []));
  const models = new Map();
  for (const n of nodes) for (const m of n.properties?.models || []) models.set(`${m.directory}/${m.name}`, { directory: m.directory, name: m.name, url: m.url });
  out[alias] = { template: tpl, models: [...models.values()] };
}
// Files a template lists but freegen's bound variant never loads (prompt enhancers, base model when the distilled one is used).
const EXCLUDE = {
  flux2_klein_t2i: ['flux-2-klein-base-4b.safetensors'],
  qwen21_t2i: ['qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors'],
  qwen21_edit: ['qwen3.5_9b_qwen_image_2.1_pe_i2i.int8_convrot.safetensors'],
  ltx25_t2v: ['gemma4_e2b_it_int8_convrot.safetensors'],
  ltx25_i2v: ['gemma4_e2b_it_int8_convrot.safetensors'],
  ltx25_flf2v: ['gemma4_e2b_it_int8_convrot.safetensors'],
  infinitetalk_i2v: [],
  ltx2_t2v_distilled: ['ltx-2-19b-lora-camera-control-dolly-left.safetensors'],
  ltx2_i2v_distilled: ['ltx-2-19b-lora-camera-control-dolly-left.safetensors'],
};
for (const [alias, names] of Object.entries(EXCLUDE)) out[alias].models = out[alias].models.filter(m => !names.includes(m.name));
// Variants that share a template.
out.wan22_5b_t2v = { ...out.wan22_5b_ti2v, variantOf: 'wan22_5b_ti2v' };
out.wan22_5b_i2v = { ...out.wan22_5b_ti2v, variantOf: 'wan22_5b_ti2v' };
// SeedVR2 nodes download their own weights; they need the custom node pack instead.
for (const a of ['seedvr2_image', 'seedvr2_video']) {
  out[a].customNodes = ['https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler'];
  // The node auto-downloads these on first use; listing them lets backends pre-fetch into persistent storage.
  out[a].models = [
    { directory: 'SEEDVR2', name: 'seedvr2_ema_3b_fp8_e4m3fn.safetensors', url: 'https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/seedvr2_ema_3b_fp8_e4m3fn.safetensors' },
    { directory: 'SEEDVR2', name: 'ema_vae_fp16.safetensors', url: 'https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/ema_vae_fp16.safetensors' },
  ];
}
fs.writeFileSync(path.join(ROOT, 'comfy', 'models.json'), JSON.stringify(out, null, 1));
for (const [a, v] of Object.entries(out)) console.log(a.padEnd(20), v.models.length, 'files', v.customNodes ? '+custom nodes' : '');
