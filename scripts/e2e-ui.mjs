// End-to-end: drive the real Open-Generative-AI UI (Next dev server) against
// the freegen gateway and assert a generated image shows up.
// Usage: UI_URL=http://127.0.0.1:3000 node scripts/e2e-ui.mjs [--video]
import { chromium } from 'playwright';
import fs from 'node:fs';

const UI = process.env.UI_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(`${UI}/studio`, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.setItem('muapi_key', 'freegen-local'));
await page.goto(`${UI}/studio`, { waitUntil: 'networkidle' });

// Dismiss any API-key modal if it still shows.
const keyInput = page.locator('input[type="password"], input[placeholder*="key" i]').first();
if (await keyInput.isVisible().catch(() => false)) {
  await keyInput.fill('freegen-local');
  await page.getByRole('button', { name: /save|continue|start|submit/i }).first().click().catch(() => {});
}

const ta = page.locator('textarea').first();
await ta.waitFor({ timeout: 60000 });
await ta.fill('A red cube on a white table, studio lighting');
fs.mkdirSync('data/e2e', { recursive: true });
await page.screenshot({ path: 'data/e2e/01-before.png' });

const gen = page.getByRole('button', { name: /^generate/i }).first();
await gen.click();
const img = page.locator('img[src*="/files/outputs/"]').first();
await img.waitFor({ timeout: 90000 });
const src = await img.getAttribute('src');
await page.screenshot({ path: 'data/e2e/02-after.png' });
console.log('generated image shown:', src);

// Confirm the gateway really served it.
const res = await fetch(src.startsWith('http') ? src : `${UI}${src}`);
console.log('image fetch status:', res.status, res.headers.get('content-type'));
if (res.status !== 200) process.exitCode = 1;
if (errors.length) console.log('console errors (first 5):', errors.slice(0, 5));
await browser.close();
