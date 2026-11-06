// Google Gemini image provider ("Nano Banana"). Needs a key on a billed
// project: Google's free API tier no longer includes image models. Kept as an
// optional exact-match path for nano-banana* endpoints.
import fs from 'node:fs';

const MODEL_FOR = {
  'nano-banana': 'gemini-2.5-flash-image',
  'nano-banana-edit': 'gemini-2.5-flash-image',
  'nano-banana-effects': 'gemini-2.5-flash-image',
  'nano-banana-2': 'gemini-3.1-flash-image-preview',
  'nano-banana-2-edit': 'gemini-3.1-flash-image-preview',
  'nano-banana-pro': 'gemini-3-pro-image-preview',
  'nano-banana-pro-edit': 'gemini-3-pro-image-preview',
};

export function geminiModelFor(endpoint) { return MODEL_FOR[endpoint] || null; }

export function createGeminiProvider() {
  return {
    name: 'gemini',
    async status(cfg) {
      if (!cfg.geminiKey) return { ok: false, reason: 'no GEMINI_API_KEY' };
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image?key=${cfg.geminiKey}`);
      return r.ok ? { ok: true } : { ok: false, reason: `gemini ${r.status}` };
    },
    async canHandle(cfg, route, ctx) {
      if (!cfg.geminiKey) return { ok: false, reason: 'no GEMINI_API_KEY' };
      const model = geminiModelFor(ctx.endpoint);
      return model ? { ok: true, model } : { ok: false, reason: 'not a Gemini endpoint' };
    },
    async run(cfg, ctx, route, choice) {
      const parts = [{ text: ctx.params.prompt || '' }];
      const refs = [ctx.params.files?.image, ...(ctx.params.files?.images || [])].filter(Boolean);
      for (const ref of refs) {
        const f = await ctx.materialize(ref);
        parts.push({ inlineData: { mimeType: f.mime, data: fs.readFileSync(f.abs).toString('base64') } });
      }
      const body = {
        contents: [{ parts }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: ctx.params.aspect_ratio || '1:1' } },
      };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${choice.model}:generateContent?key=${cfg.geminiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(`Gemini ${res.status}: ${data.error?.message || ''}`.slice(0, 300));
      const outs = [];
      for (const p of data.candidates?.[0]?.content?.parts || []) {
        if (p.inlineData) outs.push(ctx.saveOutput(Buffer.from(p.inlineData.data, 'base64'), p.inlineData.mimeType.includes('jpeg') ? 'jpg' : 'png'));
      }
      if (!outs.length) throw new Error('Gemini returned no image');
      return { outputs: outs, model: choice.model };
    },
  };
}
