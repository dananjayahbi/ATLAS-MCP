import type { TaskStatus } from "@/lib/types/enums";
import type { MatrixXAxis } from "./telemetry";

/** Doc 06 §3.3 — every query key is declared here and nowhere else. */

export type BoardFilter = {
  status: TaskStatus[] | null;
  q: string | null;
  agent: string | null;
  blocked: boolean | null;
  discovered: boolean | null;
  priorityMin: number | null;
  sort: "priority" | "created" | "updated" | null;
  order: "asc" | "desc" | null;
  view: "board" | "list" | "matrix";
  group: "status" | "priority";
};

export function filterKey(filter: Partial<BoardFilter>): string {
  return Object.entries(filter)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`)
    .join("&");
}

export const DEFAULT_BOARD_FILTER: BoardFilter = {
  status: null,
  q: null,
  agent: null,
  blocked: null,
  discovered: null,
  priorityMin: null,
  sort: "priority",
  order: "desc",
  view: "board",
  group: "status",
};

export const qk = {
  projects: {
    root: ["projects"] as const,
    list: () => ["projects", "list"] as const,
    detail: (slug: string) => ["projects", "detail", slug] as const,
  },
  tasks: {
    root: ["tasks"] as const,
    board: (slug: string, fk: string) => ["tasks", "board", slug, fk] as const,
    list: (slug: string, fk: string) => ["tasks", "list", slug, fk] as const,
    detail: (id: string) => ["tasks", "detail", id] as const,
  },
  discoveries: {
    root: ["discoveries"] as const,
    list: (fk = "") => ["discoveries", "list", fk] as const,
  },
  reviews: {
    root: ["reviews"] as const,
    list: (fk = "") => ["reviews", "list", fk] as const,
    detail: (id: string) => ["reviews", "detail", id] as const,
  },
  telemetry: {
    root: ["telemetry"] as const,
    summary: () => ["telemetry", "summary"] as const,
    matrix: (x: MatrixXAxis) => ["telemetry", "matrix", x] as const,
  },
  assets: {
    root: ["assets"] as const,
    byTask: (id: string) => ["assets", "byTask", id] as const,
    meta: (id: string) => ["assets", "meta", id] as const,
  },
} as const;
