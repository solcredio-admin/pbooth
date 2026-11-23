"use client";
import { useRouter } from "next/navigation";
import { Fragment, useRef, useState, type FormEvent } from "react";
import { send } from "@/lib/client-api";
import { Ago } from "./Ago";
import { ROLE_HELP, ROLE_LABEL, useMe, type Role } from "@/lib/roles";

export interface UserRow { id: string; username: string; role: Role; disabled: boolean; createdAt: string; lastActiveAt: string | null }
const ROLES: Role[] = ["OWNER", "EVENTS", "BOOTHS", "KIOSK"];

// Who can sign in: add people with a role, change roles, disable/enable, reset passwords, remove.
// The API enforces the rules (admin-only, never lock yourself out, keep one admin); this mirrors them.
export function UsersAdmin({ users }: { users: UserRow[] }) {
  const router = useRouter();
  const me = useMe();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const patch = async (u: UserRow, body: Record<string, unknown>) => {
    setBusy(u.id); setError("");
    const r = await send("PATCH", `/users/${u.id}`, body);
    setBusy(null);
    if (!r.ok) setError(r.message); else router.refresh();
  };

  return (
    <div className="users-admin">
      <AddUser onDone={() => router.refresh()} />
      {error && <p className="cap err" role="alert">{error}</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th className="hide-sm">Last active</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me.id;
              return (
                <tr key={u.id} className={u.disabled ? "muted" : undefined}>
                  <td><b>{u.username}</b>{self && <span className="cap"> · you</span>}</td>
                  <td>
                    <select aria-label={`Role for ${u.username}`} value={u.role} disabled={self || busy === u.id} onChange={(e) => patch(u, { role: e.target.value })}>
                      {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  </td>
                  <td>
                    <button type="button" className={"pill-toggle" + (u.disabled ? "" : " on")} aria-pressed={!u.disabled} disabled={self || busy === u.id}
                      onClick={() => patch(u, { disabled: !u.disabled })} title={self ? "You can't disable yourself" : u.disabled ? "Enable" : "Disable"}>
                      {u.disabled ? "Disabled" : "Active"}
                    </button>
                  </td>
                  <td className="hide-sm cap">{u.lastActiveAt ? <Ago iso={u.lastActiveAt} /> : "Never"}</td>
                  <td className="actions-cell">
                    <div className="row-actions">
                      <ResetPassword user={u} />
                      {!self && <RemoveUser user={u} />}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <dl className="kv role-help">
        {ROLES.map((r) => <Fragment key={r}><dt>{ROLE_LABEL[r]}</dt><dd>{ROLE_HELP[r]}</dd></Fragment>)}
      </dl>
    </div>
  );
}

function AddUser({ onDone }: { onDone: () => void }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true); setErrors({}); setMsg("");
    const r = await send<UserRow>("POST", "/users", { username: f.get("username"), password: f.get("password"), role: f.get("role") });
    setBusy(false);
    if (!r.ok) { setErrors(r.fields); setMsg(r.message); return; }
    form.reset();
    setMsg(`Added ${r.data.username}. Share the password with them privately.`);
    onDone();
  };
  return (
    <form className="inline-form add-user" onSubmit={submit} noValidate>
      <label className="field"><span>Username</span>
        <input name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={64} placeholder="e.g. maria" aria-invalid={errors.username ? true : undefined} />
        {errors.username ? <span className="err">{errors.username}</span> : <span className="hint">Letters, numbers, . _ - @</span>}
      </label>
      <label className="field"><span>Password</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={12} aria-invalid={errors.password ? true : undefined} />
        {errors.password ? <span className="err">{errors.password}</span> : <span className="hint">At least 12 characters</span>}
      </label>
      <label className="field narrow-field"><span>Role</span>
        <select name="role" defaultValue="EVENTS">{ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        <span className="hint">Change it any time</span>
      </label>
      <button className="btn" type="submit" disabled={busy}>{busy ? "Adding…" : "Add user"}</button>
      {msg && <p className="cap status-line" role="status">{msg}</p>}
    </form>
  );
}

function ResetPassword({ user }: { user: UserRow }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true); setError("");
    const r = await send("PATCH", `/users/${user.id}`, { password: f.get("password") });
    setBusy(false);
    if (!r.ok) return setError(r.message);
    dialog.current?.close();
  };
  return (
    <>
      <button type="button" className="row-btn" onClick={() => { setError(""); dialog.current?.showModal(); }}>Reset password</button>
      <dialog ref={dialog} className="setup confirm" aria-labelledby={`pw-${user.id}`}>
        <span className="cap">{user.username}</span>
        <h2 id={`pw-${user.id}`}>New password</h2>
        <p>They&apos;re signed out everywhere and use this from now on.</p>
        <form onSubmit={submit}>
          <label className="field"><span className="cap">Password (12+ characters)</span><input name="password" type="password" autoComplete="new-password" required minLength={12} autoFocus /></label>
          {error && <p className="cap err" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button>
            <button type="submit" className="btn" disabled={busy}>{busy ? "Saving…" : "Set password"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

// Removing someone is deliberate: a dialog, and the username typed back.
function RemoveUser({ user }: { user: UserRow }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toLowerCase() === user.username;
  const remove = async (e: FormEvent) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true); setError("");
    const r = await send("DELETE", `/users/${user.id}`);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    dialog.current?.close();
    router.refresh();
  };
  return (
    <>
      <button type="button" className="row-btn danger" onClick={() => { setTyped(""); setError(""); dialog.current?.showModal(); }}>Remove</button>
      <dialog ref={dialog} className="setup confirm" aria-labelledby={`rm-${user.id}`}>
        <span className="cap">{ROLE_LABEL[user.role]}</span>
        <h2 id={`rm-${user.id}`}>Remove {user.username}?</h2>
        <p>They&apos;re signed out and can&apos;t sign in again. To pause access instead, set them to Disabled.</p>
        <form onSubmit={remove}>
          <label className="field"><span className="cap">Type <b>{user.username}</b> to confirm</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} autoFocus />
          </label>
          {error && <p className="cap err" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="btn ghost" onClick={() => dialog.current?.close()} disabled={busy}>Cancel</button>
            <button type="submit" className="btn warn" disabled={!ok || busy}>{busy ? "Removing…" : "Remove user"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
