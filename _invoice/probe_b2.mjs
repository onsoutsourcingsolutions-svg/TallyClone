import { loadImage, createCanvas } from '@napi-rs/canvas';
const img = await loadImage('_invoice/page.png');
const cv = createCanvas(img.width, img.height);
const ctx = cv.getContext('2d');
ctx.drawImage(img, 0, 0);
const d = ctx.getImageData(0, 0, img.width, img.height).data;
const W = img.width;
function cov(x0, x1, y0, y1) {
  let n = 0, c = 0;
  for (let y = Math.round(y0*2); y < Math.round(y1*2); y++)
    for (let x = Math.round(x0*2); x < Math.round(x1*2); x++) {
      const i = (y*W+x)*4;
      if (d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114 < 200) c++;
      n++;
    }
  return (100*c/n).toFixed(1);
}
const rows = [
 ['hdr Description of Goods', 78,172,283.5,291.5],
 ['hdr HSN/SAC', 236,282,283.5,291.5],
 ['hdr Quantity', 328,367,283.5,291.5],
 ['hdr Amount', 518,554,283.5,291.5],
 ['item1 CHEMIEBOR', 44,206,311,323.5],
 ['item1 hsn 28401900', 237,281,311,318],
 ['item qty 2,000', 335,360,311,323.5],
 ['item rate 80.50', 417,443,311,318],
 ['Taxable Value', 148,215,364,371.5],
 ['Output SGST label', 150,215,417,426],
 ['9%', 413,428,416.5,424],
 ['roundOff -', 551,556,443,450.5],
 ['Total label', 190,215,496,504.5],
 ['Total qty 2,000', 335,360,496,504.5],
 ['Total amt', 514,566,496,506.5],
 ['words label', 14,144,509,517],
 ['E.O.E', 540,567,509,517],
 ['words value Rupees', 14,345,523,536],
 ['mini hdr taxableValue', 314,378,536,547],
 ['mini hdr SGST', 407,434,536,547],
 ['mini val 1,61,000.00', 343,389,549,559],
 ['mini val 14,490.00', 404,443,549,559],
 ['decl L1 7.2', 14,288,549,556],
 ['Our Banking Details', 302,382,561.5,568.5],
 ['Name of A/c Holder-', 302,386,574,581],
 ['bank val O N S...', 386,544,574,581],
 ['caption', 93,221,624.5,632],
];
for (const r of rows) console.log(r[0].padEnd(28), cov(...r.slice(1)) + '%');
