/** Doc 06 §1.1 — duration, relative time and clock formatting. */

const MINUTE = 60;
const HOUR = 3600;

/** `12m 34s`, `1h 02m`, `42s`. Never renders sub-second noise. */
export function formatDuration(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "—";
  const seconds = Math.floor(totalSeconds);
  if (seconds < MINUTE) return `${seconds}s`;
  if (seconds < HOUR) {
    const m = Math.floor(seconds / MINUTE);
    const s = seconds % MINUTE;
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const h = Math.floor(seconds / HOUR);
  const m = Math.floor((seconds % HOUR) / MINUTE);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** `mm:ss` countdown for lease rows; `null` renders an em dash (Doc 06 §16.4). */
export function formatCountdown(secondsRemaining: number | null): string {
  if (secondsRemaining === null || !Number.isFinite(secondsRemaining)) return "—";
  const clamped = Math.max(0, Math.floor(secondsRemaining));
  const m = Math.floor(clamped / MINUTE);
  const s = clamped % MINUTE;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** `12m ago`, `3h ago`, `4d ago`. Stable at boundaries (doc 06 checklist #2). */
export function formatRelativeTime(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "—";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const deltaSeconds = Math.max(0, Math.floor((now - then) / 1000));
  if (deltaSeconds < 10) return "just now";
  if (deltaSeconds < MINUTE) return `${deltaSeconds}s ago`;
  if (deltaSeconds < HOUR) return `${Math.floor(deltaSeconds / MINUTE)}m ago`;
  if (deltaSeconds < 86_400) return `${Math.floor(deltaSeconds / HOUR)}h ago`;
  return `${Math.floor(deltaSeconds / 86_400)}d ago`;
}

export function formatAgeHours(hours: number): string {
  if (!Number.isFinite(hours) || hours < 0) return "—";
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${hours.toFixed(hours < 10 ? 1 : 0)}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Local `HH:mm:ss` for the command bar clock. */
export function formatClock(date: Date = new Date()): string {
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Seconds since an ISO timestamp, or `null` when unparseable. */
export function secondsSince(iso: string | null, now: number = Date.now()): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.max(0, Math.floor((now - then) / 1000));
}
