export type FormatRelativeTimestampOptions = {
  dateFallback?: boolean;
  timezone?: string;
  fallback?: string;
};

export function formatRelativeTimestamp(
  timestampMs: number | null | undefined,
  options?: FormatRelativeTimestampOptions,
): string {
  const fallback = options?.fallback ?? "n/a";
  if (timestampMs == null || !Number.isFinite(timestampMs)) {
    return fallback;
  }

  const diff = Date.now() - timestampMs;
  const absDiff = Math.abs(diff);
  const isPast = diff >= 0;

  const sec = Math.round(absDiff / 1000);
  if (sec < 60) {
    return isPast ? "just now" : "in <1m";
  }

  const min = Math.round(sec / 60);
  if (min < 60) {
    return isPast ? `${min}m ago` : `in ${min}m`;
  }

  const hr = Math.round(min / 60);
  if (hr < 48) {
    return isPast ? `${hr}h ago` : `in ${hr}h`;
  }

  const day = Math.round(hr / 24);
  if (!options?.dateFallback || day <= 7) {
    return isPast ? `${day}d ago` : `in ${day}d`;
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(options.timezone ? { timeZone: options.timezone } : {}),
    }).format(new Date(timestampMs));
  } catch {
    return `${day}d ago`;
  }
}
