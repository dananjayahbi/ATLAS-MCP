// Doc 09 §10.4 T7/T8 — export and clipboard bodies. Line format is Doc 02 §8.4's
// `HH:MM:SS LEVEL message` so a UI export is byte-comparable with `execution.log`.
import { sanitiseMessage } from "./sanitise";
import type { TaskLogLine } from "./types";

/** `HH:MM:SS` in local time (Doc 09 §10.4 T9). */
export function formatTime(ts: string): string {
  const parsed = Date.parse(ts);
  if (!Number.isFinite(parsed)) return "--:--:--";
  const date = new Date(parsed);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Full ISO-8601 for the `title` tooltip, or the raw value when unparseable. */
export function formatIso(ts: string): string {
  const parsed = Date.parse(ts);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : ts;
}

/** One `execution.log` line. Trailing whitespace is trimmed; inner `\n` is preserved. */
export function toLogText(line: TaskLogLine): string {
  return `${formatTime(line.ts)} ${line.level} ${sanitiseMessage(line.message)}`;
}

/** Whole-buffer body for clipboard and download (T7: never just the visible window). */
export function buildLogText(lines: readonly TaskLogLine[]): string {
  return lines.map(toLogText).join("\n");
}

/** `text/plain`, UTF-8, trailing newline so the file ends on a line boundary. */
export function buildLogBlob(lines: readonly TaskLogLine[]): Blob {
  return new Blob([`${buildLogText(lines)}\n`], { type: "text/plain;charset=utf-8" });
}

export function exportFileName(taskId: string): string {
  const safe = taskId.replace(/[^A-Za-z0-9._-]/g, "_") || "task";
  return `${safe}-execution.log`;
}

/** Trigger a download. No-ops outside the browser so SSR cannot throw. */
export function downloadLog(taskId: string, lines: readonly TaskLogLine[]): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(buildLogBlob(lines));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = exportFileName(taskId);
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next task so Safari has started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Copy the whole buffer (T7). Resolves `false` when the clipboard is unavailable. */
export async function copyLog(lines: readonly TaskLogLine[]): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(buildLogText(lines));
    return true;
  } catch {
    return false;
  }
}
