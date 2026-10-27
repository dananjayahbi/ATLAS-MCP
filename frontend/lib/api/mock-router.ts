import { ApiError } from "./client";
import {
  applyTaskAction,
  createTask,
  resolveDiscovery,
  resolveReview,
  setPriority,
  toggleDodItem,
} from "./mock-handlers";
import { clone, db, detailFor, listOf, pickMatrix, stripDetail, syncCounters } from "./mock-store";

/**
 * Resolves a `/api/v1/...` request against the fixture pack. Throws `ApiError`
 * exactly like the live API, so error paths are exercised in mock mode too.
 */

type MockBody = Record<string, unknown> | undefined;

type Route =
  | { kind: "projects" }
  | { kind: "project"; params: [string] }
  | { kind: "projectTasks"; params: [string] }
  | { kind: "task"; params: [string] }
  | { kind: "priority"; params: [string] }
  | { kind: "dod"; params: [string, string] }
  | { kind: "taskAction"; params: [string, string] }
  | { kind: "discoveries" }
  | { kind: "discoveryAction"; params: [string, string] }
  | { kind: "reviews" }
  | { kind: "reviewAction"; params: [string, string] }
  | { kind: "telemetry" }
  | { kind: "matrix" }
  | { kind: "unknown" };

const decode = (value: string | undefined): string => decodeURIComponent(value ?? "");

function matchRoute(path: string): Route {
  let m: RegExpMatchArray | null;
  if (path === "/projects") return { kind: "projects" };
  if ((m = path.match(/^\/projects\/([^/]+)$/))) return { kind: "project", params: [decode(m[1])] };
  if ((m = path.match(/^\/projects\/([^/]+)\/tasks$/))) return { kind: "projectTasks", params: [decode(m[1])] };
  if ((m = path.match(/^\/tasks\/([^/]+)\/priority$/))) return { kind: "priority", params: [decode(m[1])] };
  if ((m = path.match(/^\/tasks\/([^/]+)\/dod\/([^/]+)$/))) {
    return { kind: "dod", params: [decode(m[1]), decode(m[2])] };
  }
  if ((m = path.match(/^\/tasks\/([^/]+)\/(force-release|requeue|archive)$/))) {
    return { kind: "taskAction", params: [decode(m[1]), m[2]] };
  }
  if ((m = path.match(/^\/tasks\/([^/]+)$/))) return { kind: "task", params: [decode(m[1])] };
  if (path === "/discoveries") return { kind: "discoveries" };
  if ((m = path.match(/^\/discoveries\/([^/]+)\/(approve|reject)$/))) {
    return { kind: "discoveryAction", params: [decode(m[1]), m[2]] };
  }
  if (path === "/reviews") return { kind: "reviews" };
  if ((m = path.match(/^\/reviews\/([^/]+)\/(approve|reject)$/))) {
    return { kind: "reviewAction", params: [decode(m[1]), m[2]] };
  }
  if (path === "/telemetry/summary") return { kind: "telemetry" };
  if (path === "/priority-matrix") return { kind: "matrix" };
  return { kind: "unknown" };
}

export function resolveMockRequest<T>(url: string, method: string, body?: unknown): T {
  const parsed = new URL(url, "http://mock.local");
  const path = parsed.pathname.replace(/^\/api\/v1/, "");
  const payload = (body ?? {}) as MockBody;
  const verb = method.toUpperCase();
  const route = matchRoute(path);

  switch (route.kind) {
    case "projects":
      return listOf(db.projects) as T;
    case "project": {
      const project = db.projects.find((entry) => entry.slug === route.params[0]);
      if (!project) throw new ApiError("PROJECT_NOT_FOUND", 404, "Project no longer exists");
      if (verb === "PATCH") Object.assign(project, payload);
      return clone(project) as T;
    }
    case "projectTasks": {
      const slug = route.params[0];
      if (verb === "POST") return createTask(slug, payload) as T;
      return listOf(Object.values(db.tasks).filter((task) => task.project_slug === slug)) as T;
    }
    case "task": {
      const id = route.params[0];
      const detail = detailFor(id);
      if (!detail) throw new ApiError("TASK_NOT_FOUND", 404, `Task ${id} no longer exists`);
      if (verb === "PATCH") {
        Object.assign(detail, payload);
        db.tasks[id] = { ...db.tasks[id], ...stripDetail(detail) };
        syncCounters();
      }
      return clone(detail) as T;
    }
    case "priority":
      return setPriority(route.params[0], Number(payload?.priority ?? 0)) as T;
    case "dod":
      return toggleDodItem(route.params[0], Number(route.params[1]), Boolean(payload?.completed)) as T;
    case "taskAction":
      return applyTaskAction(route.params[0], route.params[1]) as T;
    case "discoveries":
      return listOf(db.discoveries.filter((discovery) => discovery.status === "PENDING_APPROVAL")) as T;
    case "discoveryAction":
      return resolveDiscovery(route.params[0], route.params[1], payload) as T;
    case "reviews":
      return listOf(db.reviews) as T;
    case "reviewAction":
      return resolveReview(route.params[0], route.params[1], payload) as T;
    case "telemetry":
      db.telemetry.generated_at = new Date().toISOString();
      return clone(db.telemetry) as T;
    case "matrix": {
      const axis = parsed.searchParams.get("x");
      return pickMatrix(axis === "dependency_weight" ? "dependency_weight" : "age_hours") as T;
    }
    default:
      throw new ApiError("INTERNAL_ERROR", 500, `No mock fixture for ${verb} ${path}`);
  }
}
