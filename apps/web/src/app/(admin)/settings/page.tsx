import type { Metadata } from "next";
import { PasswordForm } from "@/components/PasswordForm";
import { apiGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { admin } = await apiGet<{ admin: { email: string } }>("/auth/me");
  return (
    <>
      <section className="hero compact">
        <span className="cap">Signed in as {admin.email}</span>
        <h1>Settings.</h1>
      </section>
      <main className="narrow">
        <section className="host" aria-labelledby="pw">
          <div className="host-head"><span className="cap">Changing it signs out other browsers</span><h2 id="pw">Password</h2></div>
          <div className="panel"><PasswordForm /></div>
        </section>
        <section className="host" aria-labelledby="ab">
          <div className="host-head"><span className="cap">This installation</span><h2 id="ab">About</h2></div>
          <div className="panel">
            <dl className="kv">
              <dt>Version</dt><dd>{process.env.PBOOTH_VERSION ?? "development"}</dd>
              <dt>Lost password</dt><dd>Run <code>admin:reset-password</code> on the server (see the README).</dd>
            </dl>
          </div>
        </section>
      </main>
    </>
  );
}
