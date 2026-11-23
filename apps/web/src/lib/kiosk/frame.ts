// Every photo has the booth screen's shape (16:9, or 9:16 for a portrait booth), so the full-screen
// preview shows exactly what is captured. The camera image is turned first (a sideways-mounted camera),
// then centre-cropped to that shape.

export type Rotation = 0 | 90 | 180 | 270;
export const boothAspect = (portrait: boolean) => (portrait ? 9 / 16 : 16 / 9);

/** Output size for a w x h camera image turned by `rotation` and cropped to `aspect`. */
export function frameSize(w: number, h: number, rotation: Rotation, aspect: number) {
  const sideways = rotation === 90 || rotation === 270;
  const rw = sideways ? h : w, rh = sideways ? w : h;
  return rw / rh > aspect
    ? { width: Math.round(rh * aspect), height: rh }
    : { width: rw, height: Math.round(rw / aspect) };
}

/** Turns and crops one captured photo (JPEG in, JPEG out). Never mirrored: photos are kept as shot. */
export async function frameShot(blob: Blob, rotation: Rotation, aspect: number): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  try {
    const { width, height } = frameSize(bmp.width, bmp.height, rotation, aspect);
    if (rotation === 0 && width === bmp.width && height === bmp.height) return blob; // already right
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const g = c.getContext("2d")!;
    g.translate(width / 2, height / 2);
    g.rotate((rotation * Math.PI) / 180);
    g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    return await new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("Capture failed"))), "image/jpeg", 0.92));
  } finally {
    bmp.close();
  }
}

/**
 * The live preview's current frame, turned and cropped like the photo will be, as an image URL:
 * shown the instant the shutter fires while the full-resolution photo is still on its way.
 * Returns null when the frame can't be read (no frame yet, or a cross-origin DSLR live view).
 */
export function snapshot(el: HTMLVideoElement | HTMLImageElement, rotation: Rotation, aspect: number, maxWidth = 1280): string | null {
  const w = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
  const h = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
  if (!w || !h) return null;
  const size = frameSize(w, h, rotation, aspect);
  const scale = Math.min(1, maxWidth / size.width);
  const c = document.createElement("canvas");
  c.width = Math.round(size.width * scale);
  c.height = Math.round(size.height * scale);
  const g = c.getContext("2d")!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((rotation * Math.PI) / 180);
  g.scale(scale, scale);
  g.drawImage(el, -w / 2, -h / 2);
  try { return c.toDataURL("image/jpeg", 0.85); } catch { return null; } // a tainted (cross-origin) frame can't be read
}
