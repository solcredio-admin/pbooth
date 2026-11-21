"use client";
import { useEffect, useState } from "react";

const current = () => document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");

// Bottom-left Light/Dark switch. Colours glide while the shader palette morphs (Scene.jsx).
export function ThemeToggle() {
  const [next, setNext] = useState<"light" | "dark" | null>(null);
  useEffect(() => {
    const update = () => setNext(current() === "dark" ? "light" : "dark");
    update();
    const mq = matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const toggle = () => {
    const root = document.documentElement;
    root.classList.add("theme-anim");
    setTimeout(() => root.classList.remove("theme-anim"), 950);
    root.dataset.theme = current() === "dark" ? "light" : "dark";
    try { localStorage.setItem("pb-theme", root.dataset.theme); } catch {}
    setNext(root.dataset.theme === "dark" ? "light" : "dark");
  };

  return (
    <button type="button" className="plain theme-toggle" onClick={toggle} aria-label={next ? `Switch to ${next} mode` : "Switch theme"}>
      {next === "dark" ? "Dark" : next === "light" ? "Light" : "Theme"}
    </button>
  );
}
