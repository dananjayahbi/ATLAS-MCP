"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/format/cn";
import { burnMarkup, fromSnapshot, strokeCount } from "@/lib/markup";
import {
  clearAll,
  commitStroke as appendStroke,
  beginStroke,
  eraseMany,
  extendStroke,
} from "@/lib/markup/strokes";
import { DEFAULT_COLOR, DEFAULT_WIDTH } from "@/lib/markup/types";
import type { MarkupDocument, MarkupPoint, MarkupTool } from "@/lib/markup/types";
import { assetsApi, type TaskAssetPreview } from "@/lib/api/assets";
import { errorMessage } from "@/lib/api/errors";
import { useMarkupHistory } from "@/hooks/use-markup-history";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/api/keys";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { MarkupImageList, type MarkupImageEntry } from "./markup-image-list";
import { MarkupToolbar } from "./markup-toolbar";
import { useMarkupCanvas } from "./use-markup-canvas";

/**
 * The full-viewport markup surface behind every thumbnail click.
 *
 * Layout is frozen by the operator's brief: image list on the right, preview on
 * the left, canvas tools on top. Saving is a two-step confirm because it
 * rewrites evidence.
 */

export type MarkupModalProps = {
  open: boolean;
  taskId: string;
  taskTitle: string;
  /** Source image the operator clicked. */
  assetId: string | null;
  /** Every image on the task, so the rail can switch without a round-trip. */
  images: readonly MarkupImageEntry[];
  onClose: () => void;
  /** Fires after a successful burn-in so the board can refresh its thumbnails. */
  onSaved?: (sourceAssetId: string) => void;
  className?: string;
};

const ERASER_RADIUS = 14;

