import type { ReactNode } from "react";
import { Shell } from "@/components/Shell";
import { apiGet } from "@/lib/server-api";

// Every page in here needs a valid session: apiGet redirects to /login on 401.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await apiGet("/auth/me");
  return <Shell>{children}</Shell>;
}
