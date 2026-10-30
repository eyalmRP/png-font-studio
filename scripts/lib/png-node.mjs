// Node-only PNG helpers for build scripts and tests.
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { createImage } from '../../src/core/image.js';

export function decodePNG(bytes) {
  const png = PNG.sync.read(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
  return createImage(png.width, png.height, new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length));
}

export function readPNG(path) {
  return decodePNG(fs.readFileSync(path));
}

export function encodePNG(img) {
  const png = new PNG({ width: img.width, height: img.height });
  png.data = Buffer.from(img.data.buffer, img.data.byteOffset, img.data.length);
  return PNG.sync.write(png, { colorType: 6, deflateLevel: 9 });
}

export function writePNG(path, img) {
  fs.writeFileSync(path, encodePNG(img));
}
