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
// (label, x0,x1, y0,y1)
const rows = [
 ['title PROFORMA INVOICE', 206,333,25.5,33],
 ['co name O.N.S...', 14,196,41.5,53],
 ['Invoice No. hdr', 218,271,44,54],
 ['no. header  No.', 15,32,44,54],          // header row y 44-54? actually headers 40.78 row
 ['item name CHEMIEBOR', 44,206,311,323.5],
 ['rate 80.50 digits', 417,443,311,318],
 ['qty 2,000', 335,360,311,323.5],
 ['Taxable Value label', 148,215,364,371.5],
 ['Output SGST label', 150,215,417,426],
 ['9% pct', 413,428,416.5,424],
 ['Total label', 190,215,496,504.5],
 ['total amt 1,89,980.00', 514,566,496,506.5],
 ['words label', 14,144,509,517],
 ['words value Rupees...', 14,345,523,536],
 ['mini hdr TaxableValue', 314,378,536,547],
 ['mini val 1,61,000.00', 343,389,549,558.5],
 ['decl L1 7.2', 14,288,549,556],
 ['bank title 9.6', 302,388,562,570],
 ['buyer name REFTECH', 14,106,137,145],
 ['GST line buyer', 14,138,190,198],
 ['E.O.E', 540,567,509,517],
 ['consignee name', 14,106,217,225],
];
for (const [l, x0, x1, y0, y1] of rows) console.log(l.padEnd(34), cov(x0,x1,y0,y1) + '%');
