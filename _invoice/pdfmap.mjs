// Extract full text layout of the invoice PDF: position, size, font per item.
import fs from 'node:fs';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const data = new Uint8Array(fs.readFileSync('/home/user/TallyClone/_invoice/PI-200-REFTECH.pdf'));
const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
console.log('pages:', doc.numPages);
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  console.log(`\n===== PAGE ${p}  (${Math.round(vp.width)} x ${Math.round(vp.height)} pt) =====`);
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((it) => it.str && it.str.trim() !== '')
    .map((it) => {
      const x = it.transform[4];
      const yBase = it.transform[5];
      const h = it.height || 10;
      return { str: it.str, x, yTop: vp.height - yBase - h, h, size: Math.round((it.height || 10) * 10) / 10, font: it.fontName };
    });
  // group into visual lines (tolerance ~ 2.5 pt)
  items.sort((a, b) => a.yTop - b.yTop || a.x - b.x);
  const lines = [];
  for (const it of items) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.yTop - it.yTop) < 3.2) last.items.push(it);
    else lines.push({ yTop: it.yTop, items: [it] });
  }
  for (const ln of lines) {
    ln.items.sort((a, b) => a.x - b.x);
    const parts = ln.items.map((i) => {
      const right = Math.round(i.x + i.str.length * i.size * 0.5);
      return `[x=${String(Math.round(i.x)).padStart(3)}..${String(right).padStart(3)} sz=${i.size}] "${i.str}"`;
    });
    console.log('y=' + Math.round(ln.yTop) + ' :: ' + parts.join(' | '));
  }
}
