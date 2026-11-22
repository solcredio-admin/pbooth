"use client";
import Link from "next/link";
import { Ago } from "./Ago";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { send } from "@/lib/client-api";
import { useLiveBooths } from "@/lib/live";
import { BOOTH_LABEL } from "@/lib/format";
import type { BoothDto } from "@/lib/types";

// All booths as a list that updates live, with a one-field form to register a new booth.
export function BoothsBoard({ initial }: { initial: BoothDto[] }) {
  const router = useRouter();
  const { booths, connected } = useLiveBooths(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const online = booths.filter((b) => b.online).length;

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "").trim();
    if (!name) return setError("Give the booth a name.");
    setBusy(true);
    const res = await send<BoothDto>("POST", "/booths", { name });
    setBusy(false);
    if (!res.ok) return setError(res.fields.name ?? res.message);
    router.push(`/booths/${res.data.id}`);
  }


  return (
    <>
      <section className="hero compact">
        <span className="cap"><span className={"live-dot" + (connected ? " on" : "")} aria-hidden="true" />{connected ? "Live" : "Connecting…"} · {online} of {booths.length} online</span>
        <h1>Booths.</h1>
      </section>
      <main>
        {booths.length > 0 && (
          <section className="host" aria-label="All booths">
            <div className="panel">
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Booth</th><th>Status</th><th className="hide-sm">Last seen</th><th className="hide-sm">Event</th></tr></thead>
                  <tbody>
                    {booths.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <Link className="row-link name" href={`/booths/${b.id}`}>{b.name}</Link>
                          <div className="sub">{b.code}{b.simulated && <span className="sim-badge">Simulated</span>}</div>
                        </td>
                        <td><span className={`pill b-${b.status}`}>{BOOTH_LABEL[b.status]}</span>{b.lastError && <div className="sub err-text">{b.lastError}</div>}</td>
                        <td className="hide-sm"><Ago iso={b.lastSeenAt} /></td>
                        <td className="hide-sm">{b.liveEvent ? <>Live at {b.liveEvent.name}</> : b.nextEvent ? <>Next: {b.nextEvent.name}</> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
        <section className="host" aria-labelledby="new-booth">
          <div className="host-head">
            <span className="cap">A booth is a physical kit you reuse across events</span>
            <h2 id="new-booth">{booths.length ? "Add a booth" : "Your first booth"}</h2>
          </div>
          <div className="panel">
            <form className="inline-form" onSubmit={create}>
              <label className="field"><span>Booth name</span><input name="name" maxLength={80} placeholder="Booth A, White mirror booth…" aria-invalid={error ? true : undefined} /></label>
              <button className="btn" type="submit" disabled={busy}>{busy ? "Adding…" : "Add booth"}</button>
            </form>
            {error && <p className="cap err" role="alert">{error}</p>}
          </div>
        </section>
      </main>
    </>
  );
}
