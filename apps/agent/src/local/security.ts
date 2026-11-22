// Rules for the agent's local API (http://127.0.0.1:<port>). Pure functions, so they're tested directly.

/**
 * DNS-rebinding defence: a hostile site can point its own domain at 127.0.0.1, but the browser
 * still sends that domain in the Host header. Only literal loopback names are accepted.
 */
export function hostAllowed(host: string | undefined, port: number) {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`;
}

/**
 * Browsers always send Origin on cross-origin requests. Only the pbooth site may talk to the agent.
 * No Origin at all means a local program (curl, a script): allowed, but it still needs a token,
 * which only a paired kiosk can get.
 */
export function originAllowed(origin: string | undefined, allowed: string[]) {
  return origin === undefined || allowed.includes(origin);
}

export function corsHeaders(origin: string | undefined, privateNetworkRequest: boolean): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "600",
    // Chrome's Private/Local Network Access: a public HTTPS page reaching 127.0.0.1 must be allowed explicitly.
    ...(privateNetworkRequest ? { "Access-Control-Allow-Private-Network": "true" } : {}),
  };
}
