import { ago } from "@/lib/format";

// "12 s ago" is computed on the server and again a moment later in the browser; the text
// legitimately differs, so React is told not to treat that as a hydration error.
export function Ago({ iso }: { iso: string | null | undefined }) {
  return <time dateTime={iso ?? undefined} suppressHydrationWarning>{ago(iso)}</time>;
}
