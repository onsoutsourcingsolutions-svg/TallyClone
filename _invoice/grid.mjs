// Reconstruct the PDF's grid topology precisely: detect horizontal/vertical rule
// positions, then test junctions, and print an ASCII map of the skeleton.
import { readFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const img = await loadImage(readFileSync('_invoice/page.png'));
const c = createCanvas(img.width, img.height);
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width, H = img.height;
const dark = (x, y) => { const i = (y * W + x) * 4; return d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120; };

// rows with a long contiguous dark run => horizontal rules (span > 300px @ scale2)
const hRules = [];
for (let y = 0; y < H; y++) {
  let best = 0, cur = 0, bxs = 0, xs = 0;
  for (let x = 0; x < W; x++) {
    if (dark(x, y)) { if (cur === 0) xs = x; cur++; if (cur > best) { best = cur; bxs = xs; } }
    else cur = 0;
  }
  if (best > 250) hRules.push({ y, x1: bxs, x2: bxs + best, run: best });
}
const cols = [];
for (let x = 0; x < W; x++) {
  let best = 0, cur = 0, bys = 0, ys = 0;
  for (let y = 0; y < H; y++) {
    if (dark(x, y)) { if (cur === 0) ys = y; cur++; if (cur > best) { best = cur; bys = ys; } }
    else cur = 0;
  }
  if (best > 200) cols.push({ x, y1: bys, y2: bys + best, run: best });
}
// merge adjacent y rows of same rule (line is 1-2 px thick at scale 2)
const mergeY = [];
for (const r of hRules) {
  const ex = mergeY.find((o) => Math.abs(o.y - r.y) <= 2 && Math.abs(o.x1 - r.x1) < 6);
  if (ex) { ex.y = Math.round((ex.y * 2 + r.y) / 3); ex.x1 = Math.min(ex.x1, r.x1); ex.x2 = Math.max(ex.x2, r.x2); }
  else mergeY.push({ y: r.y, x1: r.x1, x2: r.x2 });
}
const mergeX = [];
for (const r of cols) {
  const ex = mergeX.find((o) => Math.abs(o.x - r.x) <= 2);
  if (ex) { ex.x = Math.round((ex.x * 2 + r.x) / 3); ex.y1 = Math.min(ex.y1, r.y1); ex.y2 = Math.max(ex.y2, r.y2); }
  else mergeX.push({ x: r.x, y1: r.y1, y2: r.y2 });
}
mergeY.sort((a, b) => a.y - b.y);
mergeX.sort((a, b) => a.x - b.x);
console.log('HORIZONTAL RULES (pt):');
for (const r of mergeY) console.log(`  y=${(r.y / 2).toFixed(1).padStart(5)}  x ${(r.x1 / 2).toFixed(1).padStart(5)}..${(r.x2 / 2).toFixed(1).padStart(5)}  (${(r.run / 2).toFixed(0)}pt wide)`);
console.log('VERTICAL RULES (pt):');
for (const r of mergeX) console.log(`  x=${(r.x / 2).toFixed(1).padStart(5)}  y ${(r.y1 / 2).toFixed(1).padStart(5)}..${(r.y2 / 2).toFixed(1).padStart(5)}  (${(r.run / 2).toFixed(0)}pt tall)`);

// junction map on a coarse grid (2 pt per char horizontally, 2pt per row vertically)
const step = 4; // px per char (2pt)
const gx = new Set(mergeX.map((r) => Math.round(r.x / step)));
const gy = new Set(mergeY.map((r) => Math.round(r.y / step)));
const XS = [...gx].sort((a, b) => a - b), YS = [...gy].sort((a, b) => a - b);
const hasV = (xPx, yPx) => { for (let dy = 0; dy <= 2; dy++) if (dark(xPx, yPx + dy)) return true; return false; };
const hasH = (xPx, yPx) => { for (let dx = 0; dx <= 2; dx++) if (dark(xPx + dx, yPx)) return true; return false; };
console.log('\nASCII SKELETON  (each char = 2pt x 2pt; "v" dots vertical, "-" dots horizontal)');
for (const gyv of YS) {
  const yPx = gyv * step;
  let row = '';
  for (const gxv of XS) {
    const xPx = gxv * step;
    const v = hasV(xPx, yPx), h = hasH(xPx, yPx);
    row += v && h ? '+' : v ? '|' : h ? '-' : ' ';
  }
  console.log(String((gyv * step / 2).toFixed(1)).padStart(5) + ' ' + row);
}
