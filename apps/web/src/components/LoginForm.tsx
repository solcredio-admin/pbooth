"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Marks } from "./Marks";
import { send } from "@/lib/client-api";

const DURATION = 750; // matches .fly / .curtain in glass.css
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const introSize = () => Math.min(Math.min(innerWidth, innerHeight) * 0.56, 320); // = .liquid in the intro

// Sign in: the password is checked first; only when accepted does the logo fly from the
// card to the centre, landing exactly where the dashboard's intro starts. A wrong
// password never animates. Arriving from sign-out (?out) plays the reverse.
export function LoginForm() {
  const form = useRef<HTMLFormElement>(null);
  const pw = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function flight(toCentre: boolean) {
    const root = document.documentElement;
    const logo = [...form.current!.querySelectorAll<HTMLImageElement>(".logo")].find((l) => l.offsetParent) ?? form.current!.querySelector<HTMLImageElement>(".logo")!;
    const r = logo.getBoundingClientRect();
    const s = introSize();
    const atCard = `translate(${r.left + r.width / 2 - innerWidth / 2}px, ${r.top + r.height / 2 - innerHeight / 2}px) scale(${r.width / s})`;
    const curtain = document.createElement("div");
    curtain.className = "curtain";
    curtain.style.opacity = toCentre ? "0" : "1";
    const fly = document.createElement("img");
    fly.className = "fly";
    fly.alt = "";
    fly.src = logo.src;
    Object.assign(fly.style, {
      width: `${s}px`, height: `${s}px`, left: `${innerWidth / 2 - s / 2}px`, top: `${innerHeight / 2 - s / 2}px`,
      transform: toCentre ? atCard : "none",
    });
    try { await fly.decode(); } catch {}
    document.body.append(curtain, fly);
    logo.style.visibility = "hidden";
    if (toCentre) root.classList.add("leaving");
    root.classList.remove("out");
    await frames(); // the start state must be painted, or the transition is skipped
    fly.style.transform = toCentre ? "none" : atCard;
    curtain.style.opacity = toCentre ? "1" : "0";
    await wait(DURATION);
    return () => { curtain.remove(); fly.remove(); logo.style.visibility = ""; };
  }

  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("out")) return;
    history.replaceState(null, "", "/login");
    root.classList.add("leaving");
    flight(false).then((cleanup) => { cleanup(); root.classList.remove("leaving"); });
  }, []);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const res = await send("POST", "/auth/login", { username: data.get("username"), password: data.get("password") });
    if (res.ok) {
      await flight(true);
      location.replace("/dashboard?intro");
      return;
    }
    setBusy(false);
    setError(res.status === 429 ? "Too many attempts. Try again in 15 minutes." : res.status === 401 || res.status === 400 ? "Wrong username or password." : res.message);
    if (pw.current) { pw.current.value = ""; pw.current.focus(); }
  }

  return (
    <form ref={form} method="post" onSubmit={submit} autoComplete="on">
      <Marks className="logo" alt="pbooth" />
      <h1>Every booth, every guest, every frame.</h1>
      <label className="cap">Username <input name="username" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required autoFocus /></label>
      <label className="cap">Password <input ref={pw} name="password" type="password" autoComplete="current-password" required /></label>
      <div className="cap err" role="alert">{error}</div>
      <button type="submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
