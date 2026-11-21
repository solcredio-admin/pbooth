"use client";
import { useState, type FormEvent } from "react";
import { send } from "@/lib/client-api";

export function PasswordForm() {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    if (f.get("newPassword") !== f.get("repeat")) return setStatus({ ok: false, text: "The new passwords don't match." });
    setBusy(true);
    const res = await send("POST", "/auth/password", { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") });
    setBusy(false);
    if (!res.ok) return setStatus({ ok: false, text: res.message });
    form.reset();
    setStatus({ ok: true, text: "Password changed. Other browsers were signed out." });
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="fields">
        <label className="field wide"><span>Current password</span><input name="currentPassword" type="password" autoComplete="current-password" required /></label>
        <label className="field"><span>New password</span><input name="newPassword" type="password" autoComplete="new-password" minLength={12} required /><span className="hint">At least 12 characters</span></label>
        <label className="field"><span>Repeat new password</span><input name="repeat" type="password" autoComplete="new-password" minLength={12} required /></label>
      </div>
      <div className="form-foot">
        <button className="btn" type="submit" disabled={busy}>{busy ? "Saving…" : "Change password"}</button>
        <span className={"cap status " + (status?.ok ? "ok" : "bad")} role="status">{status?.text}</span>
      </div>
    </form>
  );
}
