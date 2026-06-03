/* Generates THE SYSTEM app icons by rendering an SVG with headless Chromium.
   Run: NODE_PATH=$(npm root -g) node tools/make-icons.mjs   */
import pw from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pw;
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = new URL('../icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

/* Holographic HUD glyph: grid, glowing pentagon (the radar motif), central ⟁.
   `pad` controls the safe-zone inset (0 = edge-to-edge for maskable). */
function svg({ size = 512, pad = 0, brackets = true } = {}) {
  const S = size;
  const c = S / 2;
  const grid = [];
  for (let i = 1; i < 9; i++) {
    const p = (S / 9) * i;
    grid.push(`<line x1="${p}" y1="0" x2="${p}" y2="${S}"/>`);
    grid.push(`<line x1="0" y1="${p}" x2="${S}" y2="${p}"/>`);
  }
  // pentagon points (radar shape), radius scaled by pad
  const R = (S * 0.30) * (1 - pad * 0.12);
  const penta = [];
  for (let i = 0; i < 5; i++) {
    const a = (-90 + i * 72) * Math.PI / 180;
    penta.push(`${(c + R * Math.cos(a)).toFixed(1)},${(c + R * Math.sin(a)).toFixed(1)}`);
  }
  const inR = R * 0.62;
  const innerPenta = [];
  for (let i = 0; i < 5; i++) {
    const a = (-90 + i * 72) * Math.PI / 180;
    innerPenta.push(`${(c + inR * Math.cos(a)).toFixed(1)},${(c + inR * Math.sin(a)).toFixed(1)}`);
  }
  const b = S * 0.13; // bracket inset
  const bl = S * 0.10; // bracket arm length
  const bw = Math.max(4, S * 0.018);
  const bracketSVG = brackets ? `
    <g stroke="#7fd0ff" stroke-width="${bw}" fill="none" stroke-linecap="square" opacity=".95">
      <path d="M${b} ${b + bl} L${b} ${b} L${b + bl} ${b}"/>
      <path d="M${S - b} ${b + bl} L${S - b} ${b} L${S - b - bl} ${b}"/>
      <path d="M${b} ${S - b - bl} L${b} ${S - b} L${b + bl} ${S - b}"/>
      <path d="M${S - b} ${S - b - bl} L${S - b} ${S - b} L${S - b - bl} ${S - b}"/>
    </g>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="32%" r="80%">
      <stop offset="0%" stop-color="#13254a"/>
      <stop offset="55%" stop-color="#0a1020"/><stop offset="100%" stop-color="#05070d"/>
    </radialGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#3da9ff" stop-opacity=".55"/>
      <stop offset="70%" stop-color="#3da9ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="pen" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#bfe6ff"/><stop offset="100%" stop-color="#3da9ff"/>
    </linearGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${S * 0.012}"/>
    </filter>
  </defs>
  <rect width="${S}" height="${S}" rx="${S * 0.22}" fill="url(#bg)"/>
  <g stroke="#3da9ff" stroke-width="1.2" opacity=".18">${grid.join('')}</g>
  <circle cx="${c}" cy="${c}" r="${R * 1.5}" fill="url(#glow)"/>
  <polygon points="${penta.join(' ')}" fill="rgba(61,169,255,.10)" stroke="url(#pen)" stroke-width="${S * 0.012}" filter="url(#soft)"/>
  <polygon points="${penta.join(' ')}" fill="none" stroke="url(#pen)" stroke-width="${S * 0.012}"/>
  <polygon points="${innerPenta.join(' ')}" fill="none" stroke="#3da9ff" stroke-width="${S * 0.006}" opacity=".5"/>
  <text x="${c}" y="${c + R * 0.34}" text-anchor="middle" font-family="Orbitron, sans-serif" font-weight="900"
        font-size="${R * 0.95}" fill="#eaf6ff" style="text-shadow:0 0 20px #3da9ff">⟁</text>
  ${bracketSVG}
</svg>`;
}

const targets = [
  { name: 'icon-192.png', size: 192, pad: 0, brackets: true },
  { name: 'icon-512.png', size: 512, pad: 0, brackets: true },
  { name: 'icon-512-maskable.png', size: 512, pad: 1, brackets: false },
  { name: 'apple-touch-icon.png', size: 180, pad: 0.6, brackets: true },
  { name: 'favicon-64.png', size: 64, pad: 0.4, brackets: false },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  const markup = svg(t);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(
    `<style>*{margin:0;padding:0}html,body{background:transparent}</style>${markup}`,
    { waitUntil: 'networkidle' }
  );
  // give webfont a beat (falls back to system if unavailable — glyph still renders)
  await page.waitForTimeout(200);
  const elt = await page.$('svg');
  const buf = await elt.screenshot({ omitBackground: true });
  writeFileSync(new URL(t.name, OUT), buf);
  console.log('wrote', t.name, buf.length, 'bytes');
}
await browser.close();
console.log('done');
