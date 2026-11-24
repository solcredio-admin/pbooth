import type { Metadata } from "next";
import { SettingsView } from "@/components/SettingsView";
import type { BackupList } from "@/components/Backups";
import type { AlertsStatus } from "@/components/AlertsAdmin";
import type { UserRow } from "@/components/UsersAdmin";
import { apiGet } from "@/lib/server-api";
import { ROLE_LABEL, type Me } from "@/lib/roles";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { admin } = await apiGet<{ admin: Me }>("/auth/me");
  const owner = admin.role === "OWNER";
  // admin-only data is only fetched for admins (the API would refuse it anyway)
  const [storage, backups, users, alerts] = owner
    ? await Promise.all([
        apiGet<{ enabled: boolean; bucket: string | null }>("/storage/status"),
        apiGet<BackupList>("/backups"),
        apiGet<{ items: UserRow[] }>("/users").then((r) => r.items),
        apiGet<AlertsStatus>("/alerts"),
      ])
    : [null, null, null, null];
  return (
    <>
      <section className="hero compact">
        <span className="cap">Signed in as {admin.username} · {ROLE_LABEL[admin.role]}</span>
        <h1>Settings.</h1>
      </section>
      <main className="detail single">
        <div className="detail-main">
          <SettingsView storage={storage} backups={backups} users={users} alerts={alerts} version={process.env.PBOOTH_VERSION ?? "development"} />
        </div>
      </main>
    </>
  );
}
