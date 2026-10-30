/**
 * Post-login redirect validation.
 *
 * Only same-origin, absolute-path destinations are allowed. This blocks open
 * redirects (`//evil`, `https://…`, backslash tricks) after the OIDC callback.
 */
export function safeNextPath(raw: unknown, fallback = "/maxxi"): string {
  if (typeof raw !== "string") {return fallback;}
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return fallback;
  }
  return raw;
}
