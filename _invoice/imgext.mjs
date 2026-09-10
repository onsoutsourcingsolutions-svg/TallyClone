import { readFileSync, writeFileSync } from 'node:fs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
const buf = new Uint8Array(readFileSync('_invoice/PI-200-REFTECH.pdf'));
const doc = await pdfjsLib.getDocument({ data: buf, verbosity: 0 }).promise;
const page = await doc.getPage(1);
const vp = page.getViewport({ scale: 2 });
const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
const ctx = canvas.getContext('2d');
await page.render({ canvasContext: ctx, viewport: vp }).promise; // resolves objs
// now objects should be loaded
for (const nm of ['img_p0_1', 'img_p0_2', 'img_p0_3', 'img_p0_4']) {
  try {
    const obj = page.objs.get(nm);
    if (!obj) { console.log(nm, 'missing'); continue; }
    console.log(nm, 'w', obj.width, 'h', obj.height, 'kind', obj.kind, 'nCh', obj.nChannels, 'cs', obj.colorSpace);
    if (obj.width && obj.height) {
      // save as png
      const { Image } = await import('@napi-rs/canvas');
      const img = new Image();
      let src;
      if (obj.kind === 1 && obj.nChannels === 4) src = obj.data; // RGBA
      else if (obj.kind === 1 && obj.nChannels === 3) src = obj.data;
      // need to flip? pdf images may be bottom-up; pdfjs obj.data top-down?
      // write raw via putImageData then toBuffer
      const cv = createCanvas(obj.width, obj.height);
      const cx = cv.getContext('2d');
      if (obj.nChannels === 4 || obj.nChannels === 3) {
        const imgd = cx.createImageData(obj.width, obj.height);
        for (let i = 0; i < obj.width * obj.height; i++) {
          imgd.data[i * 4] = obj.data[i * obj.nChannels];
          imgd.data[i * 4 + 1] = obj.data[i * obj.nChannels + 1];
          imgd.data[i * 4 + 2] = obj.data[i * obj.nChannels + 2];
          imgd.data[i * 4 + 3] = obj.nChannels === 4 ? obj.data[i * 4 + 3] : 255;
        }
        cx.putImageData(imgd, 0, 0);
        writeFileSync('_invoice/' + nm + '.png', cv.toBuffer('image/png'));
        console.log('saved _invoice/' + nm + '.png');
      } else if (obj.kind === 3) { // gray
        console.log('gray image (not saved)');
      } else console.log('kind', obj.kind, 'not handled');
    }
  } catch (e) { console.log(nm, 'err', e.message); }
}
