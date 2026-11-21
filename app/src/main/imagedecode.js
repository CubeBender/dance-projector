'use strict';
// Re-encodes images (judge photos, background images) to a plain baseline JPEG, using Chromium's own decoder in
// a hidden window instead of Electron's nativeImage. Two reasons, both seen with real judge photos:
//   1. Phone photos are often stored sideways with an EXIF "orientation" tag that says how to turn them.
//      nativeImage ignores the tag, so such photos came out rotated. The browser applies it.
//   2. A photo whose file is cut off at the very end (e.g. an interrupted download) is refused by nativeImage,
//      while the browser shows everything that is there – usually the whole picture.
// It can also turn the picture by 90/180/270 degrees (the rotate buttons in the Adjust photo window).
//
// The hidden window only ever loads this module's own blank page and local image files.
const { BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

let worker = null;       // the hidden window, created on first use
let idleTimer = null;    // closes it after a quiet minute so it doesn't keep memory or block quitting

async function getWorker() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(closeWorker, 60000);
  if (worker && !worker.isDestroyed()) return worker;
  worker = new BrowserWindow({
    show: false, width: 200, height: 200,
    // webSecurity off: a page may only draw local files into a canvas and read the pixels back this way.
    // The window never loads anything but a blank page and the image files we hand it.
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: false, backgroundThrottling: false },
  });
  await worker.loadURL('data:text/html;charset=utf-8,<!doctype html><title>decoder</title>');
  return worker;
}

function closeWorker() {
  clearTimeout(idleTimer);
  if (worker && !worker.isDestroyed()) worker.destroy();
  worker = null;
}

// Runs inside the hidden window (passed as source text). Loads the image, applies its EXIF orientation (the
// browser does this by default), turns it by `rotate` degrees, scales it to at most maxWidth wide and returns a
// JPEG data URL. Transparent areas (PNG) become the dark grey of the judge card, so cut-out portraits blend in.
function decodeInPage(url, maxWidth, rotate) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('could not be read – not a JPEG/PNG/WebP image, or the file is damaged'));
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;          // already in the EXIF-corrected orientation
      if (!w || !h) { reject(new Error('could not be read – the image has no pixels')); return; }
      const turned = Math.abs(rotate) % 180 === 90;               // a quarter turn swaps width and height
      const scale = Math.min(1, maxWidth / (turned ? h : w));
      const dw = Math.round(w * scale), dh = Math.round(h * scale);
      const c = document.createElement('canvas');
      c.width = turned ? dh : dw; c.height = turned ? dw : dh;
      const ctx = c.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#1b1f2a';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate((rotate * Math.PI) / 180);
      ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      resolve({ data: c.toDataURL('image/jpeg', 0.9), width: c.width, height: c.height });
    };
    img.src = url;
  });
}

// A JPEG cut off before its end marker (FF D9) is treated by Chromium as "still loading" and draws as nothing.
// Appending the marker to a temporary copy lets the decoder finish with the data that is there; for a file
// missing only its last bytes that is the whole picture. Returns the path to decode (the copy, or src itself).
function completeTruncatedJpeg(src) {
  const buf = fs.readFileSync(src);
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8;
  if (!isJpeg || (buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9)) return src;
  const tmp = path.join(os.tmpdir(), `dp-fixed-${Date.now()}.jpg`);
  fs.writeFileSync(tmp, Buffer.concat([buf, Buffer.from([0xff, 0xd9])]));
  return tmp;
}

// Reads src, writes the re-encoded JPEG to dest. Returns { width, height } of the result.
async function encodeImage(src, dest, { maxWidth = 900, rotate = 0 } = {}) {
  const w = await getWorker();
  const input = completeTruncatedJpeg(src);
  const call = `(${decodeInPage.toString()})(${JSON.stringify(pathToFileURL(input).href)}, ${Number(maxWidth)}, ${Number(rotate)})`;
  let out;
  try { out = await w.webContents.executeJavaScript(call); }
  catch (e) { throw new Error(String(e.message || e).replace(/^.*?Error: /, '')); } // keep just our message
  finally { if (input !== src) fs.rm(input, { force: true }, () => {}); }
  fs.writeFileSync(dest, Buffer.from(out.data.slice(out.data.indexOf(',') + 1), 'base64'));
  return { width: out.width, height: out.height };
}

