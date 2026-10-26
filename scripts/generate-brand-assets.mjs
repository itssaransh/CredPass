/**
 * Generates the raster brand assets from the SVG masters in /public.
 *
 *   npm run brand:assets
 *
 * Requires Playwright's Chromium (npm run brand:assets:install once per machine).
 */
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const faviconSvg = await readFile(path.join(publicDir, 'favicon.svg'), 'utf8');
const maskableSvg = await readFile(path.join(publicDir, 'icon-maskable.svg'), 'utf8');

const pageFor = (size) => `
<!doctype html>
<html>
  <head>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
      svg { display: block; width: 100%; height: 100%; }
    </style>
  </head>
  <body>${size}</body>
</html>`;

function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, buffer }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(buffer.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += buffer.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map(({ buffer }) => buffer)]);
}

function mark(id) {
  return `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffe066"/>
        <stop offset="0.55" stop-color="#fcd535"/>
        <stop offset="1" stop-color="#f0b90b"/>
      </linearGradient>
    </defs>
    <path d="M32 7.2 53.5 15.4v15.4c0 13-9.3 23.6-21.5 27.6C19.8 54.4 10.5 43.8 10.5 30.8V15.4L32 7.2Z" fill="url(#${id})"/>
    <path d="m22 32.3 6.6 6.6L42.6 23.4" fill="none" stroke="#0b0e11" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

const ogHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1200px; height: 630px; overflow: hidden; }
  body {
    position: relative;
    background: #0b0e11;
    color: #eaecef;
    font-family: "Segoe UI", Inter, system-ui, -apple-system, Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .glow-a, .glow-b { position: absolute; border-radius: 50%; }
  .glow-a { width: 720px; height: 720px; right: -160px; top: -320px; background: radial-gradient(circle, rgba(252,213,53,.16), transparent 62%); }
  .glow-b { width: 520px; height: 520px; left: -220px; bottom: -300px; background: radial-gradient(circle, rgba(252,213,53,.07), transparent 65%); }
  .grid {
    position: absolute; inset: 0;
    background-image: linear-gradient(rgba(255,255,255,.032) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.032) 1px, transparent 1px);
    background-size: 44px 44px;
    -webkit-mask-image: radial-gradient(ellipse at 62% 38%, #000 0%, transparent 72%);
    mask-image: radial-gradient(ellipse at 62% 38%, #000 0%, transparent 72%);
  }
  .frame { position: absolute; inset: 34px; border: 1px solid rgba(255,255,255,.055); border-radius: 26px; }
  .content { position: relative; display: flex; height: 100%; padding: 64px 70px; }
  .left { width: 610px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand .mark { width: 46px; height: 46px; display: block; }
  .brand-name { color: #fcd535; font-size: 31px; font-weight: 800; letter-spacing: -.03em; line-height: 1; }
  .brand-divider { width: 1px; height: 26px; background: rgba(255,255,255,.12); margin: 0 4px; }
  .brand-sub { color: #707a8a; font-size: 12px; font-weight: 700; letter-spacing: .2em; }
  h1 { margin: 54px 0 0; font-size: 76px; line-height: .96; letter-spacing: -.05em; font-weight: 800; color: #fff; }
  h1 .gold { color: #fcd535; }
  p { margin: 26px 0 0; max-width: 560px; color: #929aa5; font-size: 21px; line-height: 1.48; letter-spacing: -.005em; }
  .pills { display: flex; gap: 10px; margin-top: 28px; flex-wrap: wrap; }
  .pill { border: 1px solid rgba(252,213,53,.28); background: rgba(252,213,53,.07); color: #fcd535; padding: 9px 14px; border-radius: 999px; font-size: 14px; font-weight: 600; letter-spacing: .01em; }
  .pill.muted { border-color: rgba(255,255,255,.1); background: rgba(255,255,255,.03); color: #929aa5; }
  .foot { margin-top: auto; display: flex; align-items: center; gap: 10px; color: #707a8a; font-size: 15px; letter-spacing: .01em; }
  .foot .dot { width: 8px; height: 8px; border-radius: 50%; background: #0ecb81; box-shadow: 0 0 14px rgba(14,203,129,.8); }
  .foot b { color: #929aa5; font-weight: 600; }

  .right { position: relative; flex: 1; }
  .ring { position: absolute; width: 500px; height: 500px; border-radius: 50%; border: 1px dashed rgba(252,213,53,.16); right: -30px; top: 30px; }
  .ring.two { width: 410px; height: 410px; right: 36px; top: 76px; border-style: solid; border-color: rgba(255,255,255,.05); }
  .card {
    position: absolute; width: 358px; height: 448px; right: 18px; top: 68px;
    transform: rotate(5deg);
    border-radius: 28px;
    background: linear-gradient(155deg, #242b34 0%, #171c22 52%, #12161b 100%);
    border: 1px solid rgba(252,213,53,.34);
    box-shadow: 0 46px 90px rgba(0,0,0,.6), inset 0 1px 0 rgba(255,255,255,.06);
    padding: 28px;
    overflow: hidden;
  }
  .card:before { content: ""; position: absolute; width: 300px; height: 300px; right: -90px; top: -110px; border-radius: 50%; background: radial-gradient(circle, rgba(252,213,53,.2), transparent 66%); }
  .card:after { content: ""; position: absolute; inset: 0; border-radius: 28px; background: linear-gradient(115deg, rgba(255,255,255,.06), transparent 35%); pointer-events: none; }
  .card-top { position: relative; display: flex; align-items: center; justify-content: space-between; color: #929aa5; font-size: 10px; font-weight: 700; letter-spacing: .2em; }
  .card-top .chip { width: 36px; height: 26px; border-radius: 6px; background: linear-gradient(135deg, #fcd535, #b8860b); opacity: .8; }
  .card .mark { position: relative; width: 54px; height: 54px; margin-top: 40px; display: block; }
  .tier-label { position: relative; margin-top: 26px; color: #707a8a; font-size: 10px; font-weight: 700; letter-spacing: .22em; }
  .tier { position: relative; margin-top: 2px; color: #fcd535; font-size: 68px; font-weight: 800; line-height: 1; letter-spacing: -.05em; }
  .verified { position: relative; display: inline-flex; align-items: center; gap: 7px; margin-top: 12px; color: #0ecb81; font-size: 13px; font-weight: 600; }
  .verified .check { width: 16px; height: 16px; border-radius: 50%; background: rgba(14,203,129,.15); display: inline-flex; align-items: center; justify-content: center; }
  .verified .check svg { width: 9px; height: 9px; }
  .bar { position: relative; margin-top: 30px; height: 7px; background: rgba(255,255,255,.08); border-radius: 999px; overflow: hidden; }
  .bar > span { display: block; height: 100%; width: 84%; border-radius: 999px; background: linear-gradient(90deg, #f0b90b, #fcd535); }
  .meta { position: relative; display: flex; justify-content: space-between; margin-top: 10px; color: #707a8a; font-size: 11px; letter-spacing: .02em; }
  .card-foot { position: absolute; left: 28px; right: 28px; bottom: 26px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,.08); display: flex; align-items: flex-end; justify-content: space-between; }
  .card-foot .label { color: #707a8a; font-size: 9px; font-weight: 700; letter-spacing: .16em; }
  .card-foot .value { color: #eaecef; font-size: 16px; font-weight: 700; margin-top: 4px; letter-spacing: -.01em; }
  .card-foot .value span { color: #707a8a; font-size: 11px; font-weight: 600; }
</style>
</head>
<body>
  <div class="glow-a"></div>
  <div class="glow-b"></div>
  <div class="grid"></div>
  <div class="frame"></div>
  <div class="content">
    <div class="left">
      <div class="brand">
        ${mark('og-head')}
        <span class="brand-name">CredPass</span>
        <span class="brand-divider"></span>
        <span class="brand-sub">CREDIT PASSPORT</span>
      </div>
      <h1>Prove Credit.<br><span class="gold">Keep Control.</span></h1>
      <p>A privacy-first credit passport. Prove your tier with EIP-712 signed credentials — no raw financial data on-chain.</p>
      <div class="pills">
        <span class="pill">EIP-712 signed</span>
        <span class="pill">Tier A · B · C</span>
        <span class="pill muted">No raw data on-chain</span>
      </div>
      <div class="foot"><span class="dot"></span><b>Live</b> credpass.credpass-app.workers.dev</div>
    </div>
    <div class="right">
      <div class="ring"></div>
      <div class="ring two"></div>
      <div class="card">
        <div class="card-top"><span>CREDIT PASSPORT</span><span class="chip"></span></div>
        ${mark('og-card')}
        <div class="tier-label">CREDIT TIER</div>
        <div class="tier">A</div>
        <div class="verified"><span class="check"><svg viewBox="0 0 12 12" fill="none"><path d="M2.2 6.3 4.8 8.9 9.8 3.2" stroke="#0ecb81" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>Verified credential</div>
        <div class="bar"><span></span></div>
        <div class="meta"><span>TIER PROGRESS</span><span>84%</span></div>
        <div class="card-foot">
          <div><div class="label">MAX LOAN</div><div class="value">$50,000 <span>USD</span></div></div>
          <div style="text-align:right"><div class="label">RATE</div><div class="value">3.5<span>%</span></div></div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>`;

await mkdir(publicDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

async function render(svg, size, file, { transparent = true } = {}) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(pageFor(svg), { waitUntil: 'load' });
  const buffer = await page.screenshot({ omitBackground: transparent });
  if (file) await writeFile(path.join(publicDir, file), buffer);
  return buffer;
}

const fav16 = await render(faviconSvg, 16, 'favicon-16.png');
const fav32 = await render(faviconSvg, 32, 'favicon-32.png');
const fav48 = await render(faviconSvg, 48);
await writeFile(path.join(publicDir, 'favicon.ico'), buildIco([
  { size: 16, buffer: fav16 },
  { size: 32, buffer: fav32 },
  { size: 48, buffer: fav48 },
]));

await render(maskableSvg, 192, 'icon-192.png', { transparent: false });
await render(maskableSvg, 512, 'icon-512.png', { transparent: false });
await render(maskableSvg, 512, 'icon-512-maskable.png', { transparent: false });
await render(maskableSvg, 180, 'apple-touch-icon.png', { transparent: false });

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(ogHtml, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(publicDir, 'og-image.png') });

await browser.close();
console.log('Brand assets written to public/');
