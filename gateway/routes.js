// Endpoint routing: maps every MuAPI endpoint the Open-Generative-AI UI can
// call to (a) the kind of job, (b) the ordered list of ComfyUI workflows that
// can serve it, and (c) how to normalize the payload. Anything not listed
// falls through to the MuAPI passthrough (paid) when a key exists.
//
// Workflow names refer to comfy/workflows/manifest.json.

const IMG_FAST = ['flux2_klein_t2i', 'qwen21_t2i', 'sd15_t2i'];
const IMG_QUALITY = ['qwen21_t2i', 'flux2_klein_t2i', 'sd15_t2i'];
const EDIT_QUALITY = ['qwen21_edit', 'flux2_klein_edit'];
const EDIT_FAST = ['flux2_klein_edit', 'qwen21_edit'];
const T2V_AUDIO = ['ltx25_t2v', 'ltx2_t2v_distilled', 'wan22_14b_t2v', 'wan22_5b_t2v'];
const T2V_WAN = ['wan22_5b_t2v', 'wan22_14b_t2v', 'ltx25_t2v', 'ltx2_t2v_distilled'];
const I2V_AUDIO = ['ltx25_i2v', 'ltx2_i2v_distilled', 'wan22_14b_i2v', 'wan22_5b_i2v'];
const I2V_WAN = ['wan22_5b_i2v', 'wan22_14b_i2v', 'ltx25_i2v', 'ltx2_i2v_distilled'];
const FLF = ['ltx25_flf2v', 'wan22_14b_flf2v'];
const LIPSYNC_IMG = ['infinitetalk_i2v', 'wan22_s2v'];

const routes = new Map();
function add(endpoints, spec) { for (const e of endpoints) routes.set(e, { endpoint: e, ...spec }); }

// ── Text to image ────────────────────────────────────────────────────────────
add(['nano-banana', 'nano-banana-2'], { kind: 'image', workflows: IMG_QUALITY, gemini: true });
add(['nano-banana-pro'], { kind: 'image', workflows: IMG_QUALITY, gemini: true });
add(['flux-2-klein', 'flux-2-klein-4b', 'flux-2-klein-9b', 'flux-schnell-image', 'z-image-turbo', 'z-image-base', 'sdxl-image',
  'hidream-i1-fast', 'flux-dev-image', 'flux-dev-lora', 'flux-krea-dev', 'chroma-image', 'perfect-pony-xl', 'neta-lumina',
  'ai-anime-generator', 'wan2.1-text-to-image', 'leonardoai-phoenix-1.0', 'leonardoai-lucid-origin', 'google-imagen4-fast',
  'flux-pulid', 'flux-redux', 'flux-kontext-dev-t2i', 'minimax-image-01'], { kind: 'image', workflows: IMG_FAST });
add(['qwen-image', 'qwen-text-to-image-2512', 'flux-2-dev', 'flux-2-flex', 'flux-2-pro', 'flux-kontext-pro-t2i', 'flux-kontext-max-t2i',
  'hidream-i1-dev', 'hidream-i1-full', 'gpt4o-text-to-image', 'gpt-image-1.5', 'gpt-image-2-text-to-image', 'gpt-image-2',
  'midjourney-v7-text-to-image', 'bytedance-seedream-v3', 'bytedance-seedream-v4', 'bytedance-seedream-v4.5', 'ideogram-v3-t2i',
  'google-imagen4', 'google-imagen4-ultra', 'hunyuan-image-2.1', 'hunyuan-image-3.0', 'wan2.5-text-to-image', 'wan2.6-text-to-image',
  'reve-text-to-image', 'grok-imagine-text-to-image', 'kling-o1-text-to-image', 'vidu-q2-text-to-image', 'seedream-5.0'], { kind: 'image', workflows: IMG_QUALITY });

