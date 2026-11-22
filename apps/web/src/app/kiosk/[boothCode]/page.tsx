import { Kiosk } from "@/components/kiosk/Kiosk";

// Guest-facing. No admin session needed or used: the kiosk authenticates with its own paired cookie.
export default async function KioskPage({ params }: { params: Promise<{ boothCode: string }> }) {
  const { boothCode } = await params;
  return <Kiosk boothCode={decodeURIComponent(boothCode).toUpperCase()} />;
}
