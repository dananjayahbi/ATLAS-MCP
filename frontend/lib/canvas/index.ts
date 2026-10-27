/**
 * Doc 07 §17.2 — public barrel for the framework-free canvas engine.
 *
 * Doc 06 consumes `AnnotationCanvas` + `AnnotationCanvasProps` + `ExportResult`
 * from `components/canvas`; everything else here is available for the optional
 * read-only stroke list and for tests.
 */
export * from "./types";
export * from "./errors";
export * from "./tools";
export * from "./document";
export * from "./geometry";
export * from "./viewport";
export * from "./strokes";
export * from "./render";
export * from "./export";
export * from "./upload";
export * from "./autosave";
export * from "./image";
export * from "./scheduler";
