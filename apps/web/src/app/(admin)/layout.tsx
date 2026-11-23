import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { apiGet } from "@/lib/server-api";
import type { Me } from "@/lib/roles";

// Every page in here needs a valid session: apiGet redirects to /login on 401.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const { admin } = await apiGet<{ admin: Me }>("/auth/me");
  return <Shell me={admin}>{children}</Shell>;
}
