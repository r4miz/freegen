// Local file store for uploads and outputs, plus "materialize": turn any
// reference the UI may hand us (our own /files URL, a data: URI, a remote
// http(s) URL) into bytes on disk that a provider can push to a backend.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.js';

const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/flac': 'flac',
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([m, e]) => [e, m]));
MIME_BY_EXT.jpeg = 'image/jpeg';

export function mimeFor(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  return MIME_BY_EXT[ext] || 'application/octet-stream';
}

export function extFor(mime, fallback = 'bin') {
  return EXT_BY_MIME[(mime || '').split(';')[0].trim()] || fallback;
}

function safeName(name) {
  return (name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

export function newId() {
  return crypto.randomBytes(8).toString('hex');
}

export function saveBuffer(kind, buffer, { ext, name } = {}) {
  const id = newId();
  const e = ext || (name ? path.extname(name).slice(1) : '') || 'bin';
  const filename = `${id}.${e}`;
  const abs = path.join(DATA_DIR, kind, filename);
  fs.writeFileSync(abs, buffer);
  return { id, filename, abs, rel: `${kind}/${filename}`, originalName: safeName(name) };
}

export function localPathForUrl(url, publicBase) {
  // Accept absolute (http://127.0.0.1:8787/files/uploads/x.png) or relative (/files/uploads/x.png)
  let p = url;
  if (publicBase && url.startsWith(publicBase)) p = url.slice(publicBase.length);
  const m = /^\/files\/(uploads|outputs|cache)\/([a-zA-Z0-9._-]+)$/.exec(p);
  if (!m) return null;
  const abs = path.join(DATA_DIR, m[1], m[2]);
  return fs.existsSync(abs) ? abs : null;
}

export async function materialize(ref, publicBase) {
  if (!ref || typeof ref !== 'string') throw new Error('empty file reference');
  if (ref.startsWith('data:')) {
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(ref);
    if (!m) throw new Error('malformed data URI');
    const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    const saved = saveBuffer('cache', buf, { ext: extFor(m[1]) });
    return { abs: saved.abs, filename: saved.filename, mime: m[1] || 'application/octet-stream' };
  }
  const local = localPathForUrl(ref, publicBase);
  if (local) return { abs: local, filename: path.basename(local), mime: mimeFor(local) };
  if (/^https?:\/\//.test(ref)) {
    const res = await fetch(ref);
    if (!res.ok) throw new Error(`download failed ${res.status} for ${ref}`);
    const mime = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer());
    const urlExt = path.extname(new URL(ref).pathname).slice(1);
    const saved = saveBuffer('cache', buf, { ext: extFor(mime, urlExt || 'bin') });
    return { abs: saved.abs, filename: saved.filename, mime: mime || mimeFor(saved.abs) };
  }
  throw new Error(`unsupported file reference: ${ref.slice(0, 60)}`);
}

export function publicUrl(rel, publicBase) {
  return `${publicBase}/files/${rel}`;
}

// Only the three media folders are servable; config.json and jobs/ never are.
export function readLocal(rel) {
  const m = /^(uploads|outputs|cache)\/([a-zA-Z0-9._-]+)$/.exec(rel || '');
  if (!m || m[2].startsWith('.')) return null;
  const abs = path.join(DATA_DIR, m[1], m[2]);
  return fs.existsSync(abs) ? abs : null;
}

// Read pixel dimensions from PNG / JPEG / WebP headers without decoding.
export function imageSize(abs) {
  const fd = fs.openSync(abs, 'r');
  try {
    const head = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    const b = head.subarray(0, n);
    if (b.length > 24 && b.toString('ascii', 1, 4) === 'PNG') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    if (b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
      const fmt = b.toString('ascii', 12, 16);
      if (fmt === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L') { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
      if (fmt === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const marker = b[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        i += 2 + b.readUInt16BE(i + 2);
      }
    }
  } finally { fs.closeSync(fd); }
  return null;
}
