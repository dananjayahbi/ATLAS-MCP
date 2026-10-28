"use client";

import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { DiscoveryDTO, ListResponse, ProjectDTO, TaskDetailDTO, TaskSummaryDTO } from "@/lib/types/api";
import type { ApiError } from "./client";
import { discoveriesApi } from "./discoveries";
import { qk } from "./keys";
import { projectsApi, type ProjectCreateBody, type ProjectPatch } from "./projects";
import { reviewsApi } from "./reviews";
import { tasksApi, type TaskCreateBody, type TaskUpdateBody } from "./tasks";
import type { TaskStatus } from "@/lib/types/enums";
import type { MatrixXAxis } from "./telemetry";
import { assetsApi } from "./assets";

/**
 * Doc 06 §3.5 — exactly two optimistic mutations (priority, DoD). Status/review
 * actions are always pessimistic: Doc 01 §8 guard reasons must be shown verbatim.
 */

function useInvalidate() {
  const queryClient = useQueryClient();
  return (keys: readonly (readonly unknown[])[]) => {
    for (const key of keys) void queryClient.invalidateQueries({ queryKey: key });
  };
}

export function useSetPriority(): UseMutationResult<
  TaskSummaryDTO,
  ApiError,
  { id: string; priority: number },
  { previous?: TaskDetailDTO }
> {
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation<TaskSummaryDTO, ApiError, { id: string; priority: number }, { previous?: TaskDetailDTO }>({
    mutationFn: ({ id, priority }) => tasksApi.setPriority(id, priority),
    onMutate: async ({ id, priority }) => {
      await queryClient.cancelQueries({ queryKey: qk.tasks.detail(id) });
      const previous = queryClient.getQueryData<TaskDetailDTO>(qk.tasks.detail(id));
      if (previous) queryClient.setQueryData<TaskDetailDTO>(qk.tasks.detail(id), { ...previous, priority });
      return { previous };
    },
    onError: (_error, variables, context) => {
      if (context?.previous) queryClient.setQueryData(qk.tasks.detail(variables.id), context.previous);
    },
    onSettled: (_data, _error, variables) => {
      invalidate([qk.tasks.detail(variables.id), qk.tasks.root, qk.telemetry.summary()]);
    },
  });
}

export function useToggleDod(): UseMutationResult<
  TaskDetailDTO,
  ApiError,
  { id: string; itemId: number; completed: boolean },
  { previous?: TaskDetailDTO }
> {
  const queryClient = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation<TaskDetailDTO, ApiError, { id: string; itemId: number; completed: boolean }, { previous?: TaskDetailDTO }>({
    mutationFn: ({ id, itemId, completed }) => tasksApi.toggleDod(id, itemId, completed),
    onMutate: async ({ id, itemId, completed }) => {
      await queryClient.cancelQueries({ queryKey: qk.tasks.detail(id) });
      const previous = queryClient.getQueryData<TaskDetailDTO>(qk.tasks.detail(id));
      if (previous) {
        const definition_of_done = previous.definition_of_done.map((item) =>
          item.id === itemId ? { ...item, completed, completed_at: completed ? new Date().toISOString() : null } : item,
        );
        const done = definition_of_done.filter((item) => item.completed).length;
        const percent = definition_of_done.length === 0 ? 0 : Math.round((done / definition_of_done.length) * 100);
        queryClient.setQueryData<TaskDetailDTO>(qk.tasks.detail(id), {
          ...previous,
          definition_of_done,
          dod_progress_percent: percent,
        });
      }
      return { previous };
    },
    onError: (_error, variables, context) => {
      if (context?.previous) queryClient.setQueryData(qk.tasks.detail(variables.id), context.previous);
    },
    onSettled: (_data, _error, variables) => {
      invalidate([qk.tasks.detail(variables.id), qk.tasks.root]);
    },
  });
}

export function useForceRelease(): UseMutationResult<TaskSummaryDTO, ApiError, { id: string }> {
  const invalidate = useInvalidate();
  return useMutation<TaskSummaryDTO, ApiError, { id: string }>({
    mutationFn: ({ id }) => tasksApi.forceRelease(id),
    onSettled: (_data, _error, variables) => {
      invalidate([qk.tasks.detail(variables.id), qk.tasks.root, qk.projects.root, qk.telemetry.summary()]);
    },
  });
}

