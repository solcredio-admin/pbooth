"use client";
import { useState } from "react";
import { Tabs } from "./Tabs";
import { PasswordForm } from "./PasswordForm";
import { StorageCheck } from "./StorageCheck";
import { Backups, type BackupList } from "./Backups";
import { UsersAdmin, type UserRow } from "./UsersAdmin";
import { ROLE_HELP, ROLE_LABEL, useMe } from "@/lib/roles";

type Tab = "account" | "users" | "backups" | "storage" | "about";

// Settings in tabs. Users, backups and storage are for admins only (and the API enforces it).
export function SettingsView({ storage, backups, users, version }: {
  storage: { enabled: boolean; bucket: string | null } | null; backups: BackupList | null; users: UserRow[] | null; version: string;
}) {
  const me = useMe();
  const admin = me.role === "OWNER";
  const tabs: { id: Tab; label: string }[] = [
    { id: "account", label: "Account" },
    ...(admin ? [{ id: "users" as const, label: "Users" }, { id: "backups" as const, label: "Backups" }, { id: "storage" as const, label: "Storage" }] : []),
    { id: "about", label: "About" },
  ];
  const [tab, setTab] = useState<Tab>("account");
  return (
    <>
      <Tabs label="Settings" tabs={tabs} value={tab} onChange={setTab} />
      <div className="tab-pane" hidden={tab !== "account"}>
        <section className="host" aria-labelledby="acc">
          <div className="host-head"><span className="cap">Changing the password signs out your other browsers</span><h2 id="acc">Your account</h2></div>
          <div className="panel">
            <dl className="kv account-kv">
              <dt>Username</dt><dd>{me.username}</dd>
              <dt>Role</dt><dd>{ROLE_LABEL[me.role]} · <span className="cap">{ROLE_HELP[me.role]}</span></dd>
            </dl>
            <PasswordForm />
          </div>
        </section>
      </div>
      {admin && users && (
        <div className="tab-pane" hidden={tab !== "users"}>
          <section className="host" aria-labelledby="usr">
            <div className="host-head"><span className="cap">Who can sign in, and what they can do</span><h2 id="usr">Users</h2></div>
            <div className="panel"><UsersAdmin users={users} /></div>
          </section>
        </div>
      )}
      {admin && backups && (
        <div className="tab-pane" hidden={tab !== "backups"}>
          <section className="host" aria-labelledby="bk">
            <div className="host-head"><span className="cap">Events, booths, sessions, users and settings</span><h2 id="bk">Database backups</h2></div>
            <div className="panel"><Backups data={backups} /></div>
          </section>
        </div>
      )}
      {admin && storage && (
        <div className="tab-pane" hidden={tab !== "storage"}>
          <section className="host" aria-labelledby="st">
            <div className="host-head"><span className="cap">Where photos are kept (Cloudflare R2)</span><h2 id="st">Storage</h2></div>
            <div className="panel"><StorageCheck enabled={storage.enabled} bucket={storage.bucket} /></div>
          </section>
        </div>
      )}
      <div className="tab-pane" hidden={tab !== "about"}>
        <section className="host" aria-labelledby="ab">
          <div className="host-head"><span className="cap">This installation</span><h2 id="ab">About</h2></div>
          <div className="panel">
            <dl className="kv">
              <dt>Version</dt><dd>{version}</dd>
              <dt>Locked out</dt><dd>Run <code>admin:reset-password</code> on the server (see the README).</dd>
            </dl>
          </div>
        </section>
      </div>
    </>
  );
}
