/** The usual shape (width / height) of these photos, so tiles fit most of them exactly and show every one whole. */
export function commonAspect(photos: { width?: number | null; height?: number | null }[], fallback = 1.5) {
  const all = photos.flatMap((p) => (p.width && p.height ? [p.width / p.height] : [])).sort((a, b) => a - b);
  return all.length ? Math.min(2, Math.max(0.33, all[Math.floor(all.length / 2)])) : fallback;
}
