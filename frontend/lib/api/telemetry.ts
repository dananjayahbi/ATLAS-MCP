import type { PriorityMatrixResponse, TelemetrySummaryDTO } from "@/lib/types/api";
import { apiGet } from "./client";

/** Doc 01 §12 — telemetry + priority matrix (Doc 06 §11.7 data source). */

export type MatrixXAxis = "age_hours" | "dependency_weight";

export const telemetryApi = {
  summary: (signal?: AbortSignal) => apiGet<TelemetrySummaryDTO>("/telemetry/summary", { signal }),
  matrix: (x: MatrixXAxis, signal?: AbortSignal) =>
    apiGet<PriorityMatrixResponse>(`/priority-matrix?x=${x}`, { signal }),
};