export function MarkupModal({
  open,
  taskId,
  taskTitle,
  assetId,
  images,
  onClose,
  onSaved,
  className,
}: MarkupModalProps) {
  const queryClient = useQueryClient();
  const [currentId, setCurrentId] = useState<string | null>(assetId);
  const [tool, setTool] = useState<MarkupTool>("pen");
  const [color, setColor] = useState<string>(DEFAULT_COLOR);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [loadedDocument, setLoadedDocument] = useState<MarkupDocument | null>(null);
  // The key handler must see the current confirm state without being rebuilt.
  const confirmingRef = useRef(false);
  confirmingRef.current = confirming;

  const initial = useMemo(() => ({ strokes: [], width: 1, height: 1 }) as MarkupDocument, []);
  const history = useMarkupHistory(initial);
  const seededForRef = useRef<string | null>(null);

  /**
   * Switching images must also switch documents, and the reset has to happen in
   * the same tick as the selection — otherwise the previous image's strokes
   * paint over the new one (the reported "highlights appear on all images").
   */
  const selectImage = useCallback(
    (id: string | null) => {
      setCurrentId(id);
      setLoadedDocument(null);
      seededForRef.current = null;
      history.reset(initial);
    },
    [history, initial],
  );

  // The seed effect below runs before `selectImage` exists in declaration order,
  // so it reaches the latest callback through a ref.
  const selectImageRef = useRef(selectImage);
  selectImageRef.current = selectImage;

  // Seed the selection once per open. `images` is a fresh array on every parent
  // render, so depending on it would re-assert the image the operator opened
  // with and yank them back from whatever the rail had selected.
  const seedRef = useRef<{ open: boolean; assetId: string | null }>({ open: false, assetId: null });
  useEffect(() => {
    if (!open) {
      seedRef.current = { open: false, assetId: null };
      return;
    }
    if (seedRef.current.open && seedRef.current.assetId === assetId) return;
    seedRef.current = { open: true, assetId };
    selectImageRef.current(assetId ?? images[0]?.id ?? null);
    // `images` is intentionally read but not depended on: it is the fallback
    // only, and re-running on its identity change is the bug this guards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, assetId]);

  const active = useMemo(
    () => images.find((image) => image.id === currentId) ?? null,
    [images, currentId],
  );

  /**
   * The burn-in target URL. `version` is the asset's content hash, so a save
   * mutates the URL and the <img> both repaints and re-decodes at natural size.
   */
  const activeImageUrl = useMemo(
    () => (active ? assetsApi.contentUrl(active.id, active.version) : ""),
    [active],
  );

  /**
   * Applies a stored document exactly once per (image, bitmap size) pair.
   *
   * Two effects feed this: the fetch (placeholder 1×1 document) and the bitmap
   * decode (real dimensions). Keying on both means the re-projection lands, while
   * the guard keeps a re-render from looping through `history.reset`.
   */
  useEffect(() => {
    if (!open || !currentId) {
      seededForRef.current = null;
      return;
    }
    const key = loadedDocument
      ? `${currentId}:${loadedDocument.width}x${loadedDocument.height}`
      : `${currentId}:empty`;
    if (seededForRef.current === key) return;
    seededForRef.current = key;
    history.reset(loadedDocument ?? initial);
    // `history.reset` is stable; depending on the object would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentId, loadedDocument, initial]);

  /* ------------------------------------------------ load the stored markup */

  useEffect(() => {
    if (!open || !currentId) return;
    let cancelled = false;
    setLoadedDocument(null);
    setError(null);
    void assetsApi
      .annotation(currentId)
      .then((payload) => {
        if (cancelled) return;
        // The document's own image space comes from the bitmap once it loads, so
        // seed with a placeholder and let the size effect below re-project it.
        const document = payload.document ? fromSnapshot(payload.document, { width: 1, height: 1 }) : null;
        if (document) setLoadedDocument(document);
      })
      .catch(() => {
        // A missing side-car is normal for a first edit.
        if (!cancelled) setLoadedDocument(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentId]);

  // Once the bitmap is decoded, replace the placeholder dimensions so burn-in
  // paints at natural resolution instead of 1×1.
  useEffect(() => {
    if (!loadedDocument || !size) return;
    if (loadedDocument.width === size.w && loadedDocument.height === size.h) return;
    setLoadedDocument({ ...loadedDocument, width: size.w, height: size.h });
    // Re-running on every `loadedDocument` change would loop on the new object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size]);

  /* ------------------------------------------------ image element for burn-in */

  const canvas = useMarkupCanvas({
    imageUrl: activeImageUrl,
    tool,
    color,
    width,
    eraserRadius: ERASER_RADIUS,
    doc: history.doc,
    onStrokeCommit: (points, strokeColor, strokeWidth) => {
      const base = beginStroke(strokeColor, strokeWidth, points[0]);
      const stroke = points.slice(1).reduce(extendStroke, base);
      history.commit(appendStroke(history.doc, stroke));
    },
    onErase: (points) => {
      const next = eraseMany(history.doc, points, ERASER_RADIUS);
      if (next !== history.doc) history.commitIfChanged(next);
    },
    onImageReady: (next) => {
      setSize(next);
    },
    onError: setError,
  });

  /* ------------------------------------------------ keyboard shortcuts */

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      const typing =
        event.target instanceof HTMLElement &&
        (event.target.tagName === "INPUT" ||
          event.target.tagName === "TEXTAREA" ||
          event.target.isContentEditable);
      if (typing) return;

      // Escape closes the confirm first, then the editor — the operator should
      // never lose their strokes to a stray keypress.
      if (event.key === "Escape") {
        event.stopPropagation();
        if (confirmingRef.current) setConfirming(false);
        else if (!saving) onClose();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        history.redo();
        return;
      }
      switch (event.key.toLowerCase()) {
        case "p":
          setTool("pen");
          break;
        case "e":
          setTool("eraser");
          break;
        case "+":
        case "=":
          canvas.zoomIn();
          break;
        case "-":
          canvas.zoomOut();
          break;
        case "0":
          canvas.resetView();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, history, canvas, onClose, saving]);

  /* ------------------------------------------------ save */

  const save = useCallback(async () => {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      const image = canvas.image;
      if (!image || !size) throw new Error("The image is still loading.");
      const flattened = await burnMarkup(image, {
        ...history.doc,
        width: size.w,
        height: size.h,
      });
      await assetsApi.saveAnnotation(
        active.id,
        flattened,
        { version: 1, strokes: history.doc.strokes },
        true,
        true,
      );
      // A fresh fingerprint, not a fresh component: the <img> src is stable but
      // the bytes changed, so every preview must drop its cached copy.
      await queryClient.invalidateQueries({ queryKey: qk.assets.root });
      await queryClient.invalidateQueries({ queryKey: qk.tasks.detail(taskId) });
      toast({ level: "info", title: "Markup burned into the image" });
      onSaved?.(active.id);
      setConfirming(false);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }, [active, canvas.image, history.doc, onClose, onSaved, queryClient, size, taskId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-canvas/97 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Markup: ${taskTitle}`}>
      <header className="flex shrink-0 items-center gap-3 border-b border-grid-strong bg-panel px-3 py-2">
        <h2 className="min-w-0 truncate text-hud-label uppercase tracking-[0.06em] text-primary">
          Markup · {taskTitle}
        </h2>
        {error ? (
          <p role="alert" className="min-w-0 flex-1 truncate text-hud-micro text-critical-hot">
            {error}
          </p>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <span className="shrink-0 font-machine text-hud-micro uppercase text-disabled">
          {strokeCount(history.doc)} strokes
        </span>
        <Button size="sm" onClick={onClose} disabled={saving}>
          Close <Kbd size="xs">Esc</Kbd>
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => setConfirming(true)}
          loading={saving}
          disabled={!active || strokeCount(history.doc) === 0}
        >
          Save markup
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <MarkupToolbar
            tool={tool}
            onTool={setTool}
            color={color}
            onColor={setColor}
            width={width}
            onWidth={setWidth}
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={history.undo}
            onRedo={history.redo}
            zoomPercent={canvas.zoomPercent}
            onZoomIn={canvas.zoomIn}
            onZoomOut={canvas.zoomOut}
            onResetView={canvas.resetView}
            strokeCount={strokeCount(history.doc)}
            onClear={() => history.commit(clearAll(history.doc))}
            disabled={saving}
          />

          <div
            ref={canvas.containerRef}
            className={cn(
              "relative min-h-0 min-w-0 flex-1 overflow-hidden bg-[var(--surface-canvas)]",
              className,
            )}
            style={{
              cursor: canvas.panning ? "grabbing" : canvas.spaceDown ? "grab" : "crosshair",
              // A checkerboard makes transparency obvious without a colour assertion.
              backgroundImage:
                "linear-gradient(45deg, var(--surface-inset) 25%, transparent 25%, transparent 75%, var(--surface-inset) 75%), linear-gradient(45deg, var(--surface-inset) 25%, transparent 25%, transparent 75%, var(--surface-inset) 75%)",
              backgroundSize: "16px 16px",
              backgroundPosition: "0 0, 8px 8px",
            }}
          >
            {active ? (
              /* eslint-disable-next-line @next/next/no-img-element -- positioned by the canvas transform */
              <img
                src={activeImageUrl}
                alt={active.label}
                draggable={false}
                className="pointer-events-none absolute left-0 top-0 origin-top-left select-none"
                style={{
                  width: canvas.imageSize?.w,
                  height: canvas.imageSize?.h,
                  transform: `translate(${canvas.view.tx}px, ${canvas.view.ty}px) scale(${canvas.view.scale})`,
                  imageRendering: canvas.view.scale > 1.5 ? "pixelated" : "auto",
                }}
              />
            ) : null}

            <canvas
              ref={canvas.overlayRef}
              aria-label="Markup canvas"
              className="absolute inset-0 touch-none"
              data-testid="markup-overlay"
              onPointerDown={canvas.handlers.onPointerDown}
              onPointerMove={canvas.handlers.onPointerMove}
              onPointerUp={canvas.handlers.onPointerUp}
              onPointerLeave={canvas.handlers.onPointerLeave}
            />
          </div>
        </div>

        <MarkupImageList images={images} activeId={currentId ?? ""} onSelect={selectImage} />
      </div>

      {confirming ? (
        <div className="absolute inset-0 z-10 grid place-items-center bg-[var(--surface-scrim)] p-4">
          <div
            role="alertdialog"
            aria-label="Confirm markup"
            className="w-full max-w-md rounded-hud border border-grid-strong bg-panel p-3 shadow-hud-panel"
          >
            <h3 className="text-hud-label uppercase tracking-[0.06em] text-primary">Burn markup into the image?</h3>
            <p className="mt-1 text-hud-body text-secondary">
              {strokeCount(history.doc)} stroke{strokeCount(history.doc) === 1 ? "" : "s"} will be flattened
              onto <span className="font-machine text-primary">{active?.label ?? "this image"}</span> and saved
              as that one image — no duplicate copy is created. The strokes become pixels, so the editor
              reopens blank.
            </p>
            <div className="mt-2 flex items-center justify-end gap-1">
              <Button size="sm" onClick={() => setConfirming(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={() => void save()} loading={saving}>
                Yes, burn {strokeCount(history.doc)} stroke{strokeCount(history.doc) === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { MarkupImageEntry, TaskAssetPreview, MarkupPoint };
