"use client";
// On-screen QWERTY keyboard for voucher codes: touch-screen booths often have no keyboard. Codes skip
// I, L, O and U (they read as 1, 1, 0); those keys type what they mean, U is greyed out. The dash goes
// in by itself.
const KEY_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const KEY_MEANS: Record<string, string> = { O: "0", I: "1", L: "1" };
export function Keypad({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const raw = value.replace(/[^0-9A-Z]/g, "");
  const set = (r: string) => onChange(r.length > 4 ? `${r.slice(0, 4)}-${r.slice(4, 8)}` : r);
  const full = raw.length >= 8;
  return (
    <div className="k-keypad" role="group" aria-label="Keyboard">
      {KEY_ROWS.map((row, n) => (
        <div className="k-keyrow" key={row}>
          {row.split("").map((k) => (
            <button key={k} type="button" className="k-key" disabled={full || k === "U"} onClick={() => set(raw + (KEY_MEANS[k] ?? k))}>{k}</button>
          ))}
          {n === 3 && <button type="button" className="k-key wide" onClick={() => set(raw.slice(0, -1))} aria-label="Delete">⌫</button>}
        </div>
      ))}
      <div className="k-keyrow"><button type="button" className="k-key space" onClick={() => set("")}>Clear</button></div>
    </div>
  );
}