export function useRequeueTask(): UseMutationResult<TaskSummaryDTO, ApiError, { id: string }> {
  const invalidate = useInvalidate();
  return useMutation<TaskSummaryDTO, ApiError, { id: string }>({
    mutationFn: ({ id }) => tasksApi.requeue(id),
    onSettled: (_data, _error, variables) => {
      invalidate([qk.tasks.detail(variables.id), qk.tasks.root, qk.projects.root]);
    },
  });
}

export function useApproveReview(): UseMutationResult<TaskSummaryDTO, ApiError, { id: string }> {
  const invalidate = useInvalidate();
  return useMutation<TaskSummaryDTO, ApiError, { id: string }>({
    mutationFn: ({ id }) => reviewsApi.approve(id),
    onSettled: (_data, _error, variables) => {
      invalidate([qk.reviews.root, qk.tasks.detail(variables.id), qk.tasks.root, qk.projects.root, qk.telemetry.summary()]);
    },
  });
}

export function useRejectReview(): UseMutationResult<TaskSummaryDTO, ApiError, { id: string; notes: string }> {
  const invalidate = useInvalidate();
  return useMutation<TaskSummaryDTO, ApiError, { id: string; notes: string }>({
    mutationFn: ({ id, notes }) => reviewsApi.reject(id, notes),
    onSettled: (_data, _error, variables) => {
      invalidate([qk.reviews.root, qk.tasks.detail(variables.id), qk.tasks.root, qk.projects.root]);
    },
  });
}

export function useApproveDiscovery(): UseMutationResult<
  TaskSummaryDTO,
  ApiError,
  { id: string; priority: number },
  { previousIds?: string[] }
> {
  const queryClient = useQueryClient();
  return useMutation<TaskSummaryDTO, ApiError, { id: string; priority: number }, { previousIds?: string[] }>({
    mutationFn: ({ id, priority }) => discoveriesApi.approve(id, { priority }),
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: qk.discoveries.root });
      // 5 s dispatch delay means the row is already gone from the list; drop it
      // from the cached page too so an invalidate cannot resurrect it.
      queryClient.setQueriesData<ListResponse<DiscoveryDTO>>({ queryKey: qk.discoveries.root }, (previous) =>
        previous ? { ...previous, items: previous.items.filter((row) => row.task_id !== id) } : previous,
      );
      return {};
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.discoveries.root });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.summary() });
    },
  });
}

export function useRejectDiscovery(): UseMutationResult<TaskSummaryDTO | null, ApiError, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<TaskSummaryDTO | null, ApiError, { id: string }>({
    mutationFn: async ({ id }) => {
      await discoveriesApi.reject(id, { reason: null });
      return null;
    },
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: qk.discoveries.root });
      queryClient.setQueriesData<ListResponse<DiscoveryDTO>>({ queryKey: qk.discoveries.root }, (previous) =>
        previous ? { ...previous, items: previous.items.filter((row) => row.task_id !== id) } : previous,
      );
      return {};
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.discoveries.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.summary() });
    },
  });
}

export function useCreateTask(): UseMutationResult<TaskSummaryDTO, ApiError, { slug: string; body: TaskCreateBody }> {
  const queryClient = useQueryClient();
  return useMutation<TaskSummaryDTO, ApiError, { slug: string; body: TaskCreateBody }>({
    mutationFn: ({ slug, body }) => tasksApi.create(slug, body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.summary() });
    },
  });
}

export function useCreateProject(): UseMutationResult<ProjectDTO, ApiError, ProjectCreateBody> {
  const queryClient = useQueryClient();
  return useMutation<ProjectDTO, ApiError, ProjectCreateBody>({
    mutationFn: (body) => projectsApi.create(body),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.summary() });
    },
  });
}

/**
 * Editing task metadata. Deliberately not optimistic: the server owns the DoD
 * rewrite (completion is carried across a label edit) and the diff it returns is
 * what the detail pane must show.
 */
export function useUpdateTask(): UseMutationResult<
  TaskDetailDTO,
  ApiError,
  { id: string; body: TaskUpdateBody }
