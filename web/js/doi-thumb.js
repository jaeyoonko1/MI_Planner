// Browser-side thumbnails for DOI images (D-33): decode on a canvas, no server imaging library.
import { thumbSize } from "./doi-model.js";

export async function decode(file) {
  try {
    const bmp = await createImageBitmap(file);
    return { bmp, w: bmp.width, h: bmp.height };
  } catch { return null; }
}

export async function drawThumb(decoded) {
  const { w, h } = thumbSize(decoded.w, decoded.h, 480);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(decoded.bmp, 0, 0, w, h);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/jpeg", 0.82));
}
