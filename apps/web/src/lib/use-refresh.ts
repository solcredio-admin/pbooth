"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-reads the page every `ms` while it's on screen, and once when it comes back; nothing while the tab is hidden. */
export function useRefresh(ms: number, on = true) {
  const router = useRouter();
  useEffect(() => {
    if (!on) return;
    let t: ReturnType<typeof setInterval> | undefined;
    const start = () => { clearInterval(t); if (document.visibilityState === "visible") t = setInterval(() => router.refresh(), ms); };
    const back = () => { if (document.visibilityState === "visible") router.refresh(); start(); };
    start();
    document.addEventListener("visibilitychange", back);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", back); };
  }, [router, ms, on]);
}
