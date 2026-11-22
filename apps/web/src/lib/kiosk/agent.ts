"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { kioskFetch } from "./api";

// The pbooth agent on this same computer (DSLR cameras and printing). Only loopback; the agent
// only answers this site, and only after pairing with a 5-minute ticket the cloud signs.
export const AGENT = "http://127.0.0.1:47800";

export interface AgentStatus {
  camera: null | { status: "connected" | "disconnected" | "error" | "unsupported"; name?: string; error?: string; compatibility?: string };
  printer: null | { status: string; name?: string; message?: string };
  printJobs: { queued: number; failed: number; completedToday: number };
}
export interface AgentJob { id: string; status: "queued" | "submitting" | "submitted" | "printing" | "completed" | "failed" | "cancelled"; error: string | null }

export function useAgent(boothCode: string | undefined, wanted: boolean) {
  const [available, setAvailable] = useState(false);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const token = useRef<string | null>(null);
  const [tokenState, setTokenState] = useState<string | null>(null);

  const call = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${AGENT}${path}`, { ...init, headers: { ...(init.headers ?? {}), ...(token.current ? { authorization: `Bearer ${token.current}` } : {}) }, signal: init.signal ?? AbortSignal.timeout(8000) });
    if (res.status === 401) { token.current = null; setTokenState(null); }
    return res;
  }, []);

  useEffect(() => {
    if (!wanted || !boothCode) { setAvailable(false); return; }
    let stop = false;
    const tick = async () => {
      try {
        const h = await fetch(`${AGENT}/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json());
        if (h.boothCode !== boothCode) { setAvailable(false); setProblem(h.boothCode ? `The agent here is enrolled for ${h.boothCode}` : "The agent here isn't enrolled"); return; }
        if (!token.current) {
          const t = await kioskFetch<{ ticket: string }>("POST", "/kiosk/agent-ticket");
          if (!t.ok) { setAvailable(false); setProblem(t.message); return; }
          const p = await fetch(`${AGENT}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: t.data.ticket }), signal: AbortSignal.timeout(5000) });
          if (!p.ok) { setAvailable(false); setProblem("Couldn't pair with the agent"); return; }
          token.current = (await p.json()).token;
          setTokenState(token.current);
        }
        const s = await call("/status");
        if (s.ok) { setStatus(await s.json()); setAvailable(true); setProblem(null); }
      } catch {
        if (!stop) { setAvailable(false); setProblem("The pbooth agent isn't running on this computer"); }
      }
    };
    tick();
    const t = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [wanted, boothCode, call]);

  const capture = useCallback(async () => {
    const r = await call("/camera/capture", { method: "POST", signal: AbortSignal.timeout(40_000) });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.error?.message ?? "Capture failed");
    return r.blob();
  }, [call]);

  /** Idempotent by session id: sending the same print twice never prints twice. */
  const print = useCallback(async (id: string, image: Blob, copies: number): Promise<AgentJob> => {
    const r = await call(`/print?id=${id}&copies=${copies}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: image, signal: AbortSignal.timeout(30_000) });
    const body = await r.json().catch(() => null);
    if (!r.ok) throw new Error(body?.error?.message ?? "Print failed");
    return body.job;
  }, [call]);

  const job = useCallback(async (id: string): Promise<AgentJob | null> => {
    const r = await call(`/print/${id}`);
    return r.ok ? (await r.json()).job : null;
  }, [call]);

  return { available, status, problem, liveUrl: tokenState ? `${AGENT}/camera/live?t=${encodeURIComponent(tokenState)}` : null, capture, print, job };
}
