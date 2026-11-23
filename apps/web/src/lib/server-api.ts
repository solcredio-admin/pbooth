import "server-only";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

const API = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

// Server components read data straight from the API, passing the admin's cookie along.
// 401 → back to /login; 403 (not for this role) → the dashboard; 404 or a malformed id → not found.
export async function apiGet<T>(path: string): Promise<T> {
  const session = (await cookies()).get("pb_session")?.value;
  const res = await fetch(`${API}/api/v1${path}`, {
    headers: session ? { cookie: `pb_session=${session}` } : {},
    cache: "no-store",
  });
  if (res.status === 401) redirect("/login");
  if (res.status === 403) redirect("/events"); // a page this role can't open (every role can see events)
  if (res.status === 404 || res.status === 400) notFound();
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return res.json() as Promise<T>;
}

/** For pages anyone may see (login): who is signed in, or null. */
export async function currentAdmin(): Promise<{ id: string; username: string; role: string } | null> {
  const session = (await cookies()).get("pb_session")?.value;
  if (!session) return null;
  try {
    const res = await fetch(`${API}/api/v1/auth/me`, { headers: { cookie: `pb_session=${session}` }, cache: "no-store" });
    return res.ok ? (await res.json()).admin : null;
  } catch {
    return null;
  }
}
