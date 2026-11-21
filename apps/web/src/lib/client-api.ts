import type { ApiErrorBody } from "./types";

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; message: string; fields: Record<string, string> };

// Browser → API (same origin, through the Next rewrite). Never throws: callers get a result.
export async function send<T>(method: string, path: string, body?: unknown): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: "Can't reach the server. Check the connection and try again.", fields: {} };
  }
  if (res.status === 401 && path !== "/auth/login" && path !== "/auth/password") {
    location.replace("/login");
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (res.ok) return { ok: true, data: json as T };
  const err = (json as ApiErrorBody | null)?.error;
  const fields: Record<string, string> = {};
  for (const d of err?.details ?? []) fields[d.path.replace(/^config\./, "")] ??= d.message;
  return { ok: false, status: res.status, message: err?.message ?? `Request failed (${res.status})`, fields };
}
