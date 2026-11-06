// Run a JSON shot list (stills + clips) through the freegen gateway
// instead of MuAPI: FLUX.2 klein for stills and edits, Wan 2.2 5B for
// image-to-video, on whatever free backend is attached.
//
//   node scripts/gen-shots.mjs shots/example.json out/example
//
// Re-runs skip assets that already exist. Each still/clip is one MuAPI-shaped
// request to the gateway, so the same list runs unchanged on MuAPI later.
import fs from 'node:fs'; import path from 'node:path';
const [planPath, outDir] = process.argv.slice(2);
if (!planPath || !outDir) { console.error('usage: gen-shots.mjs <shots.json> <outDir>'); process.exit(1); }
const base = process.env.FREEGEN_BASE || 'http://127.0.0.1:8787';
const hdr = { 'content-type': 'application/json', 'x-api-key': 'local' };
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const manPath = path.join(outDir, 'manifest.json');
const man = fs.existsSync(manPath) ? JSON.parse(fs.readFileSync(manPath, 'utf8')) : {};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(endpoint, body, attempt = 0) {
  const r = await fetch(`${base}/api/v1/${endpoint}`, { method: 'POST', headers: hdr, body: JSON.stringify(body) });
  const j = await r.json(); if (!j.request_id) throw new Error(`submit: ${JSON.stringify(j).slice(0, 300)}`);
  for (;;) {
    await sleep(5000);
    const res = await (await fetch(`${base}/api/v1/predictions/${j.request_id}/result`, { headers: hdr })).json();
    if (res.status === 'completed') return res;
    if (res.status === 'failed') {
      if (attempt < 1 && /fetch failed|ECONN|timeout/i.test(res.error || '')) { console.log('retrying', endpoint, res.error); await sleep(15000); return run(endpoint, body, attempt + 1); }
      throw new Error(`failed: ${res.error}`);
    }
  }
}
async function save(url, file) { fs.writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer())); }

// Stills: the first (no "from") is text-to-image, the rest are edits of an earlier still.
for (const s of plan.stills) {
  const file = path.join(outDir, `${s.id}.png`);
  if (fs.existsSync(file)) { console.log('skip', s.id); continue; }
  const edit = s.from && s.from.length;
  const body = { prompt: s.payload.prompt, aspect_ratio: s.payload.aspect_ratio || '9:16' };
  if (edit) body.images_list = s.from.map(id => man[id].url);
  const t0 = Date.now();
  const res = await run(edit ? 'flux-2-klein-4b-edit' : 'flux-2-klein-4b', body);
  const url = res.outputs?.[0] || res.url; await save(url, file);
  man[s.id] = { url, file, provider: res.provider, workflow: res.workflow };
  fs.writeFileSync(manPath, JSON.stringify(man, null, 1));
  console.log('ok', s.id, res.workflow, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
// Clips: image-to-video from a generated still.
for (const c of process.env.STILLS_ONLY ? [] : (plan.clips || [])) {
  const file = path.join(outDir, `clip_${c.id}.mp4`);
  if (fs.existsSync(file)) { console.log('skip', c.id); continue; }
  const body = { prompt: c.payload.prompt, image_url: man[c.from].url, duration: c.payload.duration || 5, resolution: c.payload.resolution || '720p' };
  const t0 = Date.now();
  const res = await run('wan2.2-image-to-video', body);
  const url = res.outputs?.[0] || res.url; await save(url, file);
  man[c.id] = { url, file, provider: res.provider, workflow: res.workflow, from: c.from };
  fs.writeFileSync(manPath, JSON.stringify(man, null, 1));
  console.log('ok', c.id, res.workflow, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log('ALL_DONE');