> {
  const queryClient = useQueryClient();
  return useMutation<TaskDetailDTO, ApiError, { id: string; body: TaskUpdateBody }>({
    mutationFn: ({ id, body }) => tasksApi.update(id, body),
    onSuccess: (task) => {
      queryClient.setQueryData(qk.tasks.detail(task.id), task);
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
    },
  });
}

export function useDeleteTask(): UseMutationResult<void, ApiError, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { id: string }>({
    mutationFn: ({ id }) => tasksApi.remove(id),
    onSuccess: (_data, variables) => {
      queryClient.removeQueries({ queryKey: qk.tasks.detail(variables.id) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.assets.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.root });
    },
  });
}

/**
 * T12/T13 from the operator surface. Archive hides the task from every board
 * read; restore returns it to PENDING. Both are reversible, so neither item is
 * behind a destructive-only confirm.
 */
export function useArchiveTask(): UseMutationResult<
  TaskSummaryDTO,
  ApiError,
  { id: string; archived?: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation<TaskSummaryDTO, ApiError, { id: string; archived?: boolean }>({
    mutationFn: ({ id, archived = true }) => tasksApi.archive(id, archived),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.tasks.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.assets.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.root });
    },
  });
}

/** Manual status override; board drag-and-drop and the detail menu share this. */
export function useSetTaskStatus(): UseMutationResult<
  TaskDetailDTO,
  ApiError,
  { id: string; status: TaskStatus; note?: string }
> {
  const queryClient = useQueryClient();
  return useMutation<TaskDetailDTO, ApiError, { id: string; status: TaskStatus; note?: string }>({
    mutationFn: ({ id, status, note }) => tasksApi.setStatus(id, status, note ?? ""),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.tasks.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.root });
      void queryClient.invalidateQueries({ queryKey: qk.reviews.root });
    },
  });
}

export function useSetAssignee(): UseMutationResult<
  TaskDetailDTO,
  ApiError,
  { id: string; agentIdentifier: string | null }
> {
  const queryClient = useQueryClient();
  return useMutation<TaskDetailDTO, ApiError, { id: string; agentIdentifier: string | null }>({
    mutationFn: ({ id, agentIdentifier }) => tasksApi.setAssignee(id, agentIdentifier),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.tasks.detail(variables.id) });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
    },
  });
}

export function useUpdateProject(): UseMutationResult<
  ProjectDTO,
  ApiError,
  { slug: string; body: ProjectPatch }
> {
  const queryClient = useQueryClient();
  return useMutation<ProjectDTO, ApiError, { slug: string; body: ProjectPatch }>({
    mutationFn: ({ slug, body }) => projectsApi.update(slug, body),
    onSuccess: (project) => {
      queryClient.setQueryData(qk.projects.detail(project.slug), project);
    },
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.projects.detail(variables.slug) });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.root });
    },
  });
}

export function useArchiveProject(): UseMutationResult<
  ProjectDTO,
  ApiError,
  { slug: string; archived?: boolean }
> {
  const queryClient = useQueryClient();
  return useMutation<ProjectDTO, ApiError, { slug: string; archived?: boolean }>({
    mutationFn: ({ slug, archived = true }) => projectsApi.archive(slug, archived),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.projects.detail(variables.slug) });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.root });
    },
  });
}

/** Permanent delete, offered only on the archive page. */
export function usePurgeProject(): UseMutationResult<void, ApiError, { slug: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { slug: string }>({
    mutationFn: ({ slug }) => projectsApi.purge(slug),
    onSuccess: (_data, variables) => {
      queryClient.removeQueries({ queryKey: qk.projects.detail(variables.slug) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.projects.root });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
      void queryClient.invalidateQueries({ queryKey: qk.assets.root });
      void queryClient.invalidateQueries({ queryKey: qk.telemetry.root });
    },
  });
}

/** Removes one attachment; the task editor's image list owns the trigger. */
export function useDeleteAsset(): UseMutationResult<void, ApiError, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, ApiError, { id: string }>({
    mutationFn: ({ id }) => assetsApi.remove(id),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.assets.root });
      void queryClient.invalidateQueries({ queryKey: qk.tasks.root });
    },
  });
}

export function useMatrixAxisInvalidator(): (x: MatrixXAxis) => void {
  const queryClient = useQueryClient();
  return (x: MatrixXAxis) => {
    void queryClient.invalidateQueries({ queryKey: qk.telemetry.matrix(x) });
  };
}
