"use client";

/**
 * Doc 07 §4.0 / §10 — the style state behind the palette and style panel.
 *
 * Width, font size and blur strength are seeded from the image's natural width
 * (§10.1, §10.4) and re-seeded once the real image size is known.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_ANNOTATION_COLOR,
  defaultBlurStrength,
  defaultFontSize,
  defaultStrokeWidth,
  styleForTool,
} from "@/lib/canvas/defaults";
import type { EditorTool } from "@/lib/canvas/tools";
import type { Hex, Size, StrokeStyle } from "@/lib/canvas/types";

export interface ToolStateOptions {
  imageSize: Size;
  tool: EditorTool;
  /** `false` until the source bitmap resolves, so defaults are not overwritten. */
  imageReady: boolean;
}

export interface ToolState {
  tool: EditorTool;
  setTool: (tool: EditorTool) => void;
  color: Hex;
  setColor: (color: Hex) => void;
  width: number;
  setWidth: (width: number) => void;
  opacity: number;
  setOpacity: (opacity: number) => void;
  blurMode: "pixelate" | "blur";
  setBlurMode: (mode: "pixelate" | "blur") => void;
  blurStrength: number;
  setBlurStrength: (strength: number) => void;
  fontSize: number;
  setFontSize: (size: number) => void;
  visionMode: boolean;
  setVisionMode: (on: boolean) => void;
  style: StrokeStyle;
}

export function useToolState(options: ToolStateOptions): ToolState {
  const { imageSize, tool, imageReady } = options;
  const [currentTool, setCurrentTool] = useState<EditorTool>(tool);
  const [color, setColor] = useState<Hex>(DEFAULT_ANNOTATION_COLOR);
  const [width, setWidth] = useState(() => defaultStrokeWidth(imageSize.w || 1920));
  const [opacity, setOpacity] = useState(1);
  const [blurMode, setBlurMode] = useState<"pixelate" | "blur">("pixelate");
  const [blurStrength, setBlurStrength] = useState(() => defaultBlurStrength(imageSize.w || 1920, "pixelate"));
  const [fontSize, setFontSize] = useState(() => defaultFontSize(imageSize.w || 1920));
  const [visionMode, setVisionMode] = useState(true);

  // §10.1/§10.4 — the image's real width decides the legibility floor.
  useEffect(() => {
    if (!imageReady || imageSize.w <= 0) return;
    setWidth(defaultStrokeWidth(imageSize.w));
    setFontSize(defaultFontSize(imageSize.w));
    setBlurStrength(defaultBlurStrength(imageSize.w, "pixelate"));
  }, [imageReady, imageSize.w]);

  const style = useMemo(
    () => styleForTool(currentTool, imageSize, { color, width, opacity }),
    [color, currentTool, imageSize, opacity, width],
  );

  const resetWidth = useCallback(
    (next: number) => setWidth(next),
    [],
  );

  return {
    tool: currentTool,
    setTool: setCurrentTool,
    color,
    setColor,
    width,
    setWidth: resetWidth,
    opacity,
    setOpacity,
    blurMode,
    setBlurMode,
    blurStrength,
    setBlurStrength,
    fontSize,
    setFontSize,
    visionMode,
    setVisionMode,
    style,
  };
}
