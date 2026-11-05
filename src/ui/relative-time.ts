const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A sidebar timestamp: "now", "14m", "3h", "2d", or nothing when `then` is 0 (no activity yet). */
export function relativeTime(then: number, now: number): string {
  if (then <= 0) return "";
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  return `${Math.floor(elapsed / DAY)}d`;
}
