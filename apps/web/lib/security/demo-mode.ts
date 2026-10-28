/**
 * Demo-mode outbound kill switch (SEC-07).
 *
 * The MAXXI demo must never reach a real provider. The guard lives in the
 * low-level adapters (SES, OpenClaw channel delivery, phone provider, NLPearl
 * write calls) so it cannot be bypassed by a UI, a tool, a worker, a cron or a
 * direct API call.
 *
 * Enabled by CRM_A_DEMO_MODE=1. When enabled every outbound adapter returns a
 * simulated result and records nothing externally.
 */

export type OutboundBlockedResult = {
  ok: false;
  simulated: true;
  provider: string;
  error: string;
};

export function isDemoMode(): boolean {
  const raw = process.env.CRM_A_DEMO_MODE?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

export function blocked(provider: string): OutboundBlockedResult {
  return {
    ok: false,
    simulated: true,
    provider,
    error: `Outbound disabled in demo mode (${provider}).`,
  };
}

/**
 * Guard for adapters that mutate a remote provider. Throws when demo mode is on,
 * so existing try/catch paths surface a clear, non-destructive error.
 */
export function assertOutboundAllowed(provider: string): void {
  if (isDemoMode()) {
    const err = new Error(
      `Outbound disabled in demo mode (${provider}). Nothing was sent.`,
    ) as Error & { simulated?: boolean };
    err.simulated = true;
    throw err;
  }
}
