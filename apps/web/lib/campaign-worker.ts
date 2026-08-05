import { processCampaignQueue } from "./campaigns";

/**
 * Campaign send worker: drains queued campaign sends (and soft-bounce
 * retries) once a minute. All state lives in DuckDB, so a process restart
 * simply resumes the queue — nothing is lost if the interval fires late.
 */

const TICK_MS = 60_000;
let started = false;

export function startCampaignWorker(): void {
  if (started) {return;}
  started = true;

  const tick = async () => {
    try {
      await processCampaignQueue();
    } catch (err) {
      console.error("[campaign-worker] tick failed:", err);
    }
  };

  // First run shortly after boot (lets migrations finish first), then steady.
  const boot = setTimeout(() => void tick(), 15_000);
  boot.unref?.();
  const interval = setInterval(() => void tick(), TICK_MS);
  interval.unref?.();
}
