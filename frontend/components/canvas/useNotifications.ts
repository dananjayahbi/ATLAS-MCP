"use client";

/**
 * Doc 07 §12.2 / §1.3 — status, alert and callback plumbing.
 *
 * `onError`/`onDirtyChange` are mirrored into refs so an inline callback from
 * Doc 06 cannot re-run an effect on every parent render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toCanvasError, type CanvasError } from "@/lib/canvas/errors";

export interface NotifyInput {
  onError?: (error: CanvasError) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export interface NotifyApi {
  announcement: string;
  alert: string | null;
  announce: (message: string) => void;
  reportError: (error: unknown) => void;
  /** Publishes dirty state to Doc 06's unsaved-changes guard. */
  publishDirty: (dirty: boolean) => void;
}

export function useNotifications(input: NotifyInput, dirty: boolean): NotifyApi {
  const [announcement, setAnnouncement] = useState("");
  const [alert, setAlert] = useState<string | null>(null);
  const onErrorRef = useRef(input.onError);
  const onDirtyRef = useRef(input.onDirtyChange);
  onErrorRef.current = input.onError;
  onDirtyRef.current = input.onDirtyChange;

  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const reportError = useCallback((error: unknown) => {
    const canvasError = toCanvasError(error);
    setAlert(canvasError.message);
    onErrorRef.current?.(canvasError);
  }, []);

  const publishDirty = useCallback((next: boolean) => {
    onDirtyRef.current?.(next);
  }, []);

  useEffect(() => {
    publishDirty(dirty);
  }, [dirty, publishDirty]);

  return { announcement, alert, announce, reportError, publishDirty };
}
