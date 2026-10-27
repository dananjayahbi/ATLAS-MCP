/** Doc 06 §1.1 / §6.2 — Windows-aware path helpers. */

const SEP = /[\\/]/;

export function pathSeparator(raw: string): "\\" | "/" {
  return raw.includes("\\") ? "\\" : "/";
}

export function basename(raw: string): string {
  if (!raw) return "";
  const parts = raw.split(SEP).filter(Boolean);
  return parts[parts.length - 1] ?? raw;
}

export function dirname(raw: string): string {
  if (!raw) return "";
  const parts = raw.split(SEP).filter(Boolean);
  parts.pop();
  const sep = pathSeparator(raw);
  if (parts.length === 0) return sep;
  return `${parts[0].includes(":") ? "" : sep}${parts.join(sep)}`;
}

/**
 * Middle truncation, never end truncation (Doc 06 §6.2 decision): the tail is the
 * discriminating segment across projects on one machine.
 */
export function middlePath(raw: string, max = 34): string {
  if (!raw) return "";
  if (raw.length <= max) return raw;
  const sep = pathSeparator(raw);
  const parts = raw.split(SEP).filter(Boolean);
  const head = parts[0]?.includes(":") ? `${parts[0]}${sep}` : `${sep}${parts[0] ?? ""}`;
  const tail = parts[parts.length - 1] ?? "";
  const budget = max - head.length - tail.length - 2;
  if (budget <= 0) return `…${sep}${tail.slice(-(max - 1))}`;
  return `${head}…${sep}${tail}`;
}

/** Alias used by call sites that predate `middlePath`. */
export function shortenPath(raw: string, max = 34): string {
  return middlePath(raw, max);
}

/** `TASK-5F2D6C1E` — id prefix for headers (Doc 06 §8.1). */
export function shortTaskId(id: string): string {
  return `TASK-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

export function shortId(id: string): string {
  return id.replace(/-/g, "").slice(0, 8);
}
