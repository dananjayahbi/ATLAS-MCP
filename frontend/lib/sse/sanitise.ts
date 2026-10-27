// Doc 09 §8 / Doc 01 §14.6 — agent output is hostile input. Mirrors the backend
// `sanitise()` (Doc 09 §8.2) so a UI export is byte-comparable with execution.log.

export const MAX_MESSAGE = 4000;
const TRUNCATION_MARK = "…[truncated]";

// S1-S3: CSI / OSC / remaining two-byte escapes.
const ANSI_OSC = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const ANSI_CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ANSI_ESC = /\x1b[@-Z\\-_]/g;
// S4: C0/C1 controls, keeping \n (0x0a) and \t (0x09).
const CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g;
// S8: three or more newlines collapse to one blank line.
const BLANKS = /\n{3,}/g;

/** S1-S8 of Doc 09 §8.1. Never throws; never returns more than MAX messages. */
export function sanitiseText(input: string): string {
  let text = input ?? "";
  text = text.replace(ANSI_OSC, "");
  text = text.replace(ANSI_CSI, "");
  text = text.replace(ANSI_ESC, "");
  text = text.replace(/\t/g, "    ");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  text = text.replace(CTRL, "");
  text = text.replace(BLANKS, "\n\n");
  // Leading/trailing newlines are structural noise in a single log row.
  return text.replace(/^\n+/, "").replace(/\n+$/, "");
}

/** S7: clamp to MAX_MESSAGE chars, reserving room for the truncation marker. */
export function clampMessage(text: string): string {
  if (text.length <= MAX_MESSAGE) return text;
  const head = text.slice(0, MAX_MESSAGE - TRUNCATION_MARK.length).replace(/\s+$/, "");
  return `${head}${TRUNCATION_MARK}`;
}

/** Full pipeline: strip escapes and controls, then clamp. Idempotent. */
export function sanitiseMessage(input: string): string {
  return clampMessage(sanitiseText(input));
}

/** Flat text for the clipboard / export body — one visual line per log line. */
export function sanitiseForExport(input: string): string {
  return sanitiseMessage(input);
}
