// Extract vector geometry (stroked lines + filled rects) from the reference PDF,
// so we can reproduce its table grid faithfully.
// Run from repo root:  node _invoice/pdfgeo.mjs  [file.pdf]
import { readFileSync } from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const file = process.argv[2] || '_invoice/PI-200-REFTECH.pdf';
const buf = new Uint8Array(readFileSync(file));
const doc = await pdfjsLib.getDocument({ data: buf, verbosity: 0 }).promise;

function mul(m, x, y) {
  const [a, b, c, d, e, f] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

const page = await doc.getPage(1);
const vp = page.getViewport({ scale: 1 });
const H = vp.height;
const opList = await page.getOperatorList();
const { fnArray, argsArray } = opList;
const OPS = pdfjsLib.OPS;

let ctm = [1, 0, 0, 1, 0, 0];
const segs = [];     // {x1,y1,x2,y2,lw,kind:'h'|'v'|'d',yTop}
const fills = [];
let px = [], py = [], cur = null;

const flushStroke = (lw) => {
  if (!cur) return;
  const pts = cur.pts;
  for (let i = 1; i < pts.length; i++) {
    const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
    segs.push({ x1, y1, x2, y2, lw });
  }
  cur = null;
};

for (let i = 0; i < fnArray.length; i++) {
  const fn = fnArray[i];
  const a = argsArray[i];
  switch (fn) {
    case OPS.transform: {
      ctm = [
        ctm[0] * a[0] + ctm[2] * a[1],
        ctm[1] * a[0] + ctm[3] * a[1],
        ctm[0] * a[2] + ctm[2] * a[3],
        ctm[1] * a[2] + ctm[3] * a[3],
        ctm[0] * a[4] + ctm[2] * a[5] + ctm[4],
        ctm[1] * a[4] + ctm[3] * a[5] + ctm[5],
      ];
      break;
    }
    case OPS.moveTo: px = mul(ctm, a[0], a[1]); cur = { pts: [px] }; break;
    case OPS.lineTo: {
      const p = mul(ctm, a[0], a[1]);
      if (cur && cur.pts.length && cur.pts[cur.pts.length - 1] === px) { cur.pts.push(p); px = p; }
      else { if (cur) flushStroke(1); px = p; cur = { pts: [px] }; }
      break;
    }
    case OPS.rectangle: {
      const x = a[0], y = a[1], w = a[2], h = a[3];
      const p1 = mul(ctm, x, y), p2 = mul(ctm, x + w, y), p3 = mul(ctm, x + w, y + h), p4 = mul(ctm, x, y + h);
      cur = { pts: [p1, p2, p3, p4, p1] };
      break;
    }
    case OPS.closePath: if (cur && cur.pts.length > 1 && cur.pts[0] !== cur.pts[cur.pts.length - 1]) cur.pts.push(cur.pts[0]); break;
    case OPS.stroke: {
      // line width from preceding gs is not tracked; assume thin border (0.5) — positions matter more
      flushStroke(1); break;
    }
    case OPS.fill: case OPS.eoFill: {
      if (cur && cur.pts.length >= 4) {
        const xs = cur.pts.map((p) => p[0]), ys = cur.pts.map((p) => p[1]);
        fills.push({ x1: Math.min(...xs), x2: Math.max(...xs), y1: Math.min(...ys), y2: Math.max(...ys) });
      }
      cur = null; break;
    }
    case OPS.constructor: break;
    default: break;
  }
}

const round1 = (n) => Math.round(n * 10) / 10;
const near = (a, b) => Math.abs(a - b) < 1.2;
const mergeH = (arr, key, lo, hi) => {
  const out = [];
  for (const s of arr) {
    const ex = out.find((o) => near(o[key], s[key]));
    if (ex) { ex[lo] = Math.min(ex[lo], s[lo]); ex[hi] = Math.max(ex[hi], s[hi]); }
    else out.push({ [key]: s[key], [lo]: s[lo], [hi]: s[hi] });
  }
  return out.sort((p, q) => p[key] - q[key]);
};

const hlines = mergeH(segs.filter((s) => Math.abs(s.y1 - s.y2) < 0.8 && Math.abs(s.x2 - s.x1) > 8).map((s) => ({ y: (s.y1 + s.y2) / 2, x1: Math.min(s.x1, s.x2), x2: Math.max(s.x1, s.x2) })), 'y', 'x1', 'x2');
const vlines = mergeH(segs.filter((s) => Math.abs(s.x1 - s.x2) < 0.8 && Math.abs(s.y2 - s.y1) > 8).map((s) => ({ x: (s.x1 + s.x2) / 2, y1: Math.min(s.y1, s.y2), y2: Math.max(s.y1, s.y2) })), 'x', 'y1', 'y2');

console.log('PAGE', vp.width.toFixed(1), 'x', vp.height.toFixed(1), '(pt) — y measured from TOP of page');
console.log('\n-- HORIZONTAL LINES (y-top, x1..x2) --');
for (const l of hlines) console.log(`y=${round1(l.y).toFixed(0).padStart(3)} :: x ${round1(l.x1).toFixed(0).padStart(3)} .. ${round1(l.x2).toFixed(0).padStart(3)}`);
console.log('\n-- VERTICAL LINES (x, y1..y2 from top) --');
for (const l of vlines) console.log(`x=${round1(l.x).toFixed(0).padStart(3)} :: y ${round1(l.y1).toFixed(0).padStart(3)} .. ${round1(l.y2).toFixed(0).padStart(3)}`);
console.log('\n-- FILLED RECTS (y from top) --');
for (const f of fills) console.log(`x ${round1(f.x1).toFixed(0)}..${round1(f.x2).toFixed(0)}  y ${round1(H - f.y2).toFixed(0)}..${round1(H - f.y1).toFixed(0)}`);