// ── Image edit / image to image ──────────────────────────────────────────────
add(['nano-banana-edit', 'nano-banana-pro-edit', 'nano-banana-effects', 'nano-banana-2-edit'], { kind: 'edit', workflows: EDIT_QUALITY, gemini: true });
add(['qwen-image-edit', 'qwen-image-edit-plus', 'qwen-image-edit-plus-lora', 'gpt4o-edit', 'gpt4o-image-to-image', 'bytedance-seededit-image',
  'bytedance-seedream-edit-v4', 'wan2.5-image-edit', 'reve-image-edit', 'kling-o1-edit-image', 'flux-2-dev-edit', 'flux-2-flex-edit', 'flux-2-pro-edit',
  'flux-kontext-pro-i2i', 'flux-kontext-max-i2i', 'midjourney-v7-image-to-image', 'midjourney-v7-style-reference', 'midjourney-v7-omni-reference',
  'minimax-01-subject-reference', 'ideogram-character', 'ideogram-v3-reframe', 'vidu-q2-reference-to-image', 'ai-product-photography',
  'ai-product-shot', 'ai-dress-change', 'ai-skin-enhancer', 'ai-color-photo', 'ai-ghibli-style', 'ai-object-eraser', 'ai-image-extension',
  'image-effects', 'flux-kontext-effects', 'ai-image-face-swap', 'bytedance-seedream-v4.5-edit', 'seedream-5.0-edit', 'qwen-image-edit-2511', 'wan2.6-image-edit',
  'gpt-image-2-image-to-image', 'gpt-image-1.5-edit', 'grok-imagine-image-to-image', 'Api Node'], { kind: 'edit', workflows: EDIT_QUALITY });
add(['flux-kontext-dev-i2i', 'flux-redux-edit', 'image-passthrough', 'flux-2-klein-4b-edit', 'flux-2-klein-9b-edit', 'add-image-watermark'], { kind: 'edit', workflows: EDIT_FAST });
add(['ai-background-remover'], { kind: 'edit', workflows: ['qwen21_bgremove', 'qwen21_edit'], promptDefault: 'Remove the background completely, keep the subject, output on a transparent background.' });
add(['ai-image-upscale', 'topaz-image-upscale', 'seedvr2-image-upscale'], { kind: 'edit', workflows: ['seedvr2_image'] });

// ── Text to video ────────────────────────────────────────────────────────────
add(['wan2.2-5b-fast-t2v', 'wan2.2-text-to-video', 'wan2.1-text-to-video', 'wan2.5-text-to-video', 'wan2.5-text-to-video-fast', 'wan2.6-text-to-video',
  'hunyuan-text-to-video', 'hunyuan-fast-text-to-video'], { kind: 'video', workflows: T2V_WAN });
add(['seedance-lite-t2v', 'seedance-pro-t2v', 'seedance-pro-t2v-fast', 'seedance-v1.5-pro-t2v', 'seedance-v1.5-pro-t2v-fast', 'seedance-v2.0-t2v',
  'kling-v2.1-master-t2v', 'kling-v2.5-turbo-pro-t2v', 'kling-v2.6-pro-t2v', 'kling-o1-text-to-video', 'kling-v3.0-pro-text-to-video', 'kling-v3.0-standard-text-to-video',
  'veo3-text-to-video', 'veo3-fast-text-to-video', 'veo3.1-text-to-video', 'veo3.1-fast-text-to-video', 'veo3.1-lite-text-to-video',
  'runway-text-to-video', 'pixverse-v4.5-t2v', 'pixverse-v5-t2v', 'pixverse-v5.5-t2v', 'minimax-hailuo-02-standard-t2v', 'minimax-hailuo-02-pro-t2v',
  'minimax-hailuo-2.3-pro-t2v', 'minimax-hailuo-2.3-standard-t2v', 'openai-sora', 'openai-sora-2-text-to-video', 'openai-sora-2-pro-text-to-video',
  'vidu-v2.0-t2v', 'vidu-q1-t2v', 'vidu-q2-t2v', 'ltx-2-pro-text', 'ltx-2-fast-text', 'ltx-2.3-text-to-video', 'grok-imagine-text-to-video',
  'ovi-text-to-video', 'seedance-v2.0-extend', 'ltx-2-pro-text-to-video', 'ltx-2-fast-text-to-video', 'ltx-2-19b-text-to-video'], { kind: 'video', workflows: T2V_AUDIO });

// ── Image to video ───────────────────────────────────────────────────────────
add(['wan2.1-image-to-video', 'wan2.2-image-to-video', 'wan2.5-image-to-video', 'wan2.5-image-to-video-fast', 'wan2.6-image-to-video', 'hunyuan-image-to-video',
  'wan2.1-reference-video', 'generate_wan_ai_effects', 'video-effects'], { kind: 'i2v', workflows: I2V_WAN });
