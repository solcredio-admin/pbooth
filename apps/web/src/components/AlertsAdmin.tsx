"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { send } from "@/lib/client-api";

const KINDS = { OFFLINE: "Booth offline", KIOSK: "Camera, printer or screen", REFUND: "Help and refunds", PAYMENTS: "Payments failing" } as const;
type Kind = keyof typeof KINDS;
interface Chat { id: string; chatId: string; label: string; kinds: Kind[]; lastError: string | null }
export interface AlertsStatus { enabled: boolean; bot: { username: string | null; error: string | null } | null; chats: Chat[]; recent: { id: string; text: string; createdAt: string; sentAt: string | null; clearedAt: string | null }[] }

// Telegram alerts for self-service booths: who gets them, and which kinds.
export function AlertsAdmin({ data }: { data: AlertsStatus }) {
  const router = useRouter();
  const [found, setFound] = useState<{ chatId: string; label: string }[] | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async <T,>(method: string, path: string, body?: unknown, ok?: string) => {
    setBusy(true); setMsg(null);
    const r = await send<T>(method, `/alerts${path}`, body);
    setBusy(false);
    setMsg(r.ok ? (ok ? { ok: true, text: ok } : null) : { ok: false, text: r.message });
    router.refresh();
    return r.ok ? r.data : null;
  };
  return (
    <>
      <dl className="kv account-kv">
        <dt>Bot</dt><dd>{!data.enabled ? <>Not set up. Make a bot with <b>@BotFather</b> in Telegram, then put its token in the server&apos;s <code>.env</code> as <code>TELEGRAM_BOT_TOKEN</code> and restart. Alerts are still listed below.</> : data.bot?.username ? `@${data.bot.username}` : <span className="err">{data.bot?.error}</span>}</dd>
      </dl>
      {data.chats.length > 0 && (
        <ul className="refunds">
          {data.chats.map((c) => (
            <li key={c.id}>
              <div><b>{c.label}</b><div className="sub">chat {c.chatId}</div>{c.lastError && <div className="sub err">{c.lastError}</div>}
                <div className="alert-kinds">{(Object.keys(KINDS) as Kind[]).map((k) => (
                  <label className="check" key={k}><input type="checkbox" checked={c.kinds.includes(k)} disabled={busy} onChange={(e) => run("PATCH", `/chats/${c.id}`, { kinds: e.target.checked ? [...c.kinds, k] : c.kinds.filter((x) => x !== k) })} /><span>{KINDS[k]}</span></label>
                ))}</div>
              </div>
              <div className="refund-acts">
                <button className="row-btn" type="button" disabled={busy || !data.enabled} onClick={() => run("POST", `/chats/${c.id}/test`, undefined, "Sent. Check Telegram.")}>Send test</button>
                <button className="row-btn danger" type="button" disabled={busy} onClick={() => run("DELETE", `/chats/${c.id}`)}>Remove</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="actions start"><button className="btn ghost" type="button" disabled={busy || !data.enabled} onClick={async () => setFound((await run<{ items: { chatId: string; label: string }[] }>("GET", "/find-chats"))?.items ?? null)}>Add a chat</button></div>
      {found && (found.length === 0
        ? <p className="cap">No new chats. In Telegram, open your bot and send it any message (or add it to a group and write there), then press Add a chat again.</p>
        : <ul className="refunds">{found.map((c) => <li key={c.chatId}><div><b>{c.label}</b><div className="sub">chat {c.chatId}</div></div><button className="row-btn" type="button" disabled={busy} onClick={async () => { if (await run("POST", "/chats", c)) setFound(null); }}>Send alerts here</button></li>)}</ul>)}
      {msg && <p className={"cap" + (msg.ok ? "" : " err")} role="status">{msg.text}</p>}
      <h3 className="cap">Recent alerts</h3>
      {data.recent.length === 0 ? <p className="cap">None yet. Only live self-service booths send alerts.</p> : (
        <ul className="alert-log">{data.recent.map((a) => <li key={a.id}><span suppressHydrationWarning className="cap">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(a.createdAt))}{a.sentAt ? "" : " · not sent"}</span> {a.text.split("\n")[0]}</li>)}</ul>
      )}
    </>
  );
}
