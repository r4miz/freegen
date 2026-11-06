// Runtime configuration for the freegen gateway.
// Precedence: environment variable > persisted data/config.json > default.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const DATA_DIR = process.env.FREEGEN_DATA || path.join(ROOT, 'data');
export const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
export const WORKFLOWS_DIR = path.join(ROOT, 'comfy', 'workflows');

for (const d of ['uploads', 'outputs', 'jobs', 'cache']) {
  fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });
}

function readPersisted() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

export function savePersisted(patch) {
  const next = { ...readPersisted(), ...patch };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2));
  return next;
}

function keychain(service) {
  if (os.platform() !== 'darwin') return '';
  try {
    return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
  } catch { return ''; }
}

export function getConfig() {
  const p = readPersisted();
  const port = Number(process.env.FREEGEN_PORT || p.port || 8787);
  const publicBase = (process.env.FREEGEN_PUBLIC_BASE || p.publicBase || `http://127.0.0.1:${port}`).replace(/\/+$/, '');
  // Paid MuAPI passthrough is opt-in: FREEGEN_ALLOW_PAID=1 (or allowPaid in config.json).
  const allowPaid = process.env.FREEGEN_ALLOW_PAID === '1' || p.allowPaid === true;
  let providers = (process.env.FREEGEN_PROVIDERS || p.providers || 'comfy,gemini,muapi')
    .split(',').map(s => s.trim()).filter(Boolean);
  if (!allowPaid) providers = providers.filter(x => x !== 'muapi');
  if (process.env.FREEGEN_MOCK === '1' && !providers.includes('mock')) providers.unshift('mock');
  return {
    port,
    publicBase,
    providers,
    allowPaid,
    comfyUrl: (process.env.COMFY_URL || p.comfyUrl || '').replace(/\/+$/, ''),
    comfyToken: process.env.COMFY_TOKEN || p.comfyToken || '',
    muapiBase: (process.env.MUAPI_UPSTREAM || p.muapiBase || 'https://api.muapi.ai').replace(/\/+$/, ''),
    muapiKey: process.env.MUAPI_API_KEY || p.muapiKey || keychain('muapi-cli'),
    geminiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || p.geminiKey || '',
    pollIntervalMs: Number(process.env.FREEGEN_POLL_MS || 2000),
  };
}
