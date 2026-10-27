// Doc 09 §5 — SSE wire-format decoder. Pure and React-free: (buffer, chunk) -> (frames, rest).
// Implements the EventSource parsing model (WHATWG §9.2.6): a frame ends at a blank
// line, LF/CRLF/CR all terminate a line, and comments/unknown fields are ignored.
import type { SseFrame } from "./types";

export const DEFAULT_RETRY_MS = 3000;

const LINE_BREAK = /\r\n|\r|\n/;
const TERMINATOR = /\r\n\r\n|\n\n|\r\r/;
const TRAILING_EOL = /(?:\r\n|\r|\n)$/;

/** True when the buffer ends mid-line, i.e. the last field is not yet complete. */
function endsWithEol(text: string): boolean {
  return TRAILING_EOL.test(text);
}

type FieldAccumulator = {
  id: string | null;
  event: string;
  data: string[];
  retry: number | null;
  comment: string | null;
  touched: boolean;
};

function emptyAccumulator(): FieldAccumulator {
  return { id: null, event: "", data: [], retry: null, comment: null, touched: false };
}

function applyField(acc: FieldAccumulator, line: string): void {
  if (line === "") return;
  if (line.startsWith(":")) {
    // Comment frame — `: ping` keep-alive (Doc 09 §5.2). Last one wins.
    acc.comment = line.slice(1).replace(/^ /, "");
    acc.touched = true;
    return;
  }
  const colon = line.indexOf(":");
  const field = colon === -1 ? line : line.slice(0, colon);
  // A single leading space after the colon is part of the framing, not the value.
  const raw = colon === -1 ? "" : line.slice(colon + 1);
  const value = raw.startsWith(" ") ? raw.slice(1) : raw;

  switch (field) {
    case "id":
      // Doc 09 §5.3 rule 2: control frames omit `id:`, so `null` means "do not move".
      acc.id = value;
      acc.touched = true;
      break;
    case "event":
      acc.event = value;
      acc.touched = true;
      break;
    case "data":
      // Doc 09 §8.3: join multi-line data with "\n" before JSON.parse.
      acc.data.push(value);
      acc.touched = true;
      break;
    case "retry": {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        acc.retry = parsed;
        acc.touched = true;
      }
      break;
    }
    default:
      // Unknown fields are ignored per the SSE spec.
      break;
  }
}

function toFrame(acc: FieldAccumulator, receivedAt: number): SseFrame | null {
  if (!acc.touched) return null;
  // Per the SSE dispatch model a block with no `data:` and no `event:` never fires
  // an event. `retry:` alone must still reach the caller, so it is reported as a
  // comment-bearing control frame rather than dropped silently.
  const dispatchable = acc.data.length > 0 || acc.event !== "" || acc.comment !== null;
  if (!dispatchable && acc.retry === null) return null;
  return {
    id: acc.id === null || acc.id === "" ? null : acc.id,
    event: acc.event,
    data: acc.data.join("\n"),
    retry: acc.retry,
    comment: acc.comment,
    receivedAt,
  };
}

/**
 * Split `buffer + chunk` into complete frames plus the unconsumed remainder.
 *
 * @param buffer text left over from the previous call (partial frame)
 * @param chunk  newly decoded text from the network or mock transport
 * @param now    `receivedAt` for every frame produced (defaults to `Date.now()`)
 */
export function parseSseChunk(
  buffer: string,
  chunk: string,
  now: number = Date.now(),
): { frames: SseFrame[]; rest: string } {
  const frames: SseFrame[] = [];
  let rest = `${buffer}${chunk}`;

  for (;;) {
    const match = TERMINATOR.exec(rest);
    if (!match) break;
    const block = rest.slice(0, match.index);
    rest = rest.slice(match.index + match[0].length);

    const acc = emptyAccumulator();
    for (const line of block.split(LINE_BREAK)) applyField(acc, line);
    const frame = toFrame(acc, now);
    if (frame) frames.push(frame);
  }

  return { frames, rest };
}

/**
 * Parse a single already-buffered block (the shape `EventSource.onmessage` gives us).
 * Used by the live transport, where the browser has done the framing for us.
 */
export function parseFullFrame(block: string, now: number = Date.now()): SseFrame | null {
  const acc = emptyAccumulator();
  for (const line of block.split(LINE_BREAK)) applyField(acc, line);
  return toFrame(acc, now);
}

/** JSON payload of a frame, or `null` when the data is empty / not an object. */
export function frameJson(frame: SseFrame): Record<string, unknown> | null {
  if (!frame.data) return null;
  try {
    const parsed: unknown = JSON.parse(frame.data);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** Flush the tail of a stream after `close()`. The final frame may lack a blank line. */
export function flushSseBuffer(buffer: string, now: number = Date.now()): SseFrame | null {
  if (!buffer.trim()) return null;
  const { frames, rest } = parseSseChunk(buffer, "\n\n", now);
  if (frames.length > 0) return frames[frames.length - 1] ?? null;
  // No terminator was present; the remainder still deserves one last attempt.
  return rest.trim() ? parseFullFrame(rest.endsWith("\n") ? rest : `${rest}\n`, now) : null;
}

export function hasPartialFrame(buffer: string): boolean {
  return buffer.trim().length > 0 && !endsWithEol(buffer);
}
