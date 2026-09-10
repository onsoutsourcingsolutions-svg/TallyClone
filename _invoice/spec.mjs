// Full machine-readable spec of the invoice page: text lines (with real ink extents)
// + rule segments, all in pt from top-left. Output: _invoice/spec.json
import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const S = 2; // render scale (px per pt)
const buf = new Uint8Array(readFileSync('_invoice/PI-200-REFTECH.pdf'));
const doc = await pdfjsLib.getDocument({ data: buf, verbosity: 0 }).promise;
const page = await doc.getPage(1);

// ---- text lines (PDF space, pt) ----
const tc = await page.getTextContent();
const items = tc.items.filter((it) => it.str && it.str.trim() !== '');
const lines = [];
for (const it of items) {
  const h = it.height || 10;
  const yTop = 841.9 - it.transform[5] - h; // top in pt from page top
  const x0 = it.transform[4], x1 = x0 + it.width;
  const ex = lines.find((l) => Math.abs(l.yTop - yTop) < 6);
  if (ex) { ex.parts.push({ x0, x1, str: it.str, size: h }); ex.x0 = Math.min(ex.x0, x0); ex.x1 = Math.max(ex.x1, x1); }
  else lines.push({ yTop, size: h, x0, x1, parts: [{ x0, x1, str: it.str, size: h }] });
}
lines.sort((a, b) => a.yTop - b.yTop || a.x0 - b.x0);

// ---- ink (pixel) map for exact glyph extents ----
const img = await loadImage(readFileSync('_invoice/page.png'));
const c = createCanvas(img.width, img.height);
const ctx = c.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width, Hpix = img.height;
const dark = (x, y, th = 120) => { const i = (y * W + x) * 4; return d[i] < th && d[i + 1] < th && d[i + 2] < th; };
const colInk = (x, y1, y2) => {
  let a = -1, b = -1;
  for (let y = y1; y <= y2; y++) if (dark(x, y)) { if (a < 0) a = y; b = y; }
  return [a, b];
};

const out = { page: { w: 595.3, h: 841.9 }, lines: [] };
const partInk = (p, yTop) => {
  const px0 = Math.max(0, Math.floor(p.x0 * S)), px1 = Math.min(W - 1, Math.ceil(p.x1 * S));
  const py0 = Math.max(0, Math.floor((yTop - 3) * S)), py1 = Math.min(Hpix - 1, Math.ceil((yTop + 16) * S));
  let it = 1e9, ib = -1e9, hx0 = 1e9, hx1 = -1e9;
  for (let x = px0; x <= px1; x++) {
    const [a, b] = colInk(x, py0, py1);
    if (a >= 0) { it = Math.min(it, a); ib = Math.max(ib, b); hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x); }
  }
  if (it >= 1e9) return null;
  return { inkTop: it / S, inkBot: ib / S, ix0: hx0 / S, ix1: hx1 / S };
};
for (const l of lines) {
  const parts = l.parts.map((p) => {
    const ink = partInk(p, l.yTop);
    return { x0: +p.x0.toFixed(1), x1: +p.x1.toFixed(1), size: +p.size.toFixed(2), str: p.str, ...(ink ? { inkTop: +ink.inkTop.toFixed(2), inkBot: +ink.inkBot.toFixed(2), ix0: +ink.ix0.toFixed(1), ix1: +ink.ix1.toFixed(1) } : {}) };
  });
  const i0 = parts.filter((p) => p.inkTop !== undefined);
  out.lines.push({
    y: +l.yTop.toFixed(2), size: +l.size.toFixed(2),
    inkTop: i0.length ? Math.min(...i0.map((p) => p.inkTop)) : null,
    inkBot: i0.length ? Math.max(...i0.map((p) => p.inkBot)) : null,
    x0: +l.x0.toFixed(1), x1: +l.x1.toFixed(1),
    parts,
  });
}

// ---- rules via run-length on pixel map (pt) ----
const hRules = [];
for (let y = 0; y < Hpix; y++) {
  let cur = null;
  const t = (x) => dark(x, y) || (y > 0 && dark(x, y - 1)) || (y < Hpix - 1 && dark(x, y + 1));
  for (let x = 0; x < W; x++) {
    if (t(x)) { if (!cur) cur = [x, x]; else cur[1] = x; }
    else if (cur) { if (cur[1] - cur[0] >= 80) hRules.push({ y, x1: cur[0], x2: cur[1] }); cur = null; }
  }
  if (cur && cur[1] - cur[0] >= 80) hRules.push({ y, x1: cur[0], x2: cur[1] });
}
const vRules = [];
for (let x = 0; x < W; x++) {
  let cur = null;
  const t = (y) => dark(x, y) || (x > 0 && dark(x - 1, y)) || (x < W - 1 && dark(x + 1, y));
  for (let y = 0; y < Hpix; y++) {
    if (t(y)) { if (!cur) cur = [y, y]; else cur[1] = y; }
    else if (cur) { if (cur[1] - cur[0] >= 50) vRules.push({ x, y1: cur[0], y2: cur[1] }); cur = null; }
  }
  if (cur && cur[1] - cur[0] >= 50) vRules.push({ x, y1: cur[0], y2: cur[1] });
}
const mh = [];
for (const r of hRules) {
  const ex = mh.find((o) => Math.abs(o.y - r.y) <= 2 && Math.abs(o.x1 - r.x1) <= 4);
  if (ex) { ex.y = Math.round((ex.y + r.y) / 2); ex.x1 = Math.min(ex.x1, r.x1); ex.x2 = Math.max(ex.x2, r.x2); }
  else mh.push({ y: r.y, x1: r.x1, x2: r.x2 });
}
const mv = [];
for (const r of vRules) {
  const ex = mv.find((o) => Math.abs(o.x - r.x) <= 2 && Math.abs(o.y1 - r.y1) <= 3 && Math.abs(o.y2 - r.y2) <= 3);
  if (ex) { ex.x = Math.round((ex.x + r.x) / 2); ex.y1 = Math.min(ex.y1, r.y1); ex.y2 = Math.max(ex.y2, r.y2); }
  else mv.push({ x: r.x, y1: r.y1, y2: r.y2 });
}
out.hRules = mh.map((r) => ({ y: +(r.y / S).toFixed(2), x1: +(r.x1 / S).toFixed(1), x2: +(r.x2 / S).toFixed(1) }));
out.vRules = mv.map((r) => ({ x: +(r.x / S).toFixed(2), y1: +(r.y1 / S).toFixed(2), y2: +(r.y2 / S).toFixed(2) }));
writeFileSync('_invoice/spec.json', JSON.stringify(out, null, 1));
console.log('lines:', out.lines.length, 'hRules:', out.hRules.length, 'vRules:', out.vRules.length);
const flat = out.lines.map((l) => ({ y: l.y, size: l.size, parts: l.parts }));
writeFileSync('_invoice/text-parts.json', JSON.stringify(flat, null, 1));
