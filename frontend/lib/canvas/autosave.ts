/**
 * Doc 07 §13 — debounced local recovery buffer.
 *
 * `localStorage` is a **crash buffer, not storage of record** (§13.4). The
 * durable artefact is the uploaded PNG. Every entry point degrades gracefully:
 * when storage is unavailable (private mode, SSR, quota) the engine keeps
 * working and simply reports `CANVAS_AUTOSAVE_FULL` on a failed write.
 */
import { deserialiseDocument, restoreDocument, serialiseDocument } from "./document";
import { CanvasError } from "./errors";
import { CANVAS_DOC_VERSION, type CanvasDocument } from "./types";

export const AUTOSAVE_DEBOUNCE_MS = 500;
export const STORAGE_PREFIX = "atlas.canvas.v1.";
/** §13.2 mitigation 1 — above this we drop optional sections, then refuse. */
export const MAX_ENTRY_BYTES = 2_000_000;
export const MAX_EXPORT_REMEMBER_BYTES = 4 * 1024 * 1024;

export function storageKey(taskId: string): string {
  return `${STORAGE_PREFIX}${taskId}`;
}

export interface StoredEnvelope {
  saved_at: string;
  doc: CanvasDocument;
}

export interface RestoreResult {
  outcome: "none" | "ok" | "stale" | "incompatible" | "corrupt";
  doc: CanvasDocument | null;
  savedAt: string | null;
  /** `true` when the buffer belongs to a different source screenshot (§13.3). */
  stale: boolean;
  error: CanvasError | null;
}

/* --------------------------------------------------------------- availability */

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const probe = `${STORAGE_PREFIX}__probe__`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function isStorageAvailable(): boolean {
  return getStorage() !== null;
}

/* -------------------------------------------------------------------- write */

export interface SaveOutcome {
  ok: boolean;
  droppedFields: boolean;
  error: CanvasError | null;
}

/** Synchronous write used by the debouncer. Never throws. */
export function saveSnapshot(taskId: string, doc: CanvasDocument): SaveOutcome {
  const storage = getStorage();
  if (!storage) {
    return { ok: false, droppedFields: false, error: new CanvasError("CANVAS_AUTOSAVE_FULL", "Local storage unavailable") };
  }
  const envelope: StoredEnvelope = { saved_at: new Date().toISOString(), doc };
  const full = JSON.stringify(envelope);
  if (full.length <= MAX_ENTRY_BYTES) {
    const written = writeWithRecovery(storage, taskId, full);
    if (written) return { ok: true, droppedFields: false, error: null };
    return { ok: false, droppedFields: false, error: new CanvasError("CANVAS_AUTOSAVE_FULL") };
  }
  // Mitigation 1: drop crop + legend, then write; refuse only if still too big.
  const slim: CanvasDocument = { ...doc, crop: null, legend: { enabled: false, items: [] } };
  const slimmed = JSON.stringify({ saved_at: envelope.saved_at, doc: slim });
  if (slimmed.length > MAX_ENTRY_BYTES) {
    return { ok: false, droppedFields: true, error: new CanvasError("CANVAS_AUTOSAVE_FULL") };
  }
  const written = writeWithRecovery(storage, taskId, slimmed);
  return written
    ? { ok: true, droppedFields: true, error: null }
    : { ok: false, droppedFields: true, error: new CanvasError("CANVAS_AUTOSAVE_FULL") };
}

/** §13.2 mitigation 2 — evict the oldest entry and retry exactly once. */
function writeWithRecovery(storage: Storage, taskId: string, payload: string): boolean {
  try {
    storage.setItem(storageKey(taskId), payload);
    return true;
  } catch {
    if (!evictOldest(storage)) return false;
  }
  try {
    storage.setItem(storageKey(taskId), payload);
    return true;
  } catch {
    return false;
  }
}

function evictOldest(storage: Storage): boolean {
  const own: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (key && key.startsWith(STORAGE_PREFIX)) own.push(key);
  }
  const victim = own.find((key) => key !== `${STORAGE_PREFIX}__probe__`);
  if (!victim) return false;
  try {
    storage.removeItem(victim);
    return true;
  } catch {
    return false;
  }
}

/* --------------------------------------------------------------------- read */