// ---- preparing a photo of a printout for text recognition (D-24) ----
// Runs inside the hidden window. Enlarges the picture (text recognition wants letters about 20–30 px tall; a
// webcam sees a whole A4 page with letters of 8–10 px), turns it grey, and evens out the light: a heavily blurred copy
// of the picture is the "lighting", and each pixel is divided by it, so a shadow over half the sheet disappears and
// the paper becomes white everywhere. The blur is made cheaply by drawing the picture tiny and stretching it back.
// rotate: degrees clockwise (0, 90, 180, 270) that make the text upright – a webcam turned on its side to fit a
// whole A4 page gives a picture lying on its side, and Tesseract only reads upright text.
// enhance: false = only enlarge and turn (the "as taken" reading, see C-39).
function prepareInPage(url, maxSide, rotate, enhance) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('could not be read – not an image, or the file is damaged'));
    img.onload = () => {
      const w0 = img.naturalWidth, h0 = img.naturalHeight;
      const scale = Math.min(2, maxSide / Math.max(w0, h0));
      const sw0 = Math.round(w0 * scale), sh0 = Math.round(h0 * scale);   // size of the photo, enlarged
      const side = rotate === 90 || rotate === 270;                     // a quarter turn swaps width and height
      const w = side ? sh0 : sw0, h = side ? sw0 : sh0;
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.imageSmoothingQuality = 'high';
      // turn around the centre of the new canvas, then draw the photo centred on it
      ctx.translate(w / 2, h / 2); ctx.rotate((rotate * Math.PI) / 180);
      ctx.drawImage(img, -sw0 / 2, -sh0 / 2, sw0, sh0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (!enhance) { resolve(c.toDataURL('image/png')); return; }
      // lighting: 1/24 of the size, smoothed, stretched back up
      const sw = Math.max(8, Math.round(w / 24)), sh = Math.max(8, Math.round(h / 24));
      const small = document.createElement('canvas'); small.width = sw; small.height = sh;
      const sctx = small.getContext('2d'); sctx.filter = 'blur(2px)'; sctx.drawImage(c, 0, 0, sw, sh);
      const bgc = document.createElement('canvas'); bgc.width = w; bgc.height = h;
      const bctx = bgc.getContext('2d', { willReadFrequently: true }); bctx.imageSmoothingQuality = 'high'; bctx.drawImage(small, 0, 0, w, h);
      const px = ctx.getImageData(0, 0, w, h), bg = bctx.getImageData(0, 0, w, h).data, d = px.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const b = 0.299 * bg[i] + 0.587 * bg[i + 1] + 0.114 * bg[i + 2] || 1;
        const v = Math.min(255, (g / b) * 235);
        d[i] = d[i + 1] = d[i + 2] = v;
      }
      ctx.putImageData(px, 0, 0);
      resolve(c.toDataURL('image/png'));
    };
    img.src = url;
  });
}

// Reads src (a photo of a printout), writes the prepared PNG to dest.
// rotate: degrees clockwise to make the text upright; enhance: false = only enlarge and turn.
async function prepareForOcr(src, dest, { maxSide = 3600, rotate = 0, enhance = true } = {}) {
  const w = await getWorker();
  const rot = [0, 90, 180, 270].includes(Number(rotate)) ? Number(rotate) : 0;
  const call = `(${prepareInPage.toString()})(${JSON.stringify(pathToFileURL(src).href)}, ${Number(maxSide)}, ${rot}, ${enhance ? 'true' : 'false'})`;
  let data;
  try { data = await w.webContents.executeJavaScript(call); }
  catch (e) { throw new Error(String(e.message || e).replace(/^.*?Error: /, '')); }
  fs.writeFileSync(dest, Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'));
}

module.exports = { encodeImage, prepareForOcr, closeWorker };
