import json from "./compatibility.json" with { type: "json" }; // a real import, so the build copies the file
import type { Compatibility } from "./types.js";

const data = json as { entries: { model: string; match: string; os: string; tested: Compatibility; limitations: string }[] };

/** What pbooth knows about this camera model. Unknown models are 'untested', never assumed to work. */
export function compatibilityFor(model: string, os: "linux" | "windows" | "darwin") {
  if (os === "win32" as string || os === "windows") return { tested: "unsupported" as Compatibility, limitations: "DSLR on Windows needs vendor SDKs (not in v1)." };
  const hit = data.entries.find((e) => e.os === "linux" && e.match && new RegExp(`^${e.match}`, "i").test(model));
  return hit ? { tested: hit.tested, limitations: hit.limitations } : { tested: "untested" as Compatibility, limitations: "Not in the pbooth compatibility list yet." };
}

export const registry = data;
