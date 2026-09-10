import { loadImage, createCanvas } from '@napi-rs/canvas';
const img = await loadImage('_invoice/page.png');
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width;
// ink columns near x301 for y 500..560 (words text zone) — print dark count per row in x 295..306
for (let y = Math.round(500*2); y < Math.round(560*2); y++) {
  let cols = [];
  for (let x = Math.round(295*2); x < Math.round(307*2); x++) {
    const i = (y*W+x)*4; const L = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
    if (L < 200) cols.push((x/2).toFixed(1));
  }
  if (cols.length) console.log((y/2).toFixed(1), cols.join(','));
}