export function loadSnapshot(taskId: string, sourceAssetId: string): RestoreResult {
  const storage = getStorage();
  if (!storage) return { outcome: "none", doc: null, savedAt: null, stale: false, error: null };
  let raw: string | null = null;
  try {
    raw = storage.getItem(storageKey(taskId));
  } catch {
    return { outcome: "none", doc: null, savedAt: null, stale: false, error: null };
  }
  if (!raw) return { outcome: "none", doc: null, savedAt: null, stale: false, error: null };

  const restored = restoreDocument(raw);
  if (restored.error) {
    return { outcome: "incompatible", doc: null, savedAt: null, stale: false, error: restored.error };
  }
  if (!restored.doc) {
    return { outcome: "corrupt", doc: null, savedAt: null, stale: false, error: null };
  }
  const savedAt = readSavedAt(raw);
  const stale = restored.doc.sourceAssetId !== sourceAssetId;
  return { outcome: stale ? "stale" : "ok", doc: restored.doc, savedAt, stale, error: null };
}

function readSavedAt(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as { saved_at?: unknown };
    return typeof parsed.saved_at === "string" ? parsed.saved_at : null;
  } catch {
    return null;
  }
}

/** Raw JSON for the "VIEW AS JSON" affordance (§13.3). */
export function readSnapshotJson(taskId: string): string | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    return storage.getItem(storageKey(taskId));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ delete */

export function clearSnapshot(taskId: string): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.removeItem(storageKey(taskId));
  } catch {
    /* a failed clear must never surface to the user */
  }
}

/* --------------------------------------------------------------- debouncer */

export interface Autosave {
  /** Record a new document; the write happens 500 ms after the last call. */
  schedule(doc: CanvasDocument): void;
  /** Write immediately (visibility change, unmount). Returns the outcome. */
  flush(): SaveOutcome | null;
  /** Drop pending work without writing. */
  cancel(): void;
  dispose(): void;
  isDirty(): boolean;
}

export interface AutosaveOptions {
  taskId: string;
  debounceMs?: number;
  onError?: (error: CanvasError) => void;
  onSaved?: (savedAt: string, droppedFields: boolean) => void;
  /** Injected for tests; defaults to a real timer pair. */
  setTimer?: (fn: () => void, ms: number) => number;
  clearTimer?: (handle: number) => void;
}

export function createAutosave(options: AutosaveOptions): Autosave {
  const debounceMs = options.debounceMs ?? AUTOSAVE_DEBOUNCE_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms) as unknown as number);
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));
  let pending: CanvasDocument | null = null;
  let handle: number | null = null;
  let disposed = false;

  const cancel = (): void => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  };

  const write = (): SaveOutcome | null => {
    if (!pending) return null;
    const doc = pending;
    pending = null;
    const outcome = saveSnapshot(options.taskId, doc);
    if (outcome.ok) {
      options.onSaved?.(new Date().toISOString(), outcome.droppedFields);
    } else if (outcome.error) {
      options.onError?.(outcome.error);
    }
    return outcome;
  };

  return {
    schedule(doc: CanvasDocument) {
      if (disposed) return;
      pending = doc;
      cancel();
      handle = setTimer(() => {
        handle = null;
        write();
      }, debounceMs);
    },
    flush() {
      cancel();
      return write();
    },
    cancel() {
      cancel();
      pending = null;
    },
    dispose() {
      cancel();
      pending = null;
      disposed = true;
    },
    isDirty() {
      return pending !== null;
    },
  };
}

/* --------------------------------------------------------------- multi-tab */

/**
 * §15.3 multi-tab note — fires when another tab writes the same task key so
 * the UI can offer `LOAD THEIRS` / `KEEP MINE` instead of last-writer-wins.
 */
export function subscribeStorage(
  taskId: string,
  onForeignWrite: (snapshot: CanvasDocument | null) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const key = storageKey(taskId);
  const handler = (event: StorageEvent): void => {
    if (event.key !== key) return;
    onForeignWrite(event.newValue ? deserialiseDocument(event.newValue) : null);
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}

/** Exported for the export flow: only the current version is ever written. */
export const AUTOSAVE_VERSION = CANVAS_DOC_VERSION;

/** Used by callers that need a serialised size estimate before writing. */
export function estimateEntryBytes(doc: CanvasDocument): number {
  return serialiseDocument(doc).length;
}
