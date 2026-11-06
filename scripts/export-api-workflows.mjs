// Convert official ComfyUI UI-format templates (with subgraphs) into API-format
// prompts by running the real ComfyUI frontend headlessly and calling
// app.graphToPrompt(). Requires a local ComfyUI at COMFY_LOCAL (default
// http://127.0.0.1:8188) with comfyui_workflow_templates installed.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'comfy', 'workflows');
const COMFY = process.env.COMFY_LOCAL || 'http://127.0.0.1:8188';

import { TEMPLATES } from './template-map.mjs';

const only = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', e => console.error('[page error]', e.message));
await page.goto(COMFY, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.app && window.app.graph && typeof window.app.graphToPrompt === 'function', null, { timeout: 60000 });

fs.mkdirSync(OUT, { recursive: true });
const report = {};
for (const [alias, tpl] of Object.entries(TEMPLATES)) {
  if (only.length && !only.includes(alias)) continue;
  // Prefer the template served by the local ComfyUI; fall back to the copy in comfy/templates-ui.
  const localCopy = path.join(ROOT, 'comfy', 'templates-ui', `${tpl}.json`);
  const fallback = fs.existsSync(localCopy) ? JSON.parse(fs.readFileSync(localCopy, 'utf8')) : null;
  const result = await page.evaluate(async ({ tpl, fallback }) => {
    const res = await fetch(`/templates/${tpl}.json`);
    const graph = res.ok ? await res.json() : fallback;
    if (!graph) return { error: `template fetch ${res.status} and no local copy` };
    await window.app.loadGraphData(graph, true, true, tpl);
    await new Promise(r => setTimeout(r, 500));
    const { output, workflow } = await window.app.graphToPrompt();
    return { output, nodeCount: Object.keys(output).length, uiNodes: workflow?.nodes?.length };
  }, { tpl, fallback });
  if (result.error) { console.error(`${alias}: ${result.error}`); report[alias] = result.error; continue; }
  // Drop pure-UI nodes that the backend rejects / does not need.
  const DROP = ['MarkdownNote', 'Note', 'PreviewAny', 'ImageCompare', 'PreviewImage', 'PreviewVideo'];
  const isLink = v => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';
  for (const [id, node] of Object.entries(result.output)) {
    if (!DROP.includes(node.class_type)) continue;
    // A pass-through display node (PreviewAny) may sit between two real nodes: re-point its consumers to its source.
    const src = Object.values(node.inputs || {}).find(isLink);
    for (const other of Object.values(result.output)) {
      for (const [k, v] of Object.entries(other.inputs || {})) if (isLink(v) && v[0] === id) { if (src) other.inputs[k] = src; else delete other.inputs[k]; }
    }
    delete result.output[id];
  }
  fs.writeFileSync(path.join(OUT, `${alias}.api.json`), JSON.stringify(result.output, null, 1));
  report[alias] = `${Object.keys(result.output).length} nodes`;
  console.log(`${alias.padEnd(22)} <- ${tpl}: ${report[alias]}`);
}
await browser.close();