add(['veo3-image-to-video', 'veo3-fast-image-to-video', 'veo3.1-image-to-video', 'veo3.1-fast-image-to-video', 'veo3.1-lite-image-to-video', 'veo3.1-reference-to-video',
  'runway-image-to-video', 'midjourney-v7-image-to-video', 'kling-v2.1-master-i2v', 'kling-v2.1-standard-i2v', 'kling-v2.1-pro-i2v',
  'kling-v2.5-turbo-pro-i2v', 'kling-v2.6-pro-i2v', 'kling-o1-image-to-video', 'kling-v3.0-pro-image-to-video', 'kling-v3.0-standard-image-to-video',
  'pixverse-v4.5-i2v', 'pixverse-v5-i2v', 'pixverse-v5.5-i2v', 'vidu-v2.0-i2v', 'vidu-q1-reference', 'vidu-q2-i2v', 'minimax-hailuo-02-standard-i2v',
  'minimax-hailuo-02-pro-i2v', 'minimax-hailuo-2.3-pro-i2v', 'minimax-hailuo-2.3-standard-i2v', 'seedance-lite-i2v', 'seedance-pro-i2v', 'seedance-pro-i2v-fast',
  'seedance-lite-reference-to-video', 'seedance-v1.5-pro-i2v', 'seedance-v2.0-i2v', 'openai-sora-2-image-to-video', 'openai-sora-2-pro-image-to-video',
  'ovi-image-to-video', 'leonardoai-motion-2.0', 'ltx-2-pro-image', 'ltx-2-fast-image', 'ltx-2.3-image-to-video', 'grok-imagine-image-to-video',
  'ltx-2-pro-image-to-video', 'ltx-2-fast-image-to-video', 'ltx-2-19b-image-to-video', 'vidu-q2-reference', 'vidu-q2-turbo-start-end-video', 'vidu-q2-pro-start-end-video',
  'minimax-hailuo-2.3-fast', 'kling-v2.5-turbo-std-i2v', 'kling-o1-reference-to-video', 'wan2.2-spicy-image-to-video', 'kling-o1-standard-image-to-video',
  'kling-o1-standard-reference-to-video', 'seedance-v1.5-pro-i2v-fast'],
  { kind: 'i2v', workflows: I2V_AUDIO });

// ── Lip sync / speech to video ───────────────────────────────────────────────
add(['infinitetalk-image-to-video', 'ltx-2.3-lipsync', 'ltx-2-19b-lipsync', 'veed-lipsync', 'creatify-lipsync', 'sync-lipsync'], { kind: 'lipsync', workflows: LIPSYNC_IMG });
add(['wan2.2-speech-to-video'], { kind: 'lipsync', workflows: ['wan22_s2v', 'infinitetalk_i2v'] });

// ── Video utilities ──────────────────────────────────────────────────────────
add(['ai-video-upscale', 'seedvr2-video-upscale', 'topaz-video-upscale'], { kind: 'v2v', workflows: ['seedvr2_video'] });

