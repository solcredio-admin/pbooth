"use client";
// Kiosk sounds, made with Web Audio (no files to download or cache): a beep per countdown second, a
// camera shutter, and a soft tick before a screen clears itself. Browsers only allow sound after a
// touch, so unlock() runs on the guest's first tap; until then every call is silent.
let ctx: AudioContext | null = null;

export function unlockSound() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { /* no Web Audio: the kiosk just stays quiet */ }
}

const ready = () => (ctx && ctx.state === "running" ? ctx : null);

function tone(freq: number, ms: number, volume: number, type: OscillatorType = "sine") {
  const a = ready();
  if (!a) return;
  const t = a.currentTime, osc = a.createOscillator(), gain = a.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(volume, t + 0.008); // no click at the start
  gain.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + ms / 1000 + 0.02);
}

/** One countdown second; the last one is higher, so guests know the photo is next. */
export const countdownBeep = (last: boolean) => tone(last ? 1320 : 880, last ? 260 : 140, 0.28);

/** A soft, low tick: this screen is about to clear (or save) by itself. */
export const warningTick = () => tone(520, 90, 0.09, "triangle");

/** A camera shutter: two short filtered noise bursts (the blades opening and closing). */
export function shutterSound() {
  const a = ready();
  if (!a) return;
  const burst = (at: number, ms: number, volume: number, hz: number) => {
    const len = Math.floor(a.sampleRate * (ms / 1000));
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = a.createBufferSource(), filter = a.createBiquadFilter(), gain = a.createGain();
    src.buffer = buf;
    filter.type = "bandpass";
    filter.frequency.value = hz;
    filter.Q.value = 0.8;
    gain.gain.value = volume;
    src.connect(filter).connect(gain).connect(a.destination);
    src.start(a.currentTime + at);
  };
  burst(0, 45, 0.9, 2600);
  burst(0.075, 60, 0.6, 1700);
}

/** A soft two-note ding: the guest's photos are saved and the QR link is ready to download. */
export function readyDing() {
  tone(1568, 420, 0.1);
  setTimeout(() => tone(2093, 520, 0.08), 110);
}
