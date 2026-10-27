type ClassPart = string | false | null | undefined;

/** Minimal class-name joiner (no clsx/tailwind-merge dependency, Doc 01 §3). */
export function cn(...parts: ClassPart[]): string {
  let out = "";
  for (const part of parts) {
    if (!part) continue;
    out = out ? `${out} ${part}` : part;
  }
  return out;
}
