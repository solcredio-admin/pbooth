import { Kiosk } from "@/components/kiosk/Kiosk";

// A reload in the middle of a guest's turn lands here. That turn's photos only lived in memory,
// so the kiosk starts fresh at the welcome screen (the server closes the stale session as unfinished
// only when the kiosk reports it; an unreported one simply stays STARTED).
export default async function KioskSessionPage({ params }: { params: Promise<{ boothCode: string }> }) {
  const { boothCode } = await params;
  return <Kiosk boothCode={decodeURIComponent(boothCode).toUpperCase()} />;
}
