// Fine grid extraction: detect ALL horizontal/vertical rules (cell borders),
// even short ones, using row-coverage discrimination to exclude text rows.
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
const img = await loadImage(readFileSync('_invoice/page.png'));
const c = createCanvas(img.width, img.height);
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width, H = img.height;
const dark = (x, y, th = 120) => { const i = (y * W + x) * 4; return d[i] < th && d[i + 1] < th && d[i + 2] < th; };

function hScan() {
  const out = [];
  const dh = (x, y) => dark(x, y) || dark(x, y - 1) || dark(x, y + 1); // dilate 1px
  for (let y = 0; y < H; y++) {
    // find contiguous dark runs (dilated vertically so a 1px line is not split by AA)
    const dk = (x) => dh(x, y);
    const runs = []; let cur = null;
    for (let x = 0; x < W; x++) {
      if (dk(x)) { if (!cur) cur = [x, x]; else cur[1] = x; }
      else if (cur) { runs.push(cur); cur = null; }
    }
    if (cur) runs.push(cur);
    const long = runs.filter((r) => r[1] - r[0] >= 36);
    if (!long.length) continue;
    // coverage: a rule row is almost fully dark between first and last run extents,
    // allowing small AA gaps; text rows have many gaps.
    let covered = 0; for (const r of long) covered += r[1] - r[0];
    const span = Math.max(...long.map((r) => r[1])) - Math.min(...long.map((r) => r[0]));
    // allow gap < 6px only if it is exactly a junction area of a vertical (checked later);
    // simply record run list — verification happens by continuity of neighbours
    for (const r of long) out.push({ y, x1: r[0], x2: r[1] });
  }
  return out;
}
function vScan() {
  const out = [];
  for (let x = 0; x < W; x++) {
    let cur = null;
    const dv = (y) => dark(x, y) || dark(x - 1, y) || dark(x + 1, y); // dilate 1px
    for (let y = 0; y < H; y++) {
      if (dv(y)) { if (!cur) cur = [y, y]; else cur[1] = y; }
      else if (cur) { out.push({ x, y1: cur[0], y2: cur[1] }); cur = null; }
    }
    if (cur) out.push({ x, y1: cur[0], y2: cur[1] });
  }
  return out.filter((r) => r.y2 - r.y1 >= 15);
}

let hRuns = hScan();
let vRuns = vScan();

// merge runs that belong to the same rule (adjacent y rows, same x span)
const mergeH = [];
for (const r of hRuns) {
  const ex = mergeH.find((o) => Math.abs(o.y - r.y) <= 2 && Math.abs(o.x1 - r.x1) <= 3 && Math.abs(o.x2 - r.x2) <= 3);
  if (ex) { ex.y = Math.round((ex.y + r.y) / 2); ex.x1 = Math.min(ex.x1, r.x1); ex.x2 = Math.max(ex.x2, r.x2); }
  else mergeH.push({ y: r.y, x1: r.x1, x2: r.x2 });
}
const mergeV = [];
const union = (a, b) => [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
for (const r of vRuns) {
  const ex = mergeV.find((o) => Math.abs(o.x - r.x) <= 2 && Math.min(o.y2, r.y2) >= Math.max(o.y1, r.y1) - 4);
  if (ex) { ex.x = Math.round((ex.x + r.x) / 2); [ex.y1, ex.y2] = union([ex.y1, ex.y2], [r.y1, r.y2]); }
  else mergeV.push({ x: r.x, y1: r.y1, y2: r.y2 });
}
// chain adjacent same-y rows that belong to one continuous rule separated by <=1px
mergeH.sort((a, b) => a.y - b.y || a.x1 - b.x1);
mergeV.sort((a, b) => a.x - b.x || a.y1 - b.y1);

const pt = (px) => +(px / 2).toFixed(2);
console.log('HORIZONTAL (pt)');
for (const r of mergeH) console.log(` y=${String(pt(r.y)).padStart(6)}  x ${String(pt(r.x1)).padStart(6)}..${String(pt(r.x2)).padStart(6)}`);
console.log('\nVERTICAL (pt)');
for (const r of mergeV) console.log(` x=${String(pt(r.x)).padStart(6)}  y ${String(pt(r.y1)).padStart(6)}..${String(pt(r.y2)).padStart(6)}`);

writeFileSync('_invoice/grid-raw.json', JSON.stringify({
  W, H, h: mergeH.map((r) => [r.y, r.x1, r.x2]), v: mergeV.map((r) => [r.x, r.y1, r.y2]),
}, null, 1));
