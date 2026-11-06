// MuAPI passthrough provider: the paid fallback. Re-uploads any local file
// references to MuAPI first (their servers cannot reach 127.0.0.1), then
// submits and polls exactly like the UI would have.
import fs from 'node:fs';

const FILE_FIELDS = ['image_url', 'images_list', 'audio_url', 'video_url', 'last_image_url', 'end_image_url', 'first_image_url', 'video_files', 'reference_image_url', 'mask_url'];

async function uploadToMuapi(cfg, key, file) {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(file.abs)], { type: file.mime }), file.filename);
  const res = await fetch(`${cfg.muapiBase}/api/v1/upload_file`, { method: 'POST', headers: { 'x-api-key': key }, body: form });
  if (!res.ok) throw new Error(`muapi upload failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.url || data.file_url || data.data?.url;
}

function isLocalRef(v, cfg) {
  return typeof v === 'string' && (v.startsWith('data:') || v.startsWith(cfg.publicBase) || v.startsWith('/files/'));
}

export function createMuapiProvider() {
  return {
    name: 'muapi',
    async status(cfg) {
      if (!cfg.muapiKey) return { ok: false, reason: 'no MuAPI key (env MUAPI_API_KEY or keychain muapi-cli)' };
      try {
        const r = await fetch(`${cfg.muapiBase}/api/v1/account/balance`, { headers: { 'x-api-key': cfg.muapiKey } });
        if (!r.ok) return { ok: false, reason: `balance ${r.status}` };
        const b = await r.json();
        return { ok: true, balance: b.balance, currency: b.currency };
      } catch (e) { return { ok: false, reason: e.message }; }
    },
    async canHandle(cfg, route, ctx) {
      const key = ctx?.apiKeyLooksReal ? ctx.apiKey : cfg.muapiKey;
      return key ? { ok: true, key } : { ok: false, reason: 'no MuAPI key' };
    },
    async run(cfg, ctx, route, choice) {
      const key = choice.key;
      const payload = structuredClone(ctx.rawPayload);
      for (const f of FILE_FIELDS) {
        const v = payload[f];
        if (Array.isArray(v)) {
          payload[f] = [];
          for (const item of v) payload[f].push(isLocalRef(item, cfg) ? await uploadToMuapi(cfg, key, await ctx.materialize(item)) : item);
        } else if (isLocalRef(v, cfg)) {
          payload[f] = await uploadToMuapi(cfg, key, await ctx.materialize(v));
        }
      }
      const res = await fetch(`${cfg.muapiBase}/api/v1/${ctx.endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': key }, body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`MuAPI ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const sub = await res.json();
      const rid = sub.request_id || sub.id;
      if (!rid) {
        const url = sub.outputs?.[0] || sub.url || sub.output?.url;
        return { outputs: url ? [url] : [], raw: sub };
      }
      ctx.log(`muapi request_id ${rid}`);
      for (let i = 0; i < 1800; i++) {
        await new Promise(r => setTimeout(r, cfg.pollIntervalMs));
        const pr = await fetch(`${cfg.muapiBase}/api/v1/predictions/${rid}/result`, { headers: { 'x-api-key': key } });
        if (pr.status >= 500) continue;
        if (!pr.ok) throw new Error(`MuAPI poll ${pr.status}: ${(await pr.text()).slice(0, 200)}`);
        const data = await pr.json();
        const st = (data.status || '').toLowerCase();
        if (['completed', 'succeeded', 'success'].includes(st)) {
          const outs = data.outputs?.length ? data.outputs : [data.url || data.output?.url].filter(Boolean);
          return { outputs: outs, raw: data };
        }
        if (['failed', 'error'].includes(st)) throw new Error(`MuAPI failed: ${data.error || 'unknown'}`);
      }
      throw new Error('MuAPI job timed out');
    },
  };
}
