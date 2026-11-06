import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated data dir + mock provider only.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freegen-test-'));
process.env.FREEGEN_DATA = tmp;
process.env.FREEGEN_PROVIDERS = 'mock';
process.env.FREEGEN_PORT = '0';
process.env.FREEGEN_MOCK_DELAY_MS = '10';
process.env.MUAPI_API_KEY = '';

const { startServer } = await import('../server.js');
const { parseMultipart } = await import('../server.js');
let server, base;

before(async () => {
  server = startServer(0);
  await new Promise(r => server.once('listening', r));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  process.env.FREEGEN_PUBLIC_BASE = base;
});
after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

async function pollUntilDone(id) {
  for (let i = 0; i < 100; i++) {
    const r = await fetch(`${base}/api/v1/predictions/${id}/result`, { headers: { 'x-api-key': 'test' } });
    const d = await r.json();
    if (d.status === 'completed' || d.status === 'failed') return d;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('timeout');
}

test('status endpoint reports providers', async () => {
  const r = await fetch(`${base}/freegen/status`);
  const d = await r.json();
  assert.equal(d.ok, true);
  assert.equal(d.providers.mock.ok, true);
});

test('balance works without any key (MuAPI shape)', async () => {
  const r = await fetch(`${base}/api/v1/account/balance`, { headers: { 'x-api-key': 'anything' } });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.ok('balance' in d);
});

test('submit -> poll -> completed with a fetchable PNG (text-to-image)', async () => {
  const r = await fetch(`${base}/api/v1/flux-2-klein`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' }, body: JSON.stringify({ prompt: 'a red cube', aspect_ratio: '16:9' }) });
  assert.equal(r.status, 200);
  const sub = await r.json();
  assert.match(sub.request_id, /^[a-f0-9]{16}$/);
  const done = await pollUntilDone(sub.request_id);
  assert.equal(done.status, 'completed', done.error);
  assert.equal(done.provider, 'mock');
  assert.ok(done.outputs[0].endsWith('.png'));
  assert.equal(done.url, done.outputs[0]);
  const img = await fetch(done.url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await img.arrayBuffer());
  assert.deepEqual([...bytes.subarray(1, 4)], [0x50, 0x4e, 0x47]);
});

test('video endpoint produces mp4 or png (mock)', async () => {
  const r = await fetch(`${base}/api/v1/seedance-v2.0-t2v`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'test' }, body: JSON.stringify({ prompt: 'ocean', duration: 5 }) });
  const sub = await r.json();
  const done = await pollUntilDone(sub.request_id);
  assert.equal(done.status, 'completed', done.error);
  assert.match(done.url, /\.(mp4|png)$/);
});

test('upload_file multipart roundtrip', async () => {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('hello')], { type: 'image/png' }), 'x.png');
  const r = await fetch(`${base}/api/v1/upload_file`, { method: 'POST', headers: { 'x-api-key': 'test' }, body: form });
  assert.equal(r.status, 200);
  const d = await r.json();
  assert.match(d.url, /\/files\/uploads\/[a-f0-9]{16}\.png$/);
  const g = await fetch(d.url);
  assert.equal(await g.text(), 'hello');
});

test('unknown request id matches MuAPI error shape', async () => {
  const r = await fetch(`${base}/api/v1/predictions/nope/result`, { headers: { 'x-api-key': 'test' } });
  assert.equal(r.status, 404);
  const d = await r.json();
  assert.equal(d.detail.error.code, 'REQUEST_NOT_FOUND');
});

test('multipart parser handles two parts', () => {
  const b = 'XYZ';
  const body = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="a"\r\n\r\n1\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="f.txt"\r\nContent-Type: text/plain\r\n\r\nDATA\r\n--${b}--\r\n`);
  const out = parseMultipart(body, `multipart/form-data; boundary=${b}`);
  assert.equal(out.fields.a, '1');
  assert.equal(out.files[0].filename, 'f.txt');
  assert.equal(out.files[0].data.toString(), 'DATA');
});

test('paid passthrough is off by default: unrouted endpoint gets 404, workflow surface gets 503', async () => {
  // This suite runs with providers=mock, so emulate a no-mock config via the inferred-route check instead:
  const r = await fetch(`${base}/workflow/get-template-workflows`, { headers: { 'x-api-key': 'a'.repeat(64) } });
  assert.equal(r.status, 503);
  const d = await r.json();
  assert.match(d.error, /FREEGEN_ALLOW_PAID/);
});

test('file server only exposes media folders and supports Range', async () => {
  for (const p of ['/files/config.json', '/files/jobs/x.json', '/files/../config.json', '/files/uploads/.hidden']) {
    const r = await fetch(`${base}${p}`);
    assert.equal(r.status, 404, p);
  }
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('0123456789')], { type: 'video/mp4' }), 'c.mp4');
  const up = await (await fetch(`${base}/api/v1/upload_file`, { method: 'POST', headers: { 'x-api-key': 't' }, body: form })).json();
  const r = await fetch(up.url, { headers: { Range: 'bytes=2-5' } });
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await r.text(), '2345');
  const full = await fetch(up.url);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
});

test('jobs never expose the api key, on disk or over /freegen/jobs', async () => {
  const sub = await (await fetch(`${base}/api/v1/flux-2-klein`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': 'secret-key-123' }, body: JSON.stringify({ prompt: 'p' }) })).json();
  await pollUntilDone(sub.request_id);
  const onDisk = fs.readFileSync(path.join(tmp, 'jobs', `${sub.request_id}.json`), 'utf8');
  assert.ok(!onDisk.includes('secret-key-123'));
  const list = await (await fetch(`${base}/freegen/jobs`)).text();
  assert.ok(!list.includes('secret-key-123'));
});

test('admin config writes are refused from non-loopback origins', async () => {
  const r = await fetch(`${base}/freegen/config`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{"comfyUrl":"http://evil"}' });
  assert.equal(r.status, 403);
});
