/** Byte sizes for asset rows and upload limits. */

const KB = 1024;

/** `1.2 MB`, `842 kB`, `0 B`. Keeps two significant figures, never sub-byte noise. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const value = Math.max(0, bytes);
  if (value < KB) return `${Math.round(value)} B`;
  if (value < KB * KB) return `${Math.round(value / KB)} kB`;
  return `${(value / (KB * KB)).toFixed(1)} MB`;
}
