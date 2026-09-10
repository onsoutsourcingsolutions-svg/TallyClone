// Pixel-scan the rendered page PNG to detect lines vs text.
import { readFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const img = await loadImage(readFileSync('_invoice/page.png'));
const c = createCanvas(img.width, img.height);
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width, H = img.height;
const dark = (x, y) => { const i = (y * W + x) * 4; return d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100; };
const hRuns = [];
for (let y = 0; y < H; y++) {
  let best = 0, cur = 0;
  for (let x = 0; x < W; x++) { if (dark(x, y)) { cur++; if (cur > best) best = cur; } else cur = 0; }
  hRuns.push(best);
}
const vRuns = [];
for (let x = 0; x < W; x++) {
  let best = 0, cur = 0;
  for (let y = 0; y < H; y++) { if (dark(x, y)) { cur++; if (cur > best) best = cur; } else cur = 0; }
  vRuns.push(best);
}
console.log('-- horizontal line candidates (row longest-run > 300 px of 1191) --');
hRuns.forEach((r, y) => { if (r > 300) console.log('y=' + (y / 2).toFixed(1) + 'pt run=' + r); });
console.log('-- vertical line candidates (col longest-run > 400 px of 1684) --');
vRuns.forEach((r, x) => { if (r > 400) console.log('x=' + (x / 2).toFixed(1) + 'pt run=' + r); });
console.log('-- band darkness (fraction of pixels dark per 5pt band) --');
for (let band = 0; band < 168; band++) {
  let cnt = 0, tot = 0;
  for (let y = band * 10; y < band * 10 + 10 && y < H; y++)
    for (let x = 0; x < W; x += 3) { tot++; if (dark(x, y)) cnt++; }
  const f = cnt / tot;
  if (f > 0.003) console.log((band * 5).toFixed(0) + '..' + (band * 5 + 5) + 'pt dark=' + (f * 100).toFixed(2) + '%');
}
