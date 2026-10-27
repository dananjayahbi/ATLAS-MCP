import type { ListResponse, ProjectDTO } from "@/lib/types/api";
import { apiGet, apiPatch, apiPost } from "./client";

/** Doc 01 §12 — `GET/POST /projects/`, `GET/PATCH /projects/{slug}/`. */

export type ProjectPatch = Partial<Pick<ProjectDTO, "name" | "local_repo_path" | "accent_color" | "global_rules_md">>;

export type ProjectCreateBody = {
  slug: string;
  name: string;
  local_repo_path: string;
  accent_color?: string;
  global_rules_md?: string;
};

export const projectsApi = {
  list: (signal?: AbortSignal) => apiGet<ListResponse<ProjectDTO>>("/projects/", { signal }),
  get: (slug: string, signal?: AbortSignal) => apiGet<ProjectDTO>(`/projects/${encodeURIComponent(slug)}/`, { signal }),
  create: (body: ProjectCreateBody) => apiPost<ProjectDTO>("/projects/", body),
  patch: (slug: string, body: ProjectPatch) =>
    apiPatch<ProjectDTO>(`/projects/${encodeURIComponent(slug)}/`, body),
};
