import type { Metadata } from "next";
import { Gallery } from "@/components/Gallery";

export const metadata: Metadata = { title: "Your photos", robots: { index: false, follow: false } };

// Guests land here from the kiosk's QR code. No account: the unguessable link is the key.
// Data is fetched by the browser itself, so rate limits apply per guest, not per server.
export default async function GalleryPage({ params }: { params: Promise<{ token: string }> }) {
  return <Gallery token={(await params).token} />;
}
