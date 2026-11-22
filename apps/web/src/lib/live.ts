"use client";
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { BoothDto, EventSessions } from "./types";

/**
 * Booths that update themselves: starts from the server-rendered list, then applies changes the
 * API pushes over Socket.IO (heartbeats, enrollments, assignments, booths going offline).
 * `keep` decides which booths belong on this page (e.g. only those assigned to one event).
 * `initial` must be a stable reference (a prop or useMemo): a new array resets the live data.
 */
export function useLiveBooths(initial: BoothDto[], keep: (b: BoothDto) => boolean = () => true, sessionsFor?: { eventId: string; initial: EventSessions }) {
  const [booths, setBooths] = useState(initial);
  const [sessions, setSessions] = useState(sessionsFor?.initial);
  const [connected, setConnected] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => setBooths(initial), [initial]); // a router.refresh() brings a new server list

  useEffect(() => {
    const socket = io({ path: "/socket.io", withCredentials: true });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("unauthorized", () => location.replace("/login"));
    if (sessionsFor) {
      socket.on("sessions", (msg: { eventId: string; stats: EventSessions }) => { if (msg.eventId === sessionsFor.eventId) setSessions(msg.stats); });
    }
    socket.on("booths", ({ booths: changed }: { booths: BoothDto[] }) => {
      setBooths((list) => {
        const byId = new Map(list.map((b) => [b.id, b]));
        for (const b of changed) keep(b) ? byId.set(b.id, b) : byId.delete(b.id);
        return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
      });
    });
    return () => { socket.disconnect(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-render every 5 s so "last seen 12 s ago" stays true between pushes.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  return { booths, connected, sessions };
}
