import { loadImage, createCanvas } from '@napi-rs/canvas';
const img = await loadImage('_invoice/page.png');
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width;
// dark count per row, x=300..304.5pt (vline zone), y 500..540
for (let y = Math.round(500*2); y < Math.round(540*2); y++) {
  let c = 0, txt = 0;
  for (let x = Math.round(299.5*2); x < Math.round(302.5*2); x++) { const i=(y*W+x)*4; if (d[i]<200) c++; }
  for (let x = Math.round(302.5*2); x < Math.round(307*2); x++) { const i=(y*W+x)*4; if (d[i]<200) txt++; }
  if (c || txt) console.log((y/2).toFixed(1), 'vline', c, 'txtR', txt);
}
