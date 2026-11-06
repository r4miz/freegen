// freegen gateway: a MuAPI-compatible HTTP server. Point Open-Generative-AI
// (or anything that speaks MuAPI) at it and jobs run on free backends.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { getConfig, savePersisted, DATA_DIR } from './config.js';
import { createJob, updateJob, getJob, log, publicView, loadJobs, listJobs } from './jobs.js';
import { materialize, saveBuffer, publicUrl, readLocal, mimeFor, extFor } from './files.js';
import { routeFor, normalizeParams, workflowsFor, allRoutes } from './routes.js';
import { createComfyProvider } from './providers/comfy.js';
import { createMuapiProvider } from './providers/muapi.js';
import { createGeminiProvider } from './providers/gemini.js';
import { createMockProvider } from './providers/mock.js';

const PROVIDERS = { comfy: createComfyProvider(), muapi: createMuapiProvider(), gemini: createGeminiProvider(), mock: createMockProvider() };

// ─── helpers ─────────────────────────────────────────────────────────────────
function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': Buffer.isBuffer(body) ? headers['Content-Type'] || 'application/octet-stream' : 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', ...headers });
  res.end(data);
}
// Static media with HTTP Range support (Safari refuses <video> without 206) and streaming.
function sendFile(req, res, abs) {
  const size = fs.statSync(abs).size;
  const base = { 'Content-Type': mimeFor(abs), 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000', 'Access-Control-Allow-Origin': '*' };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = size - 1, status = 200;
  if (m && (m[1] || m[2])) {
    start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : end;
    if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    status = 206; base['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }
  res.writeHead(status, { ...base, 'Content-Length': end - start + 1 });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(abs, { start, end }).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// Minimal multipart/form-data parser: returns { fields, files:[{name, filename, mime, data}] }.
export function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw new Error('missing multipart boundary');
  const boundary = Buffer.from(`--${m[1] || m[2]}`);
  const out = { fields: {}, files: [] };
  let start = buf.indexOf(boundary);
  while (start !== -1) {
    start += boundary.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    if (buf.slice(start, start + 2).toString() === '\r\n') start += 2;
    const headEnd = buf.indexOf('\r\n\r\n', start);
    if (headEnd === -1) break;
    const head = buf.slice(start, headEnd).toString();
    let next = buf.indexOf(boundary, headEnd + 4);
    if (next === -1) next = buf.length;
    let data = buf.slice(headEnd + 4, next);
    if (data.slice(-2).toString() === '\r\n') data = data.slice(0, -2);
    const name = /name="([^"]*)"/.exec(head)?.[1];
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    const mime = /content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim();
    if (filename !== undefined) out.files.push({ name, filename, mime: mime || 'application/octet-stream', data });
    else if (name) out.fields[name] = data.toString();
    start = next;
  }
  return out;
}
function apiKeyOf(req) { return req.headers['x-api-key'] || null; }
function looksLikeMuapiKey(k) { return typeof k === 'string' && /^[a-f0-9]{64}$/i.test(k); }

// ─── job execution ───────────────────────────────────────────────────────────
async function runJob(job, cfg) {
  const route = routeFor(job.endpoint, job.payload);
  const params = route ? normalizeParams(route, job.payload) : null;
  const ctx = {
    jobId: job.request_id,
    endpoint: job.endpoint,
    rawPayload: job.payload,
    params,
    apiKey: job.apiKey,
    apiKeyLooksReal: looksLikeMuapiKey(job.apiKey),
    log: line => log(job.request_id, line),
    materialize: ref => materialize(ref, cfg.publicBase),
    saveOutput: (buf, ext) => publicUrl(saveBuffer('outputs', buf, { ext }).rel, cfg.publicBase),
  };
  const order = route ? cfg.providers : cfg.providers.filter(p => p === 'muapi' || p === 'mock');
  const reasons = [];
  for (const name of order) {
    const provider = PROVIDERS[name];
    if (!provider) continue;
    if (name === 'gemini' && !route?.gemini) continue;
    const routeForProvider = route ? { ...route, workflows: workflowsFor(route, params) } : { kind: 'unknown', workflows: [] };
    let choice;
    try { choice = await provider.canHandle(cfg, routeForProvider, ctx); } catch (e) { choice = { ok: false, reason: e.message }; }
    if (!choice.ok) { reasons.push(`${name}: ${choice.reason}`); continue; }
    updateJob(job.request_id, { status: 'processing', provider: name, workflow: choice.workflow || choice.model || null });
    ctx.log(`running on ${name}${choice.workflow ? ` (${choice.workflow})` : ''}`);
    try {
      const result = await provider.run(cfg, ctx, routeForProvider, choice);
      updateJob(job.request_id, { status: 'completed', outputs: result.outputs, url: result.outputs[0] || null });
      ctx.log(`completed with ${result.outputs.length} output(s)`);
      return;
    } catch (e) {
      ctx.log(`${name} failed: ${e.message}`);
      reasons.push(`${name}: ${e.message}`);
      if (name === 'muapi' || name === 'mock') break; // paid fallback failing is final
    }
  }
  updateJob(job.request_id, { status: 'failed', error: reasons.join(' | ') || `no provider for ${job.endpoint}` });
}

// ─── passthrough for non-generation MuAPI surfaces (workflows, agents, apps) ─
async function passthrough(req, res, cfg, body) {
  const key = looksLikeMuapiKey(apiKeyOf(req)) ? apiKeyOf(req) : cfg.muapiKey;
  if (!cfg.allowPaid) return send(res, 503, { error: 'freegen: this is a paid MuAPI feature. Start the gateway with FREEGEN_ALLOW_PAID=1 to enable passthrough.' });
  if (!key) return send(res, 503, { error: 'freegen: this feature needs a MuAPI key (paid). Set MUAPI_API_KEY to enable passthrough.' });
  const target = `${cfg.muapiBase}${req.url}`;
  const headers = { 'x-api-key': key };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  const r = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
  const buf = Buffer.from(await r.arrayBuffer());
  send(res, r.status, buf, { 'Content-Type': r.headers.get('content-type') || 'application/json' });
}

// ─── request handler ─────────────────────────────────────────────────────────
export async function handle(req, res) {
  const cfg = getConfig();
  const url = new URL(req.url, cfg.publicBase);
  const p = url.pathname;
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');

    // Static files
    if (p.startsWith('/files/')) {
      const abs = readLocal(p.slice('/files/'.length));
      if (!abs) return send(res, 404, { error: 'not found' });
      return sendFile(req, res, abs);
    }

    // Admin
    if (p === '/' || p === '/freegen' || p === '/freegen/status') {
      const providers = {};
      for (const name of cfg.providers) {
        try { providers[name] = await PROVIDERS[name].status(cfg); } catch (e) { providers[name] = { ok: false, reason: e.message }; }
      }
      const { muapiKey, geminiKey, comfyToken, ...safe } = cfg;
      return send(res, 200, { ok: true, config: { ...safe, allowPaid: cfg.allowPaid, hasMuapiKey: !!muapiKey, hasGeminiKey: !!geminiKey, hasComfyToken: !!comfyToken }, providers, recent: listJobs(10).map(publicView) });
    }
    if (p === '/freegen/routes') return send(res, 200, { routes: allRoutes() });
    if (p === '/freegen/jobs') return send(res, 200, { jobs: listJobs(Number(url.searchParams.get('limit') || 50)).map(publicView) });
    if (p === '/freegen/config' && req.method === 'POST') {
      // Admin writes: only from non-browser clients or pages served on loopback.
      const origin = req.headers.origin;
      if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) return send(res, 403, { error: 'admin writes are loopback-only' });
      const patch = JSON.parse((await readBody(req)).toString() || '{}');
      const allowed = ['comfyUrl', 'comfyToken', 'providers', 'geminiKey', 'muapiKey', 'publicBase'];
      const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
      if (clean.comfyUrl) clean.comfyUrl = String(clean.comfyUrl).replace(/\/+$/, '');
      savePersisted(clean);
      return send(res, 200, { ok: true, saved: Object.keys(clean) });
    }

    // MuAPI-compatible surface
    if (p === '/api/v1/account/balance') {
      if (cfg.allowPaid && (cfg.muapiKey || looksLikeMuapiKey(apiKeyOf(req)))) {
        try {
          const key = looksLikeMuapiKey(apiKeyOf(req)) ? apiKeyOf(req) : cfg.muapiKey;
          const r = await fetch(`${cfg.muapiBase}/api/v1/account/balance`, { headers: { 'x-api-key': key } });
          if (r.ok) { const b = await r.json(); return send(res, 200, { ...b, freegen: true }); }
        } catch { /* fall through */ }
      }
      return send(res, 200, { balance: 0, currency: 'FREE', freegen: true, email: 'local' });
    }
    if (p === '/api/v1/upload_file' && req.method === 'POST') {
      const body = await readBody(req);
      const { files } = parseMultipart(body, req.headers['content-type']);
      const f = files.find(x => x.name === 'file') || files[0];
      if (!f) return send(res, 400, { error: 'no file field' });
      const ext = path.extname(f.filename || '').slice(1) || extFor(f.mime);
      const saved = saveBuffer('uploads', f.data, { ext, name: f.filename });
      return send(res, 200, { url: publicUrl(saved.rel, cfg.publicBase), file_url: publicUrl(saved.rel, cfg.publicBase), size: f.data.length });
    }
    const poll = /^\/api\/v1\/predictions\/([a-zA-Z0-9_-]+)\/result$/.exec(p);
    if (poll) {
      const job = getJob(poll[1]);
      if (!job) return send(res, 404, { detail: { error: { code: 'REQUEST_NOT_FOUND', message: 'Request ID not found' } } });
      return send(res, 200, publicView(job));
    }
    if (p === '/api/v1/models' && req.method === 'GET') {
      const free = allRoutes().map(r => ({ name: r.endpoint, endpoint: `/api/v1/${r.endpoint}`, endpoint_url: r.endpoint, category: r.kind, cost: 0, cost_currency: 'FREE', is_enabled: 1, provider: 'freegen' }));
      return send(res, 200, { models: free });
    }
    const est = /^\/api\/v1\/models\/([^/]+)\/estimate-cost$/.exec(p);
    if (est && routeFor(decodeURIComponent(est[1]))) return send(res, 200, { cost: 0, currency: 'FREE', model: est[1] });
    if (p === '/api/v1/app/calculate_dynamic_cost') return send(res, 200, { cost: 0, currency: 'FREE' });

    const gen = /^\/api\/v1\/([a-zA-Z0-9._-]+)$/.exec(p);
    if (gen && req.method === 'POST') {
      const endpoint = gen[1];
      const body = await readBody(req);
      let payload = {};
      try { payload = JSON.parse(body.toString() || '{}'); } catch { return send(res, 400, { error: 'invalid JSON body' }); }
      const route = routeFor(endpoint, payload);
      if (!route && !cfg.providers.includes('mock') && !(cfg.allowPaid && (cfg.muapiKey || looksLikeMuapiKey(apiKeyOf(req))))) {
        return send(res, 404, { error: `freegen has no free route for '${endpoint}'. Paid passthrough is off (FREEGEN_ALLOW_PAID=1 enables it).` });
      }
      const job = createJob({ endpoint, payload, apiKey: apiKeyOf(req) });
      setImmediate(() => runJob(job, cfg).catch(e => updateJob(job.request_id, { status: 'failed', error: e.message })));
      return send(res, 200, { request_id: job.request_id, status: 'pending' });
    }

    // Everything else under MuAPI's other prefixes goes upstream (paid features).
    if (p.startsWith('/app/') || p.startsWith('/workflow/') || p.startsWith('/agents') || p.startsWith('/api/v1/')) {
      return passthrough(req, res, cfg, await readBody(req));
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(`[freegen] ${req.method} ${p} failed:`, e);
    return send(res, 500, { error: e.message });
  }
}

export function startServer(port = getConfig().port) {
  loadJobs();
  const server = http.createServer(handle);
  server.listen(port, '127.0.0.1');
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const cfg = getConfig();
  startServer(cfg.port);
  console.log(`[freegen] gateway listening on ${cfg.publicBase}  (data: ${DATA_DIR})`);
  console.log(`[freegen] providers: ${cfg.providers.join(' > ')}  comfy: ${cfg.comfyUrl || 'not set'}  muapi key: ${cfg.muapiKey ? 'yes' : 'no'}  gemini key: ${cfg.geminiKey ? 'yes' : 'no'}`);
}
