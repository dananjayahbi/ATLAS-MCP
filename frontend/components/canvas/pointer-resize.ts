"use client";

/**
 * Doc 07 §7.6 / §7.8 — resize geometry for the pointer layer.
 *
 * Re-exports the pure handle maths from `lib/canvas/geometry` and adds the
 * member-scaling step, so `pointer-sessions` reads as a state machine only.
 */
export { resizeRectByHandle } from "@/lib/canvas/geometry";
export { scaleStrokeInBBox } from "@/lib/canvas/interaction";
