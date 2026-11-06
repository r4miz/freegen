// Print a binding-oriented summary of an API-format workflow so manifest
// entries can be authored and checked. Usage: node scripts/analyze-workflow.mjs <alias>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const alias = process.argv[2];
const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'comfy', 'workflows', `${alias}.api.json`), 'utf8'));
const isLink = v => Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';
const title = id => api[id]?._meta?.title ? ` "${api[id]._meta.title}"` : '';
function trace(id, depth = 0) {
  const n = api[id]; if (!n || depth > 8) return [];
  if (['CLIPTextEncode', 'TextEncodeQwenImage21', 'PrimitiveStringMultiline', 'TextGenerate', 'TextGenerateLTX2Prompt'].includes(n.class_type)) return [`${id}:${n.class_type}${title(id)}`];
  return Object.values(n.inputs).filter(isLink).flatMap(([src]) => trace(src, depth + 1));
}
console.log(`# ${alias}: ${Object.keys(api).length} nodes\n`);
for (const [id, n] of Object.entries(api)) {
  const vals = Object.entries(n.inputs).filter(([, v]) => !isLink(v)).map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 60)}`).join(' ');
  console.log(`${id.padEnd(5)} ${(n.class_type || '<missing class>').padEnd(28)}${title(id)}  ${vals}`);
}
console.log('\n## conditioning trace');
for (const [id, n] of Object.entries(api)) {
  for (const key of ['positive', 'negative', 'guider', 'conditioning']) {
    if (isLink(n.inputs[key])) console.log(`${id}:${n.class_type}.${key} <- ${trace(n.inputs[key][0]).join(', ')}`);
  }
}
console.log('\n## string inputs feeding text encoders');
for (const [id, n] of Object.entries(api)) {
  if (['CLIPTextEncode', 'TextEncodeQwenImage21'].includes(n.class_type)) {
    const t = n.inputs.text ?? n.inputs.prompt;
    console.log(`${id}:${n.class_type} text=${isLink(t) ? `<- ${t[0]}:${api[t[0]]?.class_type}${title(t[0])} value=${JSON.stringify(api[t[0]]?.inputs?.value ?? '').slice(0, 50)}` : JSON.stringify(t).slice(0, 60)}`);
  }
}
