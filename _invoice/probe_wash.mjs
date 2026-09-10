import { loadImage, createCanvas } from '@napi-rs/canvas';
const img = await loadImage('_invoice/page.png');
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width;
// column profile: for x in 250..580pt count "washed" px (L in 120..230 = light tone) and dark (<120) at rows y644..690
function colProf(x0, x1, y0, y1) {
  const out = [];
  for (let x = x0*2; x < x1*2; x++) {
    let light = 0, dark = 0;
    for (let y = y0*2; y < y1*2; y++) {
      const i = (y*W + x)*4;
      const L = d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
      if (L < 110) dark++;
      else if (L < 235) light++;
    }
    out.push([x/2, light, dark]);
  }
  return out;
}
// wash likely tan/gold: check channel balance for a few sample columns
function sample(xpt, ypt) {
  const i = (Math.round(ypt*2)*W + Math.round(xpt*2))*4;
  return [d[i], d[i+1], d[i+2]];
}
console.log('colored samples:');
for (const x of [310, 330, 342, 360, 400, 450, 500, 545, 560, 570]) {
  const s1 = sample(x, 650), s2 = sample(x, 675), s3 = sample(x, 685);
  console.log(' x', x, ' y650', s1.join(','), ' y675', s2.join(','), ' y685', s3.join(','));
}
// extent scan: where light-tonal coverage > 40% of rows in band y655..688
console.log('\nx-extent (light coverage fraction of rows y655-688):');
for (const [x, light, dark] of colProf(285, 575, 655, 688)) {
  const frac = light / 66;
  if (x % 5 === 0) console.log(' x' + x.toFixed(0), (frac*100).toFixed(0) + '%', dark ? ' dark:' + dark : '');
}
