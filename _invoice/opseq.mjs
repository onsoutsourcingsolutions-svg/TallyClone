import { readFileSync } from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
const buf = new Uint8Array(readFileSync('_invoice/PI-200-REFTECH.pdf'));
const doc = await pdfjsLib.getDocument({ data: buf, verbosity: 0 }).promise;
const page = await doc.getPage(1);
const opList = await page.getOperatorList();
const { fnArray, argsArray } = opList;
const OPS = pdfjsLib.OPS;
const rev = {}; for (const k of Object.keys(OPS)) rev[OPS[k]] = k;
// index every constructPath occurrence and inspect surrounding ops
fnArray.forEach((fn, i) => {
  const name = rev[fn] || String(fn);
  if (!/constructPath|stroke|fill|eoFill|eoClip|clip|endPath|setLineWidth|paintImageXObject|paintInlineImageXObject|setStrokeRGBColor|setFillRGBColor/.test(name)) return;
  const a = argsArray[i];
  const show = (v) => Array.isArray(v) || ArrayBuffer.isView(v) ? '[' + Array.from(v).slice(0, 24).map((x) => (+(+x).toFixed(2)).toString()).join(', ') + ']' : JSON.stringify(v);
  console.log(i, name, Array.isArray(a) ? a.map((v) => show(v).slice(0, 260)).join('  ::  ').slice(0, 1200) : show(a));
});
