import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { resolveOpenClawStateDir } from "./workspace";

/**
 * Web-tracking write key management. The write key authenticates the public
 * `/api/events/collect` + `/api/events/identify` endpoints — like a GA
 * measurement ID, it is embedded in the tracker snippet and only grants
 * event-ingestion rights (never read access).
 */

type TrackingState = {
  writeKey: string;
  createdAt: string;
};

function trackingStatePath(): string {
  return path.join(resolveOpenClawStateDir(), ".crm-a-tracking.json");
}

/** Read the workspace write key, generating and persisting one on first use. */
export function getOrCreateTrackingWriteKey(): string {
  const filePath = trackingStatePath();
  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as Partial<TrackingState>;
      if (typeof parsed.writeKey === "string" && parsed.writeKey.length >= 16) {
        return parsed.writeKey;
      }
    } catch {
      // Fall through and regenerate.
    }
  }
  const state: TrackingState = {
    writeKey: `cra_wk_${randomBytes(18).toString("hex")}`,
    createdAt: new Date().toISOString(),
  };
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  return state.writeKey;
}

/** Constant-shape check for incoming collect/identify requests. */
export function isValidTrackingWriteKey(candidate: unknown): boolean {
  return typeof candidate === "string" && candidate.length > 0 && candidate === getOrCreateTrackingWriteKey();
}
