import { loadImage, createCanvas } from '@napi-rs/canvas';
const img = await loadImage('_invoice/page.png'); // 2 px/pt
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width;
// zone: right column x300-571 pt ; also full width x13-571 for rules
function rowCount(x0pt, x1pt, ypt0, ypt1) {
  const out = [];
  const xa = Math.round(x0pt*2), xb = Math.round(x1pt*2);
  for (let y = Math.round(ypt0*2); y < Math.round(ypt1*2); y++) {
    let c = 0, dark=0;
    for (let x = xa; x < xb; x++) {
      const i = (y*W + x)*4; const L = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
      if (L < 200) { dark++; }
    }
    out.push([y/2, dark]);
  }
  return out;
}
// find contiguous bands of dark ink rows in right zone 525-700
const rr = rowCount(302, 570, 520, 760);
let band=null; const bands=[];
for (const [y,c] of rr){
  const on = c > 3;
  if (on && !band) band=[y,y,c];
  else if (on && band){ band[1]=y; if(c>band[2])band[2]=c; }
  else if (!on && band){ bands.push(band); band=null; }
}
if (band) bands.push(band);
for (const b of bands) console.log('band', b[0].toFixed(1), '->', b[1].toFixed(1), 'maxpx', b[2]);
