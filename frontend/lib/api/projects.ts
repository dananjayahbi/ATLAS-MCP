import type { ListResponse, ProjectDTO } from "@/lib/types/api";
import { apiDelete, apiGet, apiPatch, apiPost } from "./client";

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
  /** `archived: true` reads the archive list; omitted reads the live projects. */
  list: (signal?: AbortSignal, options: { archived?: boolean | null } = {}) => {
    const archived = options.archived;
    const qs = archived === true ? "?archived=1" : archived === false ? "?archived=0" : "";
    return apiGet<ListResponse<ProjectDTO>>(`/projects/${qs}`, { signal });
  },
  get: (slug: string, signal?: AbortSignal) => apiGet<ProjectDTO>(`/projects/${encodeURIComponent(slug)}/`, { signal }),
  create: (body: ProjectCreateBody) => apiPost<ProjectDTO>("/projects/", body),
  update: (slug: string, body: ProjectPatch) =>
    apiPatch<ProjectDTO>(`/projects/${encodeURIComponent(slug)}/`, body),
  /** Doc 04 §5.1 — archive keeps everything readable and is reversible. */
  archive: (slug: string, archived = true) =>
    apiPost<ProjectDTO>(`/projects/${encodeURIComponent(slug)}/archive/`, { archived }),
  /** Same effect as `archive`, kept because Doc 04 documents the DELETE verb. */
  remove: (slug: string) => apiDelete<ProjectDTO>(`/projects/${encodeURIComponent(slug)}/`),
  /**
   * Permanent delete from the archive page. The slug is echoed as `confirm`,
   * which is what distinguishes a purge from the documented archive DELETE.
   */
  purge: (slug: string) =>
    apiDelete<void>(`/projects/${encodeURIComponent(slug)}/?confirm=${encodeURIComponent(slug)}`),
};
