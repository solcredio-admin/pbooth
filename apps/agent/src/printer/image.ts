import sharp from "sharp";

// Turns the kiosk's design into a file sized exactly for the paper, at 300 dpi.
//   4x6 / 5x7: the image fills the page (rotated if its orientation doesn't match).
//   2x6 strips: printers load 4x6 media and cut it, so two copies go side by side on a 4x6.
export const PAPER = { "4x6": [4, 6], "5x7": [5, 7], "2x6": [4, 6] } as const;
export type Paper = keyof typeof PAPER;

export async function preparePrint(input: Buffer, paper: Paper, orientation: "portrait" | "landscape") {
  const [wIn, hIn] = PAPER[paper];
  const portrait = paper === "2x6" || orientation === "portrait";
  const [W, H] = portrait ? [wIn * 300, hIn * 300] : [hIn * 300, wIn * 300];
  let img = sharp(input).rotate(); // honour EXIF orientation from cameras
  const meta = await img.metadata();
  const srcLandscape = (meta.width ?? 1) > (meta.height ?? 1);

  if (paper === "2x6") {
    const strip = await img.resize(W / 2, H, { fit: "cover" }).jpeg({ quality: 95 }).toBuffer();
    const out = await sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } })
      .composite([{ input: strip, left: 0, top: 0 }, { input: strip, left: W / 2, top: 0 }])
      .withMetadata({ density: 300 }).jpeg({ quality: 95 }).toBuffer();
    return { buffer: out, widthIn: wIn, heightIn: hIn, landscape: false };
  }

  if (srcLandscape !== W > H) img = sharp(await img.rotate(90).toBuffer());
  const out = await img.resize(W, H, { fit: "cover" }).withMetadata({ density: 300 }).jpeg({ quality: 95 }).toBuffer();
  return { buffer: out, widthIn: portrait ? wIn : hIn, heightIn: portrait ? hIn : wIn, landscape: !portrait };
}
