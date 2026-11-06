import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { routeFor, normalizeParams, workflowsFor, allRoutes } from '../routes.js';
import { dimsFor, framesFor, buildPrompt } from '../providers/comfy.js';

const index = JSON.parse(fs.readFileSync(new URL('./fixtures-models-index.json', import.meta.url), 'utf8'));

test('every image/video/lipsync endpoint in the UI resolves to a free route (exact or inferred)', () => {
  const missing = [];
  for (const group of ['t2iModels', 'i2iModels', 't2vModels', 'i2vModels', 'imageLipSyncModels']) {
    for (const m of index[group]) {
      // Build the payload shape the UI would send for this group so inference can use it.
      const payload = { prompt: 'x', ...(group === 'i2iModels' || group === 'i2vModels' ? { image_url: 'http://x/1.png' } : {}), ...(group === 'imageLipSyncModels' ? { image_url: 'http://x/1.png', audio_url: 'http://x/a.mp3' } : {}) };
      if (!routeFor(m.endpoint, payload)) missing.push(`${group}:${m.endpoint}`);
    }
  }
  assert.deepEqual(missing, [], `unrouted endpoints: ${missing.join(', ')}`);
});

test('inferred kinds match the UI group for new vendor models', () => {
  const expect = { t2iModels: ['image', 'edit'], i2iModels: ['edit', 'image'], t2vModels: ['video', 'i2v'], i2vModels: ['i2v', 'video', 'lipsync'] };
  const wrong = [];
  for (const [group, kinds] of Object.entries(expect)) {
    for (const m of index[group]) {
      const payload = { prompt: 'x', ...(group === 'i2iModels' || group === 'i2vModels' ? { image_url: 'http://x/1.png' } : {}) };
      const r = routeFor(m.endpoint, payload);
      if (r && !kinds.includes(r.kind)) wrong.push(`${group}:${m.endpoint}->${r.kind}`);
    }
  }
  assert.deepEqual(wrong, [], wrong.join(', '));
});

test('audio, motion-control and recast endpoints are paid-only by design (no route)', () => {
  for (const g of ['audioModels', 'motionControlModels', 'recastModels']) for (const m of index[g] || []) assert.equal(routeFor(m.endpoint, { prompt: 'x', video_url: 'http://x/v.mp4' }), null, m.endpoint);
});

test('routes reference only known workflow names', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../../comfy/workflows/manifest.json', import.meta.url), 'utf8'));
  const unknown = new Set();
  for (const r of allRoutes()) for (const w of r.workflows) if (!manifest[w]) unknown.add(w);
  assert.deepEqual([...unknown], []);
});

test('normalizeParams extracts files and defaults', () => {
  const r = routeFor('kling-v3.0-pro-image-to-video');
  const p = normalizeParams(r, { prompt: 'x', image_url: 'http://a/1.png', last_image_url: 'http://a/2.png', duration: '10' });
  assert.equal(p.files.image, 'http://a/1.png');
  assert.equal(p.files.last_image, 'http://a/2.png');
  assert.equal(p.duration, 10);
  assert.equal(workflowsFor(r, p)[0], 'ltx25_flf2v');
});

test('dimsFor snaps to multiples and keeps area', () => {
  const d = dimsFor('16:9', { base: 1024, multiple: 16 });
  assert.equal(d.width % 16, 0); assert.equal(d.height % 16, 0);
  assert.ok(d.width > d.height);
  const s = dimsFor('1:1', { base: 1024, multiple: 16 });
  assert.deepEqual(s, { width: 1024, height: 1024 });
});

test('framesFor follows the 8n+1 / 4n+1 rules', () => {
  assert.equal(framesFor(5, { fps: 24, multiple: 8, plus: 1 }), 121);
  assert.equal(framesFor(5, { fps: 24, multiple: 4, plus: 1 }), 121);
  assert.equal(framesFor(100, { fps: 24, multiple: 8, plus: 1, max: 241 }), 241);
});

test('buildPrompt binds values and fails loudly on missing image', () => {
  const api = { 1: { class_type: 'CLIPTextEncode', inputs: { text: '' } }, 2: { class_type: 'LoadImage', inputs: { image: '' } }, 3: { class_type: 'KSampler', inputs: { seed: 0 } } };
  const spec = { bind: { prompt: { node: '1', input: 'text' }, image: { node: '2', input: 'image' }, seed: { node: '3', input: 'seed' } } };
  const out = buildPrompt(spec, api, { prompt: 'hi', seed: 7 }, { image: 'up.png' });
  assert.equal(out[1].inputs.text, 'hi'); assert.equal(out[2].inputs.image, 'up.png'); assert.equal(out[3].inputs.seed, 7);
  assert.equal(api[1].inputs.text, '', 'template must not be mutated');
  assert.throws(() => buildPrompt(spec, api, { prompt: 'hi' }, {}), /needs an input image/);
});

test('normalizeParams understands the UI field variants (last_image, image_urls, string images_list)', () => {
  const r = routeFor('veo3.1-image-to-video');
  const p = normalizeParams(r, { prompt: 'x', image_url: 'http://a/1.png', last_image: 'http://a/2.png' });
  assert.equal(p.files.last_image, 'http://a/2.png');
  assert.equal(workflowsFor(r, p)[0], 'ltx25_flf2v');
  const q = normalizeParams({ kind: 'i2v' }, { prompt: 'x', image_urls: ['http://a/1.png', 'http://a/2.png'] });
  assert.equal(q.files.image, 'http://a/1.png'); assert.equal(q.files.image2, 'http://a/2.png');
  const s = normalizeParams({ kind: 'edit' }, { prompt: 'x', images_list: 'http://a/only.png' });
  assert.equal(s.files.image, 'http://a/only.png');
});
