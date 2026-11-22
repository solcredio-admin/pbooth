"use client";
import Link from "next/link";
import { Ago } from "./Ago";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { send } from "@/lib/client-api";
import { useLiveBooths } from "@/lib/live";
import { BOOTH_LABEL, BOOTH_SHORT, boothTile } from "@/lib/format";
import type { BoothDto } from "@/lib/types";

// All booths as keycaps (lime = online, blue = enrolled, grey = offline/new, red = error/revoked),
// updating live, with a one-field form to register a new booth.
export function BoothsBoard({ initial }: { initial: BoothDto[] }) {
  const router = useRouter();
  const { booths, connected } = useLiveBooths(initial);
  const [hover, setHover] = useState<{ b: BoothDto; top: boolean } | null>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
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

  const open = (b: BoothDto, el: HTMLElement) => {
    clearTimeout(closing.current);
    setHover({ b, top: el.getBoundingClientRect().bottom > innerHeight - 190 });
  };
  const close = () => { closing.current = setTimeout(() => setHover(null), 220); };

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
              <div className="keys">
                {booths.map((b) => (
                  <Link key={b.id} href={`/booths/${b.id}`} className={boothTile(b)}
                    onMouseEnter={(ev) => open(b, ev.currentTarget)} onMouseLeave={close}
                    onFocus={(ev) => open(b, ev.currentTarget)} onBlur={close}
                    aria-label={`${b.name}, ${BOOTH_LABEL[b.status]}${b.simulated ? ", simulated" : ""}`}>
                    <span className="p">{b.simulated ? "Sim" : BOOTH_SHORT[b.status]}</span>
                    <span className="n">{b.code}</span>
                    <span className="l">{b.name}</span>
                  </Link>
                ))}
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
        {booths.length > 0 && (
          <div className="legend-row cap" aria-hidden="true">
            <span><i className="lg-live" />Online</span><span><i className="lg-sched" />Enrolled, not seen yet</span>
            <span><i className="lg-cap" />Offline / not enrolled</span><span><i className="lg-err" />Error / revoked</span>
          </div>
        )}
      </main>
      <div className={"ticket" + (hover?.top ? " top" : "")} hidden={!hover} role="tooltip">
        {hover && (
          <>
            <span className="cap">{BOOTH_LABEL[hover.b.status]}{hover.b.simulated ? " · Simulated" : ""} · {hover.b.code}</span>
            <h3>{hover.b.name}</h3>
            <dl>
              <dt>Last seen</dt><dd><Ago iso={hover.b.lastSeenAt} /></dd>
              <dt>Event</dt><dd>{hover.b.liveEvent?.name ?? hover.b.nextEvent?.name ?? "—"}</dd>
              <dt>Device</dt><dd>{hover.b.device?.hostname ?? "—"}</dd>
            </dl>
          </>
        )}
      </div>
    </>
  );
}
