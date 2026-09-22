/**
 * Resolves the public origin Crm-A Console is reachable at — used when
 * registering OAuth callbacks (e.g. Composio) and computing the
 * `postMessage` target origin in OAuth callback popups.
 *
 * Why this helper exists:
 * - `new URL(request.url).origin` reflects the actual TCP socket
 *   Crm-A Console is listening on (`http://localhost:3100`), not the public
 *   URL the user's browser is using.
 * - Next.js does NOT honor `X-Forwarded-*` headers when materializing
 *   `request.url`. Without this helper the Composio gateway would
 *   register `http://localhost:3100/api/composio/callback` as the OAuth
 *   redirect URI, which fails the moment the app is hosted behind any
 *   reverse proxy (Crm-A Cloud, ngrok, your own k8s ingress, etc.).
 *
 * Priority:
 *   1. **Trusted forwarded headers** (`X-Forwarded-Host` +
 *      `X-Forwarded-Proto`). On Crm-A Cloud the in-container Nginx sets
 *      both, so this naturally reflects the *current* public subdomain.
 *      That matters for warm-pool slug rebinds where the underlying
 *      container keeps running across the rebind: the env var below
 *      becomes stale, but the Host header is always live.
 *
 *      Spoofing risk is bounded by deployment topology — Crm-A Console
 *      binds to 127.0.0.1:3100 inside the sandbox container, so these
 *      headers can only originate from the colocated Nginx instance,
 *      which sets them itself (`proxy_set_header X-Forwarded-Host
 *      $host;`).
 *   2. **`CRM_A_CONSOLE_PUBLIC_URL` env var.** Seeded by the sandbox boot
 *      script from the Secrets Manager config (`publicUrl` field). Used
 *      as a fallback when forwarded headers are absent (e.g. in-process
 *      probes, server-internal calls) and as a debugging aid.
 *   3. **`new URL(request.url).origin`.** Local dev fallback. With
 *      `bun run dev` and no proxy in front, this is
 *      `http://localhost:3100` and Composio happily accepts a localhost
 *      callback URL during development.
 */
export function resolveAppPublicOrigin(request: Request): string {
  const forwardedHost = firstHeaderValue(request, "x-forwarded-host");
  // The web runtime's own reverse proxy (gateway → next-server) rewrites
  // X-Forwarded-Host to the loopback address it listened on
  // (`127.0.0.1:3100`). That's the *internal* socket, not the public URL
  // the operator reached the app at — trusting it would make every webhook
  // callback point at localhost and NLPearl reject it. So loopback/private
  // forwarded hosts are ignored; the env var (or request.url) wins.
  if (forwardedHost && !isLoopbackOrPrivateHost(forwardedHost)) {
    const forwardedProto = firstHeaderValue(request, "x-forwarded-proto");
    const proto = forwardedProto === "https" ? "https" : "http";
    return `${proto}://${forwardedHost}`;
  }

  const envUrl = process.env.CRM_A_CONSOLE_PUBLIC_URL?.trim();
  if (envUrl) {
    try {
      return new URL(envUrl).origin;
    } catch {
      // CRM_A_CONSOLE_PUBLIC_URL is malformed — fall through to request.url
      // so we still produce *some* origin instead of crashing.
    }
  }

  return new URL(request.url).origin;
}

/**
 * True when a host header value is loopback or a private-network address —
 * i.e. it cannot be the public origin NLPearl/Composio would call back.
 * Handles `localhost`, `127.x`, `::1`, `10.x`, `192.168.x`, `172.16-31.x`.
 */
function isLoopbackOrPrivateHost(host: string): boolean {
  const raw = host.trim();
  if (raw === "") {return true;}
  const hostname = raw.split(":")[0] ?? raw;
  if (hostname === "localhost" || hostname === "::1") {return true;}
  if (/^127\.\d{1,3}(\.\d{1,3}){2}$/.test(hostname)) {return true;}
  const parts = hostname.split(".").map((n) => Number(n));
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    if (parts[0] === 10) {return true;}
    if (parts[0] === 192 && parts[1] === 168) {return true;}
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {return true;}
  }
  return false;
}

/**
 * Reads the first comma-separated value from a header. Forwarded
 * headers can stack as proxies chain (`x-forwarded-host: a, b`); the
 * leftmost value is the original client-facing one.
 */
function firstHeaderValue(request: Request, name: string): string | null {
  const raw = request.headers.get(name);
  if (!raw) {
    return null;
  }
  const first = raw.split(",")[0]?.trim();
  return first && first.length > 0 ? first : null;
}
