// Doc 09 §15 — bounded ring buffer with `useSyncExternalStore` semantics.
// React-free. `getSnapshot()` returns a frozen object whose identity changes only
// after a mutation, so React's Object.is comparison cannot loop (§12 "Snapshot identity").

export interface RingBufferSnapshot<T> {
  /** oldest -> newest */
  readonly items: readonly T[];
  /** accepted appends since construction (monotonic) */
  readonly total: number;
  /** items evicted by the line or byte ceiling */
  readonly dropped: number;
  /** appends rejected because they duplicated or went backwards */
  readonly duplicates: number;
  /** `seq` discontinuities observed (Doc 09 §9, F9) */
  readonly gaps: number;
  /** highest accepted `seq`, 0 before the first item */
  readonly lastSeq: number;
  /** increments once per mutation; a cheap render dependency */
  readonly version: number;
}

export interface RingBufferOptions<T> {
  /** default 2000 (Doc 09 §15 task channel) */
  maxLines?: number;
  /** default 2 MB (Doc 09 §15 task channel) */
  maxBytes?: number;
  /** approximate retained size of one item, in bytes */
  sizeOf?: (item: T) => number;
  /** ordering key; when absent the buffer is an unkeyed FIFO */
  seqOf?: (item: T) => number;
  /** identity key for exact dedupe; when absent only `seq` guards duplicates */
  keyOf?: (item: T) => string | null;
  /** items that must bypass `seq` ordering (e.g. `stream.reset`, seq 0) */
  isControl?: (item: T) => boolean;
  /** invoked when an accepted item skips ahead in `seq` */
  onGap?: (from: number, to: number) => void;
}

export interface RingBuffer<T> {
  /** true when the item was accepted */
  append(item: T): boolean;
  appendMany(items: readonly T[]): number;
  clear(): void;
  getSnapshot(): RingBufferSnapshot<T>;
  subscribe(listener: () => void): () => void;
  /** retained item count */
  readonly size: number;
}

export const TASK_LOG_MAX_LINES = 2000;
export const TASK_LOG_MAX_BYTES = 2 * 1024 * 1024;
export const PROJECT_MAX_LINES = 500;
export const PROJECT_MAX_BYTES = 512 * 1024;

function approximateSize(value: unknown): number {
  if (typeof value === "string") return value.length * 2;
  try {
    return JSON.stringify(value)?.length ?? 128;
  } catch {
    return 128;
  }
}

export function createRingBuffer<T>(options: RingBufferOptions<T> = {}): RingBuffer<T> {
  const maxLines = Math.max(1, options.maxLines ?? TASK_LOG_MAX_LINES);
  const maxBytes = Math.max(1024, options.maxBytes ?? TASK_LOG_MAX_BYTES);
  const sizeOf = options.sizeOf ?? approximateSize;
  const seqOf = options.seqOf;
  const keyOf = options.keyOf;
  const isControl = options.isControl;

  let items: T[] = [];
  let bytes = 0;
  let total = 0;
  let dropped = 0;
  let duplicates = 0;
  let gaps = 0;
  let lastSeq = 0;
  let version = 0;
  let snapshot: RingBufferSnapshot<T> | null = null;
  let keys: Set<string> | null = keyOf ? new Set<string>() : null;

  const listeners = new Set<() => void>();

  const build = (): RingBufferSnapshot<T> => ({
    items: Object.freeze(items.slice()) as readonly T[],
    total,
    dropped,
    duplicates,
    gaps,
    lastSeq,
    version,
  });

  const notify = (): void => {
    snapshot = null;
    for (const listener of listeners) listener();
  };

  const evict = (): void => {
    while (items.length > maxLines) {
      const removed = items.shift();
      if (removed === undefined) break;
      bytes -= sizeOf(removed);
      dropped += 1;
      if (keys && keyOf) {
        const key = keyOf(removed);
        if (key !== null) keys.delete(key);
      }
    }
    // Byte ceiling: a single oversized burst may evict a large prefix.
    while (bytes > maxBytes && items.length > 1) {
      const removed = items.shift();
      if (removed === undefined) break;
      bytes -= sizeOf(removed);
      dropped += 1;
      if (keys && keyOf) {
        const key = keyOf(removed);
        if (key !== null) keys.delete(key);
      }
    }
    if (bytes < 0) bytes = 0;
  };

  const append = (item: T): boolean => {
    // Identity dedupe first: a replayed overlap must not advance `lastSeq` either.
    if (keys && keyOf) {
      const key = keyOf(item);
      if (key !== null && keys.has(key)) {
        duplicates += 1;
        return false;
      }
      if (key !== null) keys.add(key);
    }

    const control = isControl?.(item) ?? false;
    if (!control && seqOf) {
      const seq = seqOf(item);
      if (seq <= lastSeq) {
        duplicates += 1;
        return false;
      }
      if (lastSeq > 0 && seq > lastSeq + 1) {
        gaps += 1;
        options.onGap?.(lastSeq, seq);
      }
      lastSeq = seq;
    }

    items.push(item);
    bytes += sizeOf(item);
    total += 1;
    version += 1;
    evict();
    notify();
    return true;
  };

  return {
    append,
    appendMany(next: readonly T[]): number {
      let accepted = 0;
      for (const item of next) if (append(item)) accepted += 1;
      return accepted;
    },
    clear(): void {
      items = [];
      bytes = 0;
      dropped = 0;
      duplicates = 0;
      gaps = 0;
      lastSeq = 0;
      keys = keyOf ? new Set<string>() : null;
      version += 1;
      notify();
    },
    getSnapshot(): RingBufferSnapshot<T> {
      if (snapshot === null) snapshot = build();
      return snapshot;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get size(): number {
      return items.length;
    },
  };
}
