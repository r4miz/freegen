// Generate the self-contained Kaggle/Colab notebook and a plain .py runner
// from comfy/notebook_template.py, inlining proxy.py and models.json so the
// notebook needs nothing from this machine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tpl = fs.readFileSync(path.join(ROOT, 'comfy', 'notebook_template.py'), 'utf8');
const proxy = fs.readFileSync(path.join(ROOT, 'comfy', 'proxy.py'), 'utf8');
const models = fs.readFileSync(path.join(ROOT, 'comfy', 'models.json'), 'utf8');
const py = tpl.replace('__PROXY_PY__', JSON.stringify(proxy)).replace('__MODELS_JSON__', JSON.stringify(models));
fs.writeFileSync(path.join(ROOT, 'comfy', 'notebooks', 'freegen_comfyui.py'), py);
const cells = py.split(/^# %% /m).filter(Boolean).map(block => {
  const nl = block.indexOf('\n');
  const title = block.slice(0, nl).trim();
  const src = block.slice(nl + 1);
  return { cell_type: 'code', metadata: { title }, execution_count: null, outputs: [], source: src.split(/(?<=\n)/) };
});
const nb = {
  nbformat: 4, nbformat_minor: 5,
  metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python' },
    kaggle: { accelerator: 'nvidiaTeslaT4', dataSources: [], isInternetEnabled: true, language: 'python', sourceType: 'notebook' } },
  cells: [{ cell_type: 'markdown', metadata: {}, source: ['# freegen ComfyUI backend\n', '\n', 'Runs ComfyUI on this free GPU, downloads only the models for the chosen PROFILE, and exposes it through a Cloudflare tunnel protected by a token.\n', '\n', 'Set PROFILE and TOKEN in the first cell, then Run All. The last cell prints the URL to paste into `freegen set-backend <url> <token>`.\n'] }, ...cells],
};
fs.writeFileSync(path.join(ROOT, 'comfy', 'notebooks', 'freegen_comfyui.ipynb'), JSON.stringify(nb, null, 1));
console.log(`notebook: ${cells.length} code cells`);
