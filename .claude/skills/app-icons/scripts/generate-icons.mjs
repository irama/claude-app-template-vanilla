#!/usr/bin/env node
// Generate a full PWA icon set + favicon.ico + OpenGraph/Twitter image from a
// single source mark (SVG or raster). Renders with Chromium via Playwright so
// CSS gradients, rounded corners, and real fonts come out pixel-accurate.
//
// Usage (run from the project root):
//   node .claude/skills/app-icons/scripts/generate-icons.mjs \
//     --src brand/mark.svg \
//     --bg '#1a1614' --accent '#b89944' --fg '#f0e9dd' --muted '#b8ad9d' \
//     --recolor '#ffffff' \
//     --title 'Peak State CMS' \
//     --tagline 'Sites that read like books, written with you.' \
//     --name 'Peak State CMS' --short 'Peak State'
//
// Flags:
//   --src <path>        Source mark. .svg is inlined (recolourable); raster
//                       (.png/.jpg/.webp) is embedded as-is.               [required]
//   --out <dir>         Icon/manifest output dir.               [default: public]
//   --app <dir>         Where opengraph-image.png goes.        [default: src/app]
//   --bg <hex>          Icon + OG background.                  [default: #111111]
//   --accent <hex>      OG rule / glow accent.                 [default: #b89944]
//   --fg <hex>          OG title colour.                       [default: #f5f5f5]
//   --muted <hex>       OG tagline colour.                     [default: #b8ad9d]
//   --recolor <hex>     Recolour every SVG fill (e.g. #ffffff). SVG src only.
//   --title <str>       OG headline.                    [default: --name value]
//   --tagline <str>     OG subline.                                   [optional]
//   --name <str>        Manifest name.                         [default: 'App']
//   --short <str>       Manifest short_name.            [default: --name value]
//   --radius <0..0.5>   Icon corner radius fraction.            [default: 0.18]
//   --no-og             Skip the OpenGraph/Twitter image.
//   --no-manifest       Skip manifest.webmanifest.
//
// After running, paste the metadata block it prints into your root layout.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { createRequire } from 'node:module';

// ---- args ----
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key.startsWith('no-')) { out[key.slice(3)] = false; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; }
    else { out[key] = next; i++; }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
if (!args.src) {
  console.error('Error: --src <path-to-mark> is required.');
  process.exit(1);
}

const cfg = {
  src: resolve(args.src),
  out: resolve(args.out || 'public'),
  app: resolve(args.app || 'src/app'),
  bg: args.bg || '#111111',
  accent: args.accent || '#b89944',
  fg: args.fg || '#f5f5f5',
  muted: args.muted || '#b8ad9d',
  recolor: typeof args.recolor === 'string' ? args.recolor : null,
  name: args.name || 'App',
  short: args.short || args.name || 'App',
  title: args.title || args.name || 'App',
  tagline: typeof args.tagline === 'string' ? args.tagline : '',
  radius: args.radius != null ? Number(args.radius) : 0.18,
  og: args.og !== false,
  manifest: args.manifest !== false,
};
cfg.title = cfg.title === true ? cfg.name : cfg.title;

if (!existsSync(cfg.src)) {
  console.error(`Error: source not found: ${cfg.src}`);
  process.exit(1);
}
mkdirSync(cfg.out, { recursive: true });
mkdirSync(cfg.app, { recursive: true });

// ---- resolve Playwright's chromium from the project ----
const require = createRequire(resolve('package.json'));
let chromium;
try { ({ chromium } = require('@playwright/test')); }
catch {
  try { ({ chromium } = require('playwright')); }
  catch {
    console.error(
      'Error: Playwright not found. Install it once:\n' +
      '  npm i -D playwright && npx playwright install chromium\n' +
      '(or `npm i -D @playwright/test`). Then re-run this script.'
    );
    process.exit(1);
  }
}

