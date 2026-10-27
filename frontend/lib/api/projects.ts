import type { ListResponse, ProjectDTO } from "@/lib/types/api";
import { apiGet, apiPatch } from "./client";

/** Doc 01 §12 — `GET /projects/`, `GET/PATCH /projects/{slug}/`. */

export type ProjectPatch = Partial<Pick<ProjectDTO, "name" | "local_repo_path" | "accent_color" | "global_rules_md">>;

export const projectsApi = {
  list: (signal?: AbortSignal) => apiGet<ListResponse<ProjectDTO>>("/projects/", { signal }),
  get: (slug: string, signal?: AbortSignal) => apiGet<ProjectDTO>(`/projects/${encodeURIComponent(slug)}/`, { signal }),
  patch: (slug: string, body: ProjectPatch) =>
    apiPatch<ProjectDTO>(`/projects/${encodeURIComponent(slug)}/`, body),
};
