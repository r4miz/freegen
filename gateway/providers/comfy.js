// ComfyUI provider. Talks to a ComfyUI server (local, or a free cloud GPU
// reached through a tunnel) using its HTTP API: /object_info, /upload/image,
// /prompt, /history/{id}, /view. Workflows are API-format JSON under
// comfy/workflows, parameterized through comfy/workflows/manifest.json.
import fs from 'node:fs';
import path from 'node:path';
import { WORKFLOWS_DIR } from '../config.js';
import { extFor, imageSize } from '../files.js';

const manifestPath = path.join(WORKFLOWS_DIR, 'manifest.json');

export function loadManifest() {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function headers(cfg, extra = {}) {
  const h = { ...extra };
  if (cfg.comfyToken) h['x-freegen-token'] = cfg.comfyToken;
  return h;
}

async function getJson(cfg, p) {
  const res = await fetch(`${cfg.comfyUrl}${p}`, { headers: headers(cfg) });
  if (!res.ok) throw new Error(`comfy ${p} -> ${res.status}`);
  return res.json();
}

let objectInfoCache = { url: null, at: 0, data: null };
export async function objectInfo(cfg, maxAgeMs = 60_000) {
  const fresh = objectInfoCache.url === cfg.comfyUrl && Date.now() - objectInfoCache.at < maxAgeMs;
  if (fresh) return objectInfoCache.data;
  const data = await getJson(cfg, '/object_info');
  objectInfoCache = { url: cfg.comfyUrl, at: Date.now(), data };
  return data;
}

// Which model files does the server actually have? ComfyUI exposes loader
// combo lists in /object_info, e.g. UNETLoader.input.required.unet_name[0].
const LOADER_FIELDS = {
  diffusion_models: ['UNETLoader', 'unet_name'],
  checkpoints: ['CheckpointLoaderSimple', 'ckpt_name'],
  text_encoders: ['CLIPLoader', 'clip_name'],
  vae: ['VAELoader', 'vae_name'],
  loras: ['LoraLoaderModelOnly', 'lora_name'],
  audio_encoders: ['AudioEncoderLoader', 'audio_encoder_name'],
  model_patches: ['ModelPatchLoader', 'name'],
  latent_upscale_models: ['LatentUpscaleModelLoader', 'model_name'],
};

export async function availability(cfg) {
  if (!cfg.comfyUrl) return { ok: false, reason: 'no COMFY_URL configured', workflows: {} };
  let info;
  try { info = await objectInfo(cfg); } catch (e) { return { ok: false, reason: e.message, workflows: {} }; }
  const manifest = loadManifest();
  const present = {};
  for (const [dir, [node, field]] of Object.entries(LOADER_FIELDS)) {
    const list = info?.[node]?.input?.required?.[field]?.[0];
    present[dir] = new Set(Array.isArray(list) ? list : []);
  }
  const nodeTypes = new Set(Object.keys(info));
  const workflows = {};
  for (const [name, wf] of Object.entries(manifest)) {
    const missingModels = [];
    for (const [dir, files] of Object.entries(wf.requires?.models || {})) {
      for (const f of files) if (!present[dir]?.has(f)) missingModels.push(`${dir}/${f}`);
    }
    const missingNodes = (wf.requires?.nodes || []).filter(n => !nodeTypes.has(n));
    workflows[name] = { ok: missingModels.length === 0 && missingNodes.length === 0, missingModels, missingNodes, kind: wf.kind };
  }
  return { ok: true, workflows };
}

export async function uploadToComfy(cfg, file) {
  const form = new FormData();
  const blob = new Blob([fs.readFileSync(file.abs)], { type: file.mime });
  form.append('image', blob, file.filename);
  form.append('overwrite', 'true');
  const res = await fetch(`${cfg.comfyUrl}/upload/image`, { method: 'POST', body: form, headers: headers(cfg) });
  if (!res.ok) throw new Error(`comfy upload failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name;
}

// ─── Parameter shaping ───────────────────────────────────────────────────────
const AR = { '1:1': [1, 1], '16:9': [16, 9], '9:16': [9, 16], '4:3': [4, 3], '3:4': [3, 4], '3:2': [3, 2], '2:3': [2, 3], '21:9': [21, 9], '4:5': [4, 5], '5:4': [5, 4] };

export function dimsFor(aspect, { base = 1024, multiple = 16, maxSide } = {}) {
  const [w, h] = AR[aspect] || AR['1:1'];
  const area = base * base;
  let width = Math.sqrt(area * w / h);
  let height = area / width;
  if (maxSide) { const s = Math.min(1, maxSide / Math.max(width, height)); width *= s; height *= s; }
  const snap = v => Math.max(multiple, Math.round(v / multiple) * multiple);
  return { width: snap(width), height: snap(height) };
}

export function dimsFromImage(img, { base = 1024, multiple = 16, maxSide } = {}) {
  if (!img?.width || !img?.height) return null;
  const area = base * base;
  let width = Math.sqrt(area * img.width / img.height);
  let height = area / width;
  if (maxSide) { const s = Math.min(1, maxSide / Math.max(width, height)); width *= s; height *= s; }
  const snap = v => Math.max(multiple, Math.round(v / multiple) * multiple);
  return { width: snap(width), height: snap(height) };
}

export function framesFor(durationSec, { fps = 24, multiple = 8, plus = 1, max = 241, min = 9 } = {}) {
  const raw = Math.round(Number(durationSec || 5) * fps);
  const snapped = Math.round((raw - plus) / multiple) * multiple + plus;
  return Math.max(min, Math.min(max, snapped));
}

function setInput(prompt, binding, value) {
  const list = Array.isArray(binding) ? binding : [binding];
  for (const b of list) {
    const node = prompt[b.node];
    if (!node) throw new Error(`workflow binding points at missing node ${b.node}`);
    node.inputs[b.input] = value;
  }
}

// Build a concrete prompt from a workflow + normalized params.
export function buildPrompt(wfSpec, apiJson, params, uploaded) {
  const prompt = structuredClone(apiJson);
  const b = wfSpec.bind || {};
  // 1. Structural edits that bindings may depend on.
  for (const [id, node] of Object.entries(wfSpec.add || {})) prompt[id] = structuredClone(node);
  for (const l of wfSpec.link || []) { if (prompt[l.node]) prompt[l.node].inputs[l.input] = [l.from, l.index ?? 0]; }
  // 2. Bindings.
  if (b.prompt) setInput(prompt, b.prompt, params.prompt ?? '');
  if (b.negative && params.negative !== undefined) setInput(prompt, b.negative, params.negative);
  if (b.seed) setInput(prompt, b.seed, params.seed ?? Math.floor(Math.random() * 2 ** 31));
  if (b.width && b.height) {
    const d = (wfSpec.size?.fromImage && dimsFromImage(params.imageDims, wfSpec.size)) || dimsFor(params.aspect_ratio, wfSpec.size || {});
    setInput(prompt, b.width, d.width); setInput(prompt, b.height, d.height);
  }
  if (b.aspect_label) {
    const labels = wfSpec.aspectLabels || ASPECT_LABELS;
    let ar = params.aspect_ratio;
    if (wfSpec.size?.fromImage && params.imageDims) ar = closestAspect(params.imageDims);
    setInput(prompt, b.aspect_label, labels[ar] || labels['16:9']);
  }
  if (b.length) setInput(prompt, b.length, framesFor(params.duration, wfSpec.frames || {}));
  if (b.duration) setInput(prompt, b.duration, Math.max(1, Math.min(wfSpec.maxDuration || 10, Math.round(Number(params.duration || 5)))));
  if (b.image) {
    if (!uploaded.image) throw new Error('this model needs an input image');
    setInput(prompt, b.image, uploaded.image);
  }
  if (b.image2 && uploaded.image2) setInput(prompt, b.image2, uploaded.image2);
  if (b.last_image && uploaded.last_image) setInput(prompt, b.last_image, uploaded.last_image);
  if (b.audio) {
    if (!uploaded.audio) throw new Error('this model needs an input audio file');
    setInput(prompt, b.audio, uploaded.audio);
  }
  if (b.video) {
    if (!uploaded.video) throw new Error('this model needs an input video');
    setInput(prompt, b.video, uploaded.video);
  }
  // 3. Fixed values, removals, and conditional rewiring when an optional upload is absent.
  for (const v of Object.values(wfSpec.constants || {})) setInput(prompt, v.bind, v.value);
  for (const u of wfSpec.unlink || []) { if (prompt[u.node]) delete prompt[u.node].inputs[u.input]; }
  for (const id of wfSpec.drop || []) delete prompt[id];
  for (const c of wfSpec.when || []) {
    if (uploaded[c.absent]) continue;
    for (const id of c.drop || []) delete prompt[id];
    for (const u of c.unlink || []) { if (prompt[u.node]) delete prompt[u.node].inputs[u.input]; }
    for (const l of c.link || []) { if (prompt[l.node]) prompt[l.node].inputs[l.input] = [l.from, l.index ?? 0]; }
    for (const sv of c.set || []) { if (prompt[sv.node]) prompt[sv.node].inputs[sv.input] = sv.value; }
  }
  return prompt;
}

// ResolutionSelector has no 4:5 / 5:4 options; those UI choices fall back to the nearest 3:4 / 4:3 label.
const ASPECT_LABELS = { '1:1': '1:1 (Square)', '2:3': '2:3 (Portrait Photo)', '3:2': '3:2 (Photo)', '3:4': '3:4 (Portrait Standard)', '4:3': '4:3 (Standard)', '9:16': '9:16 (Portrait Widescreen)', '16:9': '16:9 (Widescreen)', '21:9': '21:9 (Ultrawide)', '4:5': '3:4 (Portrait Standard)', '5:4': '4:3 (Standard)' };
export function closestAspect(img) {
  const r = img.width / img.height;
  let best = '1:1', bd = Infinity;
  for (const [k, [w, h]] of Object.entries(AR)) { const d = Math.abs(Math.log(r) - Math.log(w / h)); if (d < bd) { bd = d; best = k; } }
  return best;
}

async function pollHistory(cfg, promptId, { intervalMs, onTick, maxMs = 60 * 60 * 1000 }) {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    await new Promise(r => setTimeout(r, intervalMs));
    let hist;
    try { hist = await getJson(cfg, `/history/${promptId}`); } catch (e) { onTick?.(`history poll error: ${e.message}`); continue; }
    const entry = hist?.[promptId];
    if (!entry) { onTick?.('queued'); continue; }
    const st = entry.status || {};
    if (st.status_str === 'error') {
      const msg = (st.messages || []).map(m => JSON.stringify(m[1]?.exception_message || m[1] || m)).join('; ');
      throw new Error(`ComfyUI execution error: ${msg.slice(0, 500)}`);
    }
    if (st.completed || entry.outputs) return entry;
  }
  throw new Error('ComfyUI job timed out');
}

function collectOutputs(entry, outputNode) {
  const outs = entry.outputs || {};
  const nodes = outputNode ? [outputNode] : Object.keys(outs);
  const files = [];
  for (const n of nodes) {
    const o = outs[n]; if (!o) continue;
    for (const key of ['images', 'videos', 'gifs', 'audio', 'files']) {
      for (const f of o[key] || []) if (f.type === 'output' || f.type === undefined) files.push(f);
    }
  }
  return files;
}

export function createComfyProvider() {
  return {
    name: 'comfy',
    async status(cfg) { return availability(cfg); },
    async canHandle(cfg, route) {
      const av = await availability(cfg);
      if (!av.ok) return { ok: false, reason: av.reason };
      const wf = (route.workflows || []).find(w => av.workflows[w]?.ok);
      return wf ? { ok: true, workflow: wf } : { ok: false, reason: `no loaded workflow among ${route.workflows?.join(', ')}` };
    },
    async run(cfg, ctx, route, choice) {
      const manifest = loadManifest();
      const spec = manifest[choice.workflow];
      const apiJson = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, spec.file), 'utf8'));
      const uploaded = {};
      for (const k of ['image', 'image2', 'last_image', 'audio', 'video']) {
        const ref = ctx.params.files?.[k];
        if (!ref) continue;
        const f = await ctx.materialize(ref);
        if (k === 'image') { let dims = null; try { dims = imageSize(f.abs); } catch { /* not an image */ } ctx.params = { ...ctx.params, imageDims: dims }; }
        uploaded[k] = await uploadToComfy(cfg, f);
        ctx.log(`uploaded ${k} -> ${uploaded[k]}`);
      }
      const prompt = buildPrompt(spec, apiJson, ctx.params, uploaded);
      const clientId = `freegen-${ctx.jobId}`;
      const res = await fetch(`${cfg.comfyUrl}/prompt`, {
        method: 'POST', headers: headers(cfg, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prompt, client_id: clientId }),
      });
      if (!res.ok) throw new Error(`ComfyUI rejected prompt ${res.status}: ${(await res.text()).slice(0, 600)}`);
      const { prompt_id } = await res.json();
      ctx.log(`comfy prompt_id ${prompt_id} (${choice.workflow})`);
      const entry = await pollHistory(cfg, prompt_id, { intervalMs: cfg.pollIntervalMs, onTick: ctx.log });
      const files = collectOutputs(entry, spec.output?.node);
      if (!files.length) throw new Error('ComfyUI finished without output files');
      const urls = [];
      for (const f of files) {
        const q = new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' });
        const r = await fetch(`${cfg.comfyUrl}/view?${q}`, { headers: headers(cfg) });
        if (!r.ok) throw new Error(`fetch output failed ${r.status}`);
        const mime = r.headers.get('content-type') || '';
        const ext = path.extname(f.filename).slice(1) || extFor(mime);
        urls.push(ctx.saveOutput(Buffer.from(await r.arrayBuffer()), ext));
      }
      return { outputs: urls, workflow: choice.workflow };
    },
  };
}