// Endpoints not in the explicit table (the UI adds new vendor models every few
// weeks) are classified from their name and, when given, the payload shape.
const has = (e, ...words) => words.some(w => e.includes(w));
export function inferRoute(endpoint, payload = {}) {
  const e = endpoint.toLowerCase();
  const p = payload || {};
  const hasImage = !!(p.image_url || p.first_image_url || p.first_frame_url || p.reference_image_url || p.start_image_url || (p.images_list && p.images_list.length) || (p.image_urls && p.image_urls.length) || (p.reference_images && p.reference_images.length));
  const hasVideo = !!(p.video_url || (Array.isArray(p.video_files) && p.video_files.length));
  const hasAudio = !!p.audio_url;
  if (has(e, 'music', 'suno', 'speech-2', 'tts', 'voice-clone', 'sound-effect', 'mmaudio')) return null;              // audio stays paid
  if (has(e, 'motion-control', 'recast', 'watermark', 'clipping', 'motion-graphics', 'video-to-video', 'v2v')) return null; // true video-to-video stays paid
  if (has(e, 'upscale', 'enhance-video')) return hasVideo || has(e, 'video') ? { kind: 'v2v', workflows: ['seedvr2_video'] } : { kind: 'edit', workflows: ['seedvr2_image'] };
  if (has(e, 'lipsync', 'lip-sync', 'talk', 'speech-to-video', 's2v', 'avatar', 'dubbing')) return hasVideo ? null : { kind: 'lipsync', workflows: LIPSYNC_IMG };
  if (hasAudio && hasImage) return { kind: 'lipsync', workflows: LIPSYNC_IMG };
  if (has(e, 'background-remov', 'remove-bg', 'rembg')) return { kind: 'edit', workflows: ['qwen21_bgremove', 'qwen21_edit'], promptDefault: 'Remove the background completely, keep the subject, output on a transparent background.' };
  const i2vName = has(e, 'image-to-video', 'i2v', 'reference-to-video', 'start-end', 'first-last', 'flf2v', '-animate', 'video-effects', 'omni-reference');
  const t2vName = has(e, 'text-to-video', 't2v', '-extend', 'extend-') || (e.endsWith('-video') && !has(e, 'image'));
  const videoFamily = has(e, 'seedance', 'veo', 'sora', 'kling-v', 'hailuo', 'pixverse', 'vidu', 'runway', 'ltx', 'happy-horse', 'wan3', 'minimax-h', 'hunyuan-video', 'sd-2-vip', 'imagine-video', 'video-1', 'video-2', 'video-3')
    && !has(e, 'image', 't2i', 'character', 'edit', 'lipsync');
  if (i2vName) return hasVideo ? null : { kind: 'i2v', workflows: has(e, 'wan', 'hunyuan') ? I2V_WAN : I2V_AUDIO };
  if (t2vName || videoFamily) {
    if (hasVideo) return null;
    return hasImage ? { kind: 'i2v', workflows: has(e, 'wan', 'hunyuan') ? I2V_WAN : I2V_AUDIO } : { kind: 'video', workflows: has(e, 'wan', 'hunyuan') ? T2V_WAN : T2V_AUDIO };
  }
  const editish = has(e, 'edit', 'image-to-image', 'i2i', 'inpaint', 'outpaint', 'reframe', 'expand', 'character', 'reference', 'swap', 'try-on', 'tryon', 'stylist', 'expression', 'relight', 'restore', 'colorize', 'eraser', 'remov', 'change', 'effect');
  if (editish || hasImage) return { kind: 'edit', workflows: has(e, 'klein', 'turbo', 'flash', 'schnell', 'lite', 'fast') ? EDIT_FAST : EDIT_QUALITY };
  if (has(e, 'image', 't2i', 'imagen', 'midjourney', 'ideogram', 'seedream', 'flux', 'krea', 'hidream', 'z-image', 'qwen', 'muse', 'banana', 'gpt', 'grok', 'kling-o', 'photo', 'art', 'anime', 'logo', 'poster', 'portrait', 'headshot', 'avatar-image'))
    return { kind: 'image', workflows: has(e, 'klein', 'turbo', 'flash', 'schnell', 'lite', 'fast') ? IMG_FAST : IMG_QUALITY };
  if (p.prompt && !hasVideo) return { kind: 'image', workflows: IMG_QUALITY };
  return null;
}

export function routeFor(endpoint, payload) {
  const exact = routes.get(endpoint);
  if (exact) return exact;
  const inferred = inferRoute(endpoint, payload);
  if (!inferred) return null;
  return { endpoint, inferred: true, ...inferred, gemini: endpoint.startsWith('nano-banana') || endpoint.startsWith('gemini') };
}
export function allRoutes() { return [...routes.values()]; }

// Normalize the UI payload into the parameters providers understand.
export function normalizeParams(route, payload) {
  const p = payload || {};
  const files = {};
  const asList = v => Array.isArray(v) ? v.filter(Boolean) : (typeof v === 'string' && v ? [v] : []);
  const list = [...asList(p.images_list), ...asList(p.image_urls), ...asList(p.reference_images)];
  const image = p.image_url || p.first_image_url || p.first_frame_url || p.reference_image_url || p.start_image_url || list[0] || null;
  if (image) files.image = image;
  const others = list.filter(u => u !== image);
  if (others[0]) files.image2 = others[0];
  if (list.length) files.images = list;
  const last = p.last_image || p.last_image_url || p.end_image_url || p.last_frame_url || p.end_image || null;
  if (last) files.last_image = last;
  if (p.audio_url) files.audio = p.audio_url;
  if (p.video_url) files.video = p.video_url;
  return {
    prompt: (p.prompt && String(p.prompt)) || route.promptDefault || '',
    negative: p.negative_prompt,
    aspect_ratio: p.aspect_ratio || (route.kind === 'image' || route.kind === 'edit' ? '1:1' : '16:9'),
    resolution: p.resolution || p.quality || null,
    duration: Number(p.duration || p.duration_seconds || 5),
    seed: p.seed && p.seed !== -1 ? Number(p.seed) : undefined,
    files,
    wantsLastFrame: !!last,
  };
}

// Pick the workflow list for a route given the concrete request (e.g. first+last frame).
export function workflowsFor(route, params) {
  if (route.kind === 'i2v' && params.wantsLastFrame) return [...FLF, ...route.workflows];
  return route.workflows;
}
