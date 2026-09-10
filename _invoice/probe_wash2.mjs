import { loadImage, createCanvas } from '@napi-rs/canvas';
const img = await loadImage('_invoice/page.png');
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width;
function minDark(x0pt, x1pt, y0, y1) {
  let darkest = 255; let at = null;
  for (let y = Math.round(y0*2); y < Math.round(y1*2); y++) for (let x = Math.round(x0pt*2); x < Math.round(x1pt*2); x++) {
    const i = (y*W + x)*4; const L = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
    if (L < darkest) { darkest = L; at = [x/2, y/2, d[i], d[i+1], d[i+2]]; }
  }
  return { darkest, at };
}
// wash check below crop (y 688.7..695) x355..530 & x300..342
console.log('wash below crop y688.7-694:', JSON.stringify(minDark(355, 530, 688.7, 694)));
console.log('wash left of crop x300-342 y644-688:', JSON.stringify(minDark(300, 342, 644, 688)));
console.log('wash right of crop x536-570 y644-688:', JSON.stringify(minDark(536, 570, 644, 688)));
console.log('glyph zone darkest:', JSON.stringify(minDark(348.5, 528, 627.5, 639.5)));
console.log('wash zone darkest x365-530 y660-686:', JSON.stringify(minDark(365, 530, 660, 686)));
// row-wise presence of wash beyond y687.5: count light rows
let rows = [];
for (let y = Math.round(686*2); y < Math.round(695*2); y++) {
  let c = 0;
  for (let x = Math.round(365*2); x < Math.round(530*2); x++) {
    const i = (y*W+x)*4; const L = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
    if (L < 245) c++;
  }
  rows.push([y/2, c]);
}
console.log('row coverage y686-695 x365-530:', rows.map(r=>r[0].toFixed(1)+':'+r[1]).join(' '));
