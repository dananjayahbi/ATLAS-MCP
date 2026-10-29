import { ApiError } from "./client";
import {
  applyTaskAction,
  createTask,
  resolveDiscovery,
  resolveReview,
  setPriority,
  toggleDodItem,
} from "./mock-handlers";
import {
  setAssignee,
  setStatus,
  updateProject,
  updateTaskDetail,
} from "./mock-handlers-edit";
import { clone, db, detailFor, listOf, pickMatrix, syncCounters } from "./mock-store";
import type { TaskStatus } from "@/lib/types/enums";

/**
 * Resolves a `/api/v1/...` request against the fixture pack. Throws `ApiError`
 * exactly like the live API, so error paths are exercised in mock mode too.
 */

type MockBody = Record<string, unknown> | undefined;

type Route =
  | { kind: "projects" }
  | { kind: "project"; params: [string] }
  | { kind: "projectTasks"; params: [string] }
  | { kind: "projectArchive"; params: [string] }
  | { kind: "task"; params: [string] }
  | { kind: "status"; params: [string] }
  | { kind: "assignee"; params: [string] }
  | { kind: "priority"; params: [string] }
  | { kind: "dod"; params: [string, string] }
  | { kind: "taskAction"; params: [string, string] }
  | { kind: "discoveries" }
  | { kind: "discoveryAction"; params: [string, string] }
  | { kind: "claimLimits" }
  | { kind: "reviews" }
  | { kind: "reviewAction"; params: [string, string] }
  | { kind: "telemetry" }
  | { kind: "matrix" }
  | { kind: "unknown" };

const decode = (value: string | undefined): string => decodeURIComponent(value ?? "");

/** `?archived=` filter, mirroring the API: omitted → active only, `all` → both. */
type ArchiveFilter = "active" | "archived" | "all";

function archivedOf(raw: string | null): ArchiveFilter {
  if (raw === null || raw === "") return "active";
  const value = raw.trim().toLowerCase();
  if (value === "all") return "all";
  return value === "1" || value === "true" || value === "yes" ? "archived" : "active";
}

function matchesArchive(archivedAt: string | null, filter: ArchiveFilter): boolean {
  // Archived work is opt-in: every working surface reads the default list.
  if (filter === "all") return true;
  return filter === "archived" ? archivedAt !== null : archivedAt === null;
}

function matchRoute(path: string): Route {
  let m: RegExpMatchArray | null;
  if (path === "/projects") return { kind: "projects" };
  if ((m = path.match(/^\/projects\/([^/]+)\/archive$/))) return { kind: "projectArchive", params: [decode(m[1])] };
  if ((m = path.match(/^\/projects\/([^/]+)$/))) return { kind: "project", params: [decode(m[1])] };
  if ((m = path.match(/^\/projects\/([^/]+)\/tasks$/))) return { kind: "projectTasks", params: [decode(m[1])] };
  if ((m = path.match(/^\/tasks\/([^/]+)\/status$/))) return { kind: "status", params: [decode(m[1])] };
  if ((m = path.match(/^\/tasks\/([^/]+)\/assignee$/))) return { kind: "assignee", params: [decode(m[1])] };
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
  if (/^\/claim-limit-requests\/?$/.test(path)) return { kind: "claimLimits" };
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
  const archivedFilter = archivedOf(parsed.searchParams.get("archived"));

  switch (route.kind) {
    case "projects":
      return listOf(db.projects.filter((entry) => matchesArchive(entry.archived_at, archivedFilter))) as T;
    case "project": {
      const project = db.projects.find((entry) => entry.slug === route.params[0]);
      if (!project) throw new ApiError("PROJECT_NOT_FOUND", 404, "Project no longer exists");
      if (verb === "PATCH") updateProject(project, payload);
      if (verb === "DELETE") {
        // Only an echoed slug is a purge; otherwise DELETE archives, as the API does.
        const confirmed = parsed.searchParams.get("confirm") === project.slug;
        if (confirmed) {
          db.projects = db.projects.filter((entry) => entry.slug !== project.slug);
          for (const [id, task] of Object.entries(db.tasks)) {
            if (task.project_slug === project.slug) delete db.tasks[id];
          }
          return undefined as T;
        }
        project.archived_at = new Date().toISOString();
      }
      return clone(project) as T;
    }
    case "projectArchive": {
      const project = db.projects.find((entry) => entry.slug === route.params[0]);
      if (!project) throw new ApiError("PROJECT_NOT_FOUND", 404, "Project no longer exists");
      const archived = typeof payload?.archived === "boolean" ? payload.archived : project.archived_at === null;
      project.archived_at = archived ? new Date().toISOString() : null;
      return clone(project) as T;
    }
    case "projectTasks": {
      const slug = route.params[0];
      if (verb === "POST") return createTask(slug, payload) as T;
      return listOf(
        Object.values(db.tasks).filter(
          (task) => task.project_slug === slug && matchesArchive(task.archived_at, archivedFilter),
        ),
      ) as T;
    }
    case "task": {
      const id = route.params[0];
      const detail = detailFor(id);
      if (!detail) throw new ApiError("TASK_NOT_FOUND", 404, `Task ${id} no longer exists`);
      if (verb === "PATCH") return updateTaskDetail(id, payload) as T;
      if (verb === "DELETE") {
        delete db.tasks[id];
        syncCounters();
        return undefined as T;
      }
      return clone(detail) as T;
    }
    case "status":
      return setStatus(
        route.params[0],
        String(payload?.status ?? "") as TaskStatus,
        String(payload?.note ?? ""),
      ) as T;
    case "assignee":
      return setAssignee(
        route.params[0],
        typeof payload?.assigned_agent_id === "string" ? payload.assigned_agent_id : null,
      ) as T;
    case "priority":
      return setPriority(route.params[0], Number(payload?.priority ?? 0)) as T;
    case "dod":
      return toggleDodItem(route.params[0], Number(route.params[1]), Boolean(payload?.completed)) as T;
    case "taskAction":
      return applyTaskAction(
        route.params[0],
        route.params[1],
        typeof payload?.archived === "boolean" ? payload.archived : null,
      ) as T;
    case "discoveries":
      return listOf(db.discoveries.filter((discovery) => discovery.status === "PENDING_APPROVAL")) as T;
    case "discoveryAction":
      return resolveDiscovery(route.params[0], route.params[1], payload) as T;
    case "claimLimits":
      return listOf([]) as T;
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
