import { loadImage, createCanvas } from '@napi-rs/canvas';
const img = await loadImage('_invoice/page.png');
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width;
// left col para vs right col bank rows separated by x
for (const [label, xa, xb] of [['para x14-296', 14, 296], ['bank x302-560', 302, 560], ['words x540-570', 540, 568]]) {
  console.log('==', label);
  let band = null;
  for (let y = Math.round(540*2); y < Math.round(700*2); y++) {
    let c = 0;
    for (let x = Math.round(xa*2); x < Math.round(xb*2); x++) {
      const i = (y*W+x)*4;
      if (d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114 < 200) c++;
    }
    const on = c > 4;
    if (on && !band) band = [y/2, y/2];
    else if (on && band) band[1] = y/2;
    else if (!on && band) { console.log(' ink', band[0].toFixed(1), '->', band[1].toFixed(1)); band = null; }
  }
  if (band) console.log(' ink', band[0].toFixed(1), '->', band[1].toFixed(1));
}
