"use client";

import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type {
  DiscoveryDTO,
  ListResponse,
  PriorityMatrixResponse,
  ProjectDTO,
  TaskDetailDTO,
  TaskSummaryDTO,
  TelemetrySummaryDTO,
} from "@/lib/types/api";
import { discoveriesApi } from "./discoveries";
import { filterKey, qk, type BoardFilter } from "./keys";
import { projectsApi } from "./projects";
import { reviewsApi } from "./reviews";
import { tasksApi } from "./tasks";
import { telemetryApi, type MatrixXAxis } from "./telemetry";

/** Doc 06 §3.4 — refetch policy per resource, declared once. */

export function useProjects(): UseQueryResult<ListResponse<ProjectDTO>> {
  return useQuery({
    queryKey: qk.projects.list(),
    queryFn: ({ signal }) => projectsApi.list(signal),
    staleTime: 10_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useProject(slug: string): UseQueryResult<ProjectDTO> {
  return useQuery({
    queryKey: qk.projects.detail(slug),
    queryFn: ({ signal }) => projectsApi.get(slug, signal),
    staleTime: 10_000,
    refetchInterval: 30_000,
    enabled: slug.length > 0,
  });
}

export function useTasks(
  slug: string,
  filter: Partial<BoardFilter> = {},
  options: { kind?: "board" | "list" } = {},
): UseQueryResult<ListResponse<TaskSummaryDTO>> {
  const fk = filterKey(filter);
  const kind = options.kind ?? "board";
  return useQuery({
    queryKey: kind === "board" ? qk.tasks.board(slug, fk) : qk.tasks.list(slug, fk),
    queryFn: ({ signal }) =>
      tasksApi.list(
        slug,
        {
          status: filter.status ?? null,
          q: filter.q ?? null,
          agent: filter.agent ?? null,
          blocked: filter.blocked ?? null,
          discovered: filter.discovered ?? null,
          priorityMin: filter.priorityMin ?? null,
        },
        signal,
      ),
    staleTime: 15_000,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
    enabled: slug.length > 0,
  });
}

export function useTask(id: string): UseQueryResult<TaskDetailDTO> {
  return useQuery({
    queryKey: qk.tasks.detail(id),
    queryFn: ({ signal }) => tasksApi.get(id, signal),
    staleTime: 5_000,
    refetchInterval: 20_000,
    enabled: id.length > 0,
  });
}

export function useDiscoveries(): UseQueryResult<ListResponse<DiscoveryDTO>> {
  return useQuery({
    queryKey: qk.discoveries.list(),
    queryFn: ({ signal }) => discoveriesApi.list(signal),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useReviews(): UseQueryResult<ListResponse<TaskDetailDTO>> {
  return useQuery({
    queryKey: qk.reviews.list(),
    queryFn: ({ signal }) => reviewsApi.list(signal),
    staleTime: 10_000,
    refetchInterval: 30_000,
  });
}

export function useTelemetry(): UseQueryResult<TelemetrySummaryDTO> {
  return useQuery({
    queryKey: qk.telemetry.summary(),
    queryFn: ({ signal }) => telemetryApi.summary(signal),
    staleTime: 0,
    refetchInterval: 15_000,
    refetchOnWindowFocus: false,
  });
}

export function usePriorityMatrix(
  x: MatrixXAxis,
  options: { enabled?: boolean } = {},
): UseQueryResult<PriorityMatrixResponse> {
  return useQuery({
    queryKey: qk.telemetry.matrix(x),
    queryFn: ({ signal }) => telemetryApi.matrix(x, signal),
    staleTime: 5_000,
    refetchInterval: 25_000,
    refetchOnWindowFocus: false,
    placeholderData: keepPreviousData,
    enabled: options.enabled ?? true,
  });
}

/** Mutations live in ./mutations; re-exported here so call sites import one module. */
export * from "./mutations";

