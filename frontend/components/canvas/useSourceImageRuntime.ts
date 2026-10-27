"use client";

/**
 * Doc 07 §11.4 — the source bitmap lifecycle.
 *
 * Decoded once via `createImageBitmap`, recorded on the scene, and closed on
 * unmount or when the URL changes. Failures resolve to an `imageStatus` of
 * `"error"` so the base layer can render the placeholder (§5.1), never a throw.
 */
import { useEffect, useState } from "react";
import { disposeBitmap } from "@/lib/canvas/image";
import type { CanvasDocument, ImageStatus, Size } from "@/lib/canvas/types";
import type { Scene } from "./scene";
import { useSourceImage } from "./usePersistence";

export interface SourceImageRuntimeOptions {
  url: string;
  initialDocument?: CanvasDocument;
  imageRef: { current: ImageBitmap | null };
  sceneRef: { current: Scene };
  onError: (error: unknown) => void;
  onLoaded: (size: Size) => void;
}

export interface SourceImageRuntime {
  imageSize: Size;
  imageReady: boolean;
  status: ImageStatus;
}

export function useSourceImageRuntime(options: SourceImageRuntimeOptions): SourceImageRuntime {
  const { url, initialDocument, imageRef, sceneRef, onError, onLoaded } = options;
  const [imageSize, setImageSize] = useState<Size>(
    initialDocument?.imageNaturalSize ?? { w: 1, h: 1 },
  );
  const [status, setStatus] = useState<ImageStatus>("idle");

  useSourceImage({
    url,
    initialDocument,
    onError,
    onStatus: (next) => {
      sceneRef.current.imageStatus = next;
      setStatus(next);
    },
    onLoaded: (bitmap, size) => {
      disposeBitmap(imageRef.current);
      imageRef.current = bitmap;
      const resolved = initialDocument?.imageNaturalSize ?? size;
      const scene = sceneRef.current;
      scene.image = bitmap;
      scene.doc = { ...scene.doc, imageNaturalSize: resolved };
      setImageSize(resolved);
      onLoaded(resolved);
    },
  });

  useEffect(
    () => () => {
      disposeBitmap(imageRef.current);
      imageRef.current = null;
      sceneRef.current.image = null;
    },
    [imageRef, sceneRef],
  );

  return { imageSize, imageReady: status === "ready", status };
}
