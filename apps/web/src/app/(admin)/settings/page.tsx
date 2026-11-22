import type { Metadata } from "next";
import { PasswordForm } from "@/components/PasswordForm";
import { StorageCheck } from "@/components/StorageCheck";
import { apiGet } from "@/lib/server-api";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [{ admin }, storage] = await Promise.all([
    apiGet<{ admin: { email: string } }>("/auth/me"),
    apiGet<{ enabled: boolean; bucket: string | null }>("/storage/status"),
  ]);
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
        <section className="host" aria-labelledby="st">
          <div className="host-head"><span className="cap">Where photos are kept (Cloudflare R2)</span><h2 id="st">Storage</h2></div>
          <div className="panel"><StorageCheck enabled={storage.enabled} bucket={storage.bucket} /></div>
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
