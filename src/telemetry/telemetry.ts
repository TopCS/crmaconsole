import { createHash } from "node:crypto";
import os from "node:os";
import { PostHog } from "posthog-node";
import { readTelemetryConfig } from "./config.js";

const POSTHOG_KEY = process.env.POSTHOG_KEY || "";
const POSTHOG_HOST = "https://us.i.posthog.com";

let client: PostHog | null = null;

export function isTelemetryEnabled(): boolean {
  if (!POSTHOG_KEY) return false;
  if (process.env.DO_NOT_TRACK === "1") return false;
  if (process.env.DENCHCLAW_TELEMETRY_DISABLED === "1") return false;
  if (process.env.CI) return false;

  try {
    const config = readTelemetryConfig();
    if (!config.enabled) return false;
  } catch {
    // If config read fails, default to enabled.
  }

  return true;
}

export function getAnonymousId(): string {
  try {
    const raw = `${os.hostname()}:${os.userInfo().username}`;
    return createHash("sha256").update(raw).digest("hex").slice(0, 16);
  } catch {
    return "unknown";
  }
}

function getMachineContext(): Record<string, unknown> {
  return {
    os: process.platform,
    arch: process.arch,
    node_version: process.version,
  };
}

function ensureClient(): PostHog | null {
  if (!POSTHOG_KEY) return null;
  if (!client) {
    client = new PostHog(POSTHOG_KEY, {
      host: POSTHOG_HOST,
      flushAt: 5,
      flushInterval: 10_000,
    });
  }
  return client;
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (!isTelemetryEnabled()) return;

  if (process.env.DENCHCLAW_TELEMETRY_DEBUG === "1") {
    process.stderr.write(
      `[telemetry:debug] ${JSON.stringify({ event, properties }, null, 2)}\n`,
    );
    return;
  }

  const ph = ensureClient();
  if (!ph) return;

  ph.capture({
    distinctId: getAnonymousId(),
    event,
    properties: {
      ...getMachineContext(),
      ...properties,
      $process_person_profile: false,
    },
  });
}

export async function shutdownTelemetry(): Promise<void> {
  if (client) {
    await client.shutdown();
    client = null;
  }
}