// ---- build the mark markup (inline SVG, or embedded raster) ----
const isSvg = extname(cfg.src).toLowerCase() === '.svg';
let markPlain; // as-authored colours
let markBold;  // stroked, for tiny favicons (SVG + recolour only)

if (isSvg) {
  let svg = readFileSync(cfg.src, 'utf8')
    .replace(/<\?xml[\s\S]*?\?>/, '')
    .replace(/<!DOCTYPE[\s\S]*?>/, '')
    .trim();
  if (cfg.recolor) svg = svg.replace(/fill:\s*(?:#[0-9a-fA-F]{3,8}|rgb\([^)]*\))/g, `fill:${cfg.recolor}`);
  markPlain = svg;
  if (cfg.recolor) {
    // Add a matching stroke to every filled shape so thin line-art survives 16px.
    markBold = svg.replace(/style="fill:\s*[^;"]+;?/g, (m) =>
      `${m.endsWith(';') ? m : m + ';'}stroke:${cfg.recolor};stroke-width:9px;`
    );
  } else {
    markBold = svg;
  }
} else {
  const b64 = readFileSync(cfg.src).toString('base64');
  const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[extname(cfg.src).toLowerCase()] || 'image/png';
  const img = `<img src="data:${mime};base64,${b64}" alt=""/>`;
  markPlain = img;
  markBold = img;
}

function iconHtml(mark, size, boxW, radiusPx) {
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0}
    .icon{width:${size}px;height:${size}px;background:${cfg.bg};border-radius:${radiusPx}px;
      display:flex;align-items:center;justify-content:center;overflow:hidden}
    .icon svg,.icon img{width:${boxW}px;height:auto;display:block}
  </style></head><body><div class="icon">${mark}</div></body></html>`;
}

// ---- render ----
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
async function shoot(html, size, sel = '.icon') {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html, { waitUntil: 'networkidle' });
  return page.locator(sel).screenshot({ omitBackground: false });
}

const R = cfg.radius;
const pngs = {};

// PWA + apple + standard icons (plain mark, generous padding)
const iconTargets = [
  ['icon-192.png', 192, 0.18, R],
  ['icon-512.png', 512, 0.18, R],
  ['apple-touch-icon.png', 180, 0.16, 0], // OS masks apple icons itself
  ['icon-maskable-192.png', 192, 0.30, 0], // safe-zone padding, full-bleed bg
  ['icon-maskable-512.png', 512, 0.30, 0],
];
for (const [name, size, pad, radiusPct] of iconTargets) {
  const buf = await shoot(iconHtml(markPlain, size, size * (1 - pad), size * radiusPct), size);
  writeFileSync(`${cfg.out}/${name}`, buf);
  console.log('wrote', name);
}

// Tiny favicons (bold mark, tight crop)
for (const [name, size] of [['favicon-16x16.png', 16], ['favicon-32x32.png', 32], ['favicon-48x48.png', 48]]) {
  const buf = await shoot(iconHtml(markBold, size, size * 0.9, size * R), size);
  writeFileSync(`${cfg.out}/${name}`, buf);
  pngs[size] = buf;
  console.log('wrote', name);
}

// Scalable favicon.svg (only meaningful for SVG sources)
if (isSvg) {
  const AR_M = markPlain.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const vbW = AR_M ? Number(AR_M[1]) : 100;
  const vbH = AR_M ? Number(AR_M[2]) : 100;
  const S = 512, pad = 0.22, boxW = S * (1 - pad), markH = boxW * (vbH / vbW);
  const x = (S - boxW) / 2, y = (S - markH) / 2, r = Math.round(S * R);
  const scalable = `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <rect width="${S}" height="${S}" rx="${r}" ry="${r}" fill="${cfg.bg}"/>
  <svg x="${x}" y="${y}" width="${boxW}" height="${markH}" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">${markPlain}</svg>
</svg>`;
  writeFileSync(`${cfg.out}/icon.svg`, scalable);
  console.log('wrote icon.svg');
}

// favicon.ico (PNG-in-ICO, 16/32/48 — supported by all modern browsers)
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(16 * frames.length);
  let offset = 6 + 16 * frames.length; const body = [];
  frames.forEach((f, i) => {
    const b = 16 * i;
    dir.writeUInt8(f.size >= 256 ? 0 : f.size, b); dir.writeUInt8(f.size >= 256 ? 0 : f.size, b + 1);
    dir.writeUInt16LE(1, b + 4); dir.writeUInt16LE(32, b + 6);
    dir.writeUInt32LE(f.data.length, b + 8); dir.writeUInt32LE(offset, b + 12);
    offset += f.data.length; body.push(f.data);
  });
  return Buffer.concat([header, dir, ...body]);
}
writeFileSync(`${cfg.out}/favicon.ico`, buildIco([
  { size: 16, data: pngs[16] }, { size: 32, data: pngs[32] }, { size: 48, data: pngs[48] },
]));
console.log('wrote favicon.ico');

// manifest.webmanifest
if (cfg.manifest) {
  const manifest = {
    name: cfg.name,
    short_name: cfg.short,
    ...(cfg.tagline ? { description: cfg.tagline } : {}),
    start_url: '/',
    display: 'standalone',
    background_color: cfg.bg,
    theme_color: cfg.bg,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync(`${cfg.out}/manifest.webmanifest`, JSON.stringify(manifest, null, 2) + '\n');
  console.log('wrote manifest.webmanifest');
}

// OpenGraph + Twitter image (1200x630)
if (cfg.og) {
  const og = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0}
    .card{width:1200px;height:630px;background:${cfg.bg};position:relative;overflow:hidden;
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-family:Georgia,'Times New Roman',serif;color:${cfg.fg}}
    .card::after{content:"";position:absolute;inset:0;
      background:radial-gradient(120% 90% at 50% 8%, ${cfg.accent}28, transparent 60%)}
    .mark{width:300px;height:auto;position:relative;z-index:1}
    .mark svg,.mark img{width:100%;height:auto;display:block}
    h1{position:relative;z-index:1;margin:14px 0 0;font-size:76px;font-weight:600;letter-spacing:.5px;text-align:center;padding:0 40px}
    .rule{position:relative;z-index:1;width:64px;height:3px;background:${cfg.accent};margin:26px 0 0;border-radius:2px}
    .tag{position:relative;z-index:1;margin:18px 0 0;font-family:Inter,Helvetica,Arial,sans-serif;
      font-size:27px;color:${cfg.muted};max-width:820px;text-align:center;line-height:1.4;padding:0 40px}
  </style></head><body>
    <div class="card">
      <div class="mark">${markPlain}</div>
      <h1>${cfg.title}</h1>
      ${cfg.tagline ? '<div class="rule"></div>' : ''}
      ${cfg.tagline ? `<div class="tag">${cfg.tagline}</div>` : ''}
    </div></body></html>`;
  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(og, { waitUntil: 'networkidle' });
  const ogBuf = await page.locator('.card').screenshot();
  writeFileSync(`${cfg.app}/opengraph-image.png`, ogBuf);
  writeFileSync(`${cfg.app}/twitter-image.png`, ogBuf);
  console.log('wrote opengraph-image.png + twitter-image.png');
}

await browser.close();

// ---- print the metadata block to wire up ----
const svgIconLine = isSvg ? "\n      { url: '/icon.svg', type: 'image/svg+xml' }," : '';
console.log(`
Done. Add this to your root layout (src/app/layout.tsx):

export const metadata: Metadata = {
  // ...existing title/description...
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },${svgIconLine}
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = { themeColor: '${cfg.bg}' };

// opengraph-image.png / twitter-image.png in src/app/ are auto-wired by Next.
// Ensure your auth middleware matcher excludes static assets, e.g.:
//   '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'
`);
