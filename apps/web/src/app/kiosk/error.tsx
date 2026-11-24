"use client";
import { useEffect } from "react";

// Unattended: a broken screen fixes itself. Uploads are safe, they wait in the booth's own storage.
export default function KioskError() {
  useEffect(() => { const t = setTimeout(() => location.reload(), 5000); return () => clearTimeout(t); }, []);
  return <div className="kiosk"><div className="k-center"><h1 className="k-title">One moment.</h1><p className="k-text">This screen is restarting.</p></div></div>;
}
