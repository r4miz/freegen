// Mock provider: produces a real PNG (and, when ffmpeg exists, a real MP4)
// without any model. Used by the test-suite and for demoing the UI wiring
// before a GPU backend is attached. Enable with FREEGEN_MOCK=1.
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function makePng(width, height, rgb = [34, 211, 238]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) { row[1 + x * 3] = rgb[0]; row[2 + x * 3] = rgb[1]; row[3 + x * 3] = rgb[2]; }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function hasFfmpeg() { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } }

export function createMockProvider() {
  return {
    name: 'mock',
    async status() { return { ok: true, ffmpeg: hasFfmpeg() }; },
    async canHandle(cfg, route) { return { ok: true, kind: route.kind }; },
    async run(cfg, ctx, route, choice) {
      await new Promise(r => setTimeout(r, Number(process.env.FREEGEN_MOCK_DELAY_MS || 300)));
      if (['video', 'i2v', 'lipsync', 'v2v'].includes(route.kind) && hasFfmpeg()) {
        const tmp = path.join(os.tmpdir(), `freegen-mock-${ctx.jobId}.mp4`);
        execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=0x22d3ee:s=320x180:d=1', '-pix_fmt', 'yuv420p', tmp], { stdio: 'ignore' });
        const buf = fs.readFileSync(tmp); fs.unlinkSync(tmp);
        return { outputs: [ctx.saveOutput(buf, 'mp4')] };
      }
      return { outputs: [ctx.saveOutput(makePng(64, 64), 'png')] };
    },
  };
}
