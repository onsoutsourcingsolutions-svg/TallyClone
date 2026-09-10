import { loadImage, createCanvas } from '@napi-rs/canvas';
const img = await loadImage('_invoice/page.png');
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width;
function rowCount(x0pt, x1pt, y0, y1, thr = 3) {
  const out = [];
  const xa = Math.round(x0pt*2), xb = Math.round(x1pt*2);
  for (let y = Math.round(y0*2); y < Math.round(y1*2); y++) {
    let dark=0, colored=0;
    for (let x = xa; x < xb; x++) {
      const i = (y*W + x)*4;
      const L = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
      if (L < 200) { dark++; if (Math.abs(d[i]-d[i+2]) > 18 || Math.abs(d[i]-d[i+1]) > 14 || Math.abs(d[i+1]-d[i+2]) > 14) colored++; }
    }
    out.push([y/2, dark, colored]);
  }
  return out;
}
function bands(rr, thr) {
  const res=[]; let band=null;
  for (const [y,c,col] of rr){
    const on = c > thr;
    if (on && !band) band=[y,y,c,col];
    else if (on && band){ band[1]=y; band[2]=Math.max(band[2],c); band[3]=Math.max(band[3],col); }
    else if (!on && band){ res.push(band); band=null; }
  }
  if (band) res.push(band);
  return res;
}
console.log('== left zone x14-290 y540-700 (para/words/rule 622) ==');
for (const b of bands(rowCount(14, 292, 540, 700), 3)) console.log(' band', b[0].toFixed(1), '->', b[1].toFixed(1), 'dark', b[2], 'col', b[3]);
console.log('== caption zone x90-225 y600-645 ==');
for (const b of bands(rowCount(90, 225, 600, 645), 3)) console.log(' band', b[0].toFixed(1), '->', b[1].toFixed(1), 'dark', b[2], 'col', b[3]);
console.log('== full-width rule check x14-570 y619-624 (px counts) ==');
for (const [y,c,col] of rowCount(14, 570, 619, 624, 0)) console.log(' ', y.toFixed(2), 'dark', c, 'col', col);
