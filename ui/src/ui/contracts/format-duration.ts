export type FormatDurationCompactOptions = {
  spaced?: boolean;
};

export function formatDurationCompact(
  ms?: number | null,
  options?: FormatDurationCompactOptions,
): string | undefined {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) {
    return undefined;
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const sep = options?.spaced ? " " : "";
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d${sep}${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}h${sep}${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m${sep}${seconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

export function formatDurationHuman(ms?: number | null, fallback = "n/a"): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) {
    return fallback;
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  const sec = Math.round(ms / 1000);
  if (sec < 60) {
    return `${sec}s`;
  }
  const min = Math.round(sec / 60);
  if (min < 60) {
    return `${min}m`;
  }
  const hr = Math.round(min / 60);
  if (hr < 24) {
    return `${hr}h`;
  }
  const day = Math.round(hr / 24);
  return `${day}d`;
}
