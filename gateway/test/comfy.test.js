import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPrompt, dimsFromImage, closestAspect } from '../providers/comfy.js';
import { imageSize } from '../files.js';
import { makePng } from '../providers/mock.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../../comfy/workflows/manifest.json', import.meta.url), 'utf8'));
const WF = new URL('../../comfy/workflows/', import.meta.url);
const load = a => JSON.parse(fs.readFileSync(new URL(manifest[a].file, WF), 'utf8'));
const links = p => { const out = []; for (const [id, n] of Object.entries(p)) for (const [k, v] of Object.entries(n.inputs)) if (Array.isArray(v) && typeof v[0] === 'string') out.push([id, k, v[0]]); return out; };

test('every manifest workflow file exists and every bound node exists in it', () => {
  for (const [alias, spec] of Object.entries(manifest)) {
    const api = load(alias);
    const all = { ...api, ...(spec.add || {}) };
    const check = b => { for (const x of Array.isArray(b) ? b : [b]) assert.ok(all[x.node], `${alias}: bound node ${x.node} missing`); };
    for (const b of Object.values(spec.bind || {})) check(b);
    for (const c of Object.values(spec.constants || {})) check(c.bind);
    assert.ok(all[spec.output.node], `${alias}: output node missing`);
  }
});

test('built prompts have no dangling links (with and without optional uploads)', () => {
  for (const [alias, spec] of Object.entries(manifest)) {
    const api = load(alias);
    const full = { image: 'a.png', image2: 'b.png', last_image: 'c.png', audio: 'v.mp3', video: 'x.mp4' };
    const minimal = { image: 'a.png', audio: 'v.mp3', video: 'x.mp4' };
    for (const up of [full, minimal]) {
      const p = buildPrompt(spec, api, { prompt: 'x', aspect_ratio: '16:9', duration: 5 }, up);
      for (const [id, k, src] of links(p)) assert.ok(p[src], `${alias}: ${id}.${k} -> ${src} dangling`);
      assert.ok(p[spec.output.node], `${alias}: output node survived`);
    }
  }
});

test('wan22_5b_i2v wires the added LoadImage into the latent', () => {
  const p = buildPrompt(manifest.wan22_5b_i2v, load('wan22_5b_i2v'), { prompt: 'x', aspect_ratio: '9:16' }, { image: 'in.png' });
  assert.equal(p['900'].inputs.image, 'in.png');
  assert.deepEqual(p['55'].inputs.start_image, ['900', 0]);
  assert.ok(p['55'].inputs.height > p['55'].inputs.width);
});

test('qwen21_edit single image drops the second reference', () => {
  const p = buildPrompt(manifest.qwen21_edit, load('qwen21_edit'), { prompt: 'x' }, { image: 'in.png' });
  assert.equal(p['475'], undefined);
  assert.equal(p['459:474'].inputs['images.image_2'], undefined);
  assert.equal(p['459:474'].inputs.prompt, 'x');
  const two = buildPrompt(manifest.qwen21_edit, load('qwen21_edit'), { prompt: 'x' }, { image: 'in.png', image2: 'ref.png' });
  assert.equal(two['475'].inputs.image, 'ref.png');
});

test('infinitetalk becomes single speaker with one audio feeding both passes', () => {
  const p = buildPrompt(manifest.infinitetalk_i2v, load('infinitetalk_i2v'), { prompt: 'talk' }, { image: 'f.png', audio: 'v.mp3' });
  assert.equal(p['188:129'].inputs.mode, 'single_speaker');
  assert.equal(p['188:129'].inputs['mode.mask_1'], undefined);
  assert.deepEqual(p['140'].inputs.audio, ['24', 0]);
  assert.equal(p['90'], undefined);
  assert.equal(p['324:312'].inputs.text, 'talk');
});

test('ltx25 prompt enhancer is removed and the aspect label is set', () => {
  const p = buildPrompt(manifest.ltx25_t2v, load('ltx25_t2v'), { prompt: 'x', aspect_ratio: '9:16', duration: 7 }, {});
  assert.equal(p['405:380'], undefined);
  assert.equal(p['405:382'].inputs.on_true, undefined);
  assert.equal(p['409'].inputs.aspect_ratio, '9:16 (Portrait Widescreen)');
  assert.equal(p['405:362'].inputs.value, 7);
});

test('imageSize reads PNG headers and drives fromImage sizing', () => {
  const tmp = path.join(os.tmpdir(), `freegen-${Date.now()}.png`);
  fs.writeFileSync(tmp, makePng(300, 200));
  assert.deepEqual(imageSize(tmp), { width: 300, height: 200 });
  fs.unlinkSync(tmp);
  const d = dimsFromImage({ width: 300, height: 200 }, { base: 960, multiple: 32 });
  assert.equal(d.width % 32, 0); assert.ok(Math.abs(d.width / d.height - 1.5) < 0.1);
  assert.equal(closestAspect({ width: 1080, height: 1920 }), '9:16');
});
