// Integration: exercise the real ComfyUI HTTP plumbing (upload -> /prompt ->
// /history -> /view) with a model-free workflow. Skips unless COMFY_LOCAL answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createComfyProvider } from '../providers/comfy.js';
import { makePng } from '../providers/mock.js';

const COMFY = process.env.COMFY_LOCAL || 'http://127.0.0.1:8188';
let up = false;
try { up = (await fetch(`${COMFY}/system_stats`, { signal: AbortSignal.timeout(2000) })).ok; } catch { up = false; }

test('comfy provider runs a model-free workflow end to end', { skip: !up && 'no local ComfyUI' }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freegen-ci-'));
  const png = path.join(tmp, 'in.png'); fs.writeFileSync(png, makePng(64, 48, [200, 30, 30]));
  const wfDir = path.join(tmp, 'wf'); fs.mkdirSync(wfDir);
  const api = {
    1: { class_type: 'LoadImage', inputs: { image: '' } },
    2: { class_type: 'ImageScale', inputs: { upscale_method: 'nearest-exact', width: 128, height: 96, crop: 'disabled', image: ['1', 0] } },
    3: { class_type: 'SaveImage', inputs: { filename_prefix: 'freegen-test', images: ['2', 0] } },
  };
  fs.writeFileSync(path.join(wfDir, 'plumb.api.json'), JSON.stringify(api));
  fs.writeFileSync(path.join(wfDir, 'manifest.json'), JSON.stringify({ plumb: { file: 'plumb.api.json', kind: 'edit', bind: { image: { node: '1', input: 'image' } }, output: { node: '3' }, requires: { models: {}, nodes: ['ImageScale'] } } }));
  // Point the provider at the temp manifest by monkey-patching the module config.
  const cfgMod = await import('../config.js');
  const origDir = cfgMod.WORKFLOWS_DIR;
  const provider = createComfyProvider();
  const cfg = { comfyUrl: COMFY, comfyToken: '', pollIntervalMs: 500, providers: ['comfy'], publicBase: 'http://127.0.0.1:0' };
  const outputs = [];
  const ctx = {
    jobId: 'ci1', endpoint: 'ai-image-upscale', params: { prompt: '', files: { image: 'file://' + png } },
    log: () => {},
    materialize: async () => ({ abs: png, filename: 'in.png', mime: 'image/png' }),
    saveOutput: (buf, ext) => { outputs.push({ buf, ext }); return `out.${ext}`; },
  };
  // Swap the workflows dir for this test via env override of module constant is not possible; emulate by using fs symlink.
  const target = path.join(origDir, 'plumb.api.json');
  const manifestPath = path.join(origDir, 'manifest.json');
  const originalManifest = fs.readFileSync(manifestPath, 'utf8');
  try {
    fs.copyFileSync(path.join(wfDir, 'plumb.api.json'), target);
    const merged = { ...JSON.parse(originalManifest), ...JSON.parse(fs.readFileSync(path.join(wfDir, 'manifest.json'), 'utf8')) };
    fs.writeFileSync(manifestPath, JSON.stringify(merged));
    const choice = await provider.canHandle(cfg, { kind: 'edit', workflows: ['plumb'] }, ctx);
    assert.equal(choice.ok, true, JSON.stringify(choice));
    assert.equal(choice.workflow, 'plumb');
    const result = await provider.run(cfg, ctx, { kind: 'edit', workflows: ['plumb'] }, choice);
    assert.equal(result.outputs.length, 1);
    assert.equal(outputs[0].ext, 'png');
    assert.deepEqual([...outputs[0].buf.subarray(1, 4)], [0x50, 0x4e, 0x47]);
    assert.ok(outputs[0].buf.length > 100);
  } finally {
    fs.writeFileSync(manifestPath, originalManifest);
    fs.rmSync(target, { force: true });
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
