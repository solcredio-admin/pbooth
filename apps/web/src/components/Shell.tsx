"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Quiet } from "./Quiet";
import { Marks } from "./Marks";
import { ThemeToggle } from "./ThemeToggle";
import { V } from "@/lib/v";
import { can, MeProvider, type Me } from "@/lib/roles";

// WebGL layers only ever run in the browser.
const Scene = dynamic(() => import("./gl/Scene.jsx"), { ssr: false });
const Lift = dynamic(() => import("./gl/Lift.jsx"), { ssr: false });
// While its code loads, the plain logo holds the stage, so the mark never blinks out.
const Intro = dynamic(() => import("./gl/Intro.jsx"), {
  ssr: false,
  loading: () => <div className="intro-stage"><div className="liquid"><Marks /></div></div>,
});

const NAV = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/events", label: "Events" },
  { href: "/booths", label: "Booths" },
  { href: "/settings", label: "Settings" },
];
const MARKS = [
  { src: `/logo-light.png?v=${V}`, cls: "mark only-light" },
  { src: `/logo-dark.png?v=${V}`, cls: "mark only-dark" },
];

// Everything around the admin pages: the gradient, the post-login intro, the top bar,
// the sign-out choreography and the bottom-corner controls.
export function Shell({ children, me }: { children: ReactNode; me: Me }) {
  const may = can(me.role);
  const path = usePathname();
  const [intro, setIntro] = useState<"pending" | "on" | "off">("pending");
  const [scene, setScene] = useState(false);
  const [sceneOn, setSceneOn] = useState(false);

  useEffect(() => {
    // Paper Shaders injects an inline <style> unless a tagged one exists; CSP forbids
    // inline styles, so claim the slot with an empty tag (its rules live in glass.css).
    if (!document.querySelector("style[data-paper-shader]")) {
      const slot = document.createElement("style");
      slot.setAttribute("data-paper-shader", "");
      document.head.append(slot);
    }
    (window as unknown as { pbLoaded: boolean }).pbLoaded = true; // pages arrive server-rendered with their data
    if (location.search.includes("intro")) history.replaceState(null, "", location.pathname); // a reload skips the intro
    if (document.documentElement.classList.contains("intro")) setIntro("on");
    else { setIntro("off"); setScene(true); }
  }, []);

  useEffect(() => {
    if (!scene) return;
    const t = setTimeout(() => setSceneOn(true), 120); // melt over the CSS gradient once drawn
    return () => clearTimeout(t);
  }, [scene]);

  // Content rises exactly once as the logo clears; the gradient mounts after the rise
  // (its shader compile would otherwise stall the animation).
  const reveal = useCallback(() => {
    document.body.classList.add("reveal");
    setTimeout(() => document.body.classList.remove("reveal"), 1500);
    setTimeout(() => setScene(true), 1300);
  }, []);
  const done = useCallback(() => {
    document.documentElement.classList.remove("intro");
    setIntro("off");
  }, []);

  const signOut = async () => {
    document.documentElement.classList.add("signing-out");
    const leaving = fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => null);
    await Promise.all([leaving, new Promise((r) => setTimeout(r, 950))]);
    location.replace("/login?out");
  };

  return (
    <>
      <div id="scene" className={sceneOn ? "on" : undefined} aria-hidden="true">
        {scene && <Quiet><Scene /></Quiet>}
      </div>
      {intro !== "off" && (
        <div id="intro" data-liquid={`/logo-liquid.png?v=${V}`}>
          {intro === "on" ? (
            <Quiet onFail={() => setTimeout(() => { reveal(); done(); })}>
              <Intro liquid={`/logo-liquid.png?v=${V}`} marks={MARKS} caption="Setting up the booth…" onLeave={reveal} onDone={done} />
            </Quiet>
          ) : (
            <div className="intro-stage"><div className="liquid"><Marks /></div></div>
          )}
        </div>
      )}
      <header className="bar">
        <Link className="brand" href="/dashboard" aria-label="pbooth home">
          <Marks className="brand-logo" />
        </Link>
        <nav className="nav" aria-label="Main">
          {NAV.filter((n) => n.href !== "/booths" || me.role !== "EVENTS").map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href || (n.href !== "/dashboard" && path.startsWith(n.href)) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="acts">
          <button className="plain icon" type="button" onClick={signOut} aria-label="Sign out" title="Sign out">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7" /><path d="M11 12h10" /><path d="M17.5 8.5 21 12l-3.5 3.5" /></svg>
          </button>
        </div>
      </header>
      <MeProvider value={me}>{children}</MeProvider>
      <div id="lift" aria-hidden="true">{scene && <Quiet><Lift /></Quiet>}</div>
      <ThemeToggle />
      {may.editEvents && path !== "/events/new" && <Link className="plain add-agent" href="/events/new">+ New event</Link>}
      <div id="outro" aria-hidden="true"><Marks /></div>
    </>
  );
}
