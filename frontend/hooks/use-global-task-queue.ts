"use client";

import { useQuery } from "@tanstack/react-query";
import type { TaskStatus } from "@/lib/types/enums";
import type { TaskSummaryDTO } from "@/lib/types/api";
import { qk } from "@/lib/api/keys";
import { tasksApi } from "@/lib/api/tasks";

/**
 * Cross-project reads for the command center (Doc 06 §5.1).
 *
 * `/projects/{slug}/tasks/` is project-scoped (Doc 04 §2.1), so the queue fans
 * out one list per project and merges. N is a handful of workspaces, each call
 * stays on a documented route, and a project that fails simply contributes
 * nothing instead of blanking the whole queue.
 */

export type GlobalQueueOptions = {
  statuses?: readonly TaskStatus[];
  limitPerProject?: number;
  enabled?: boolean;
};

export function useGlobalTaskQueue(
  slugs: readonly string[],
  options: GlobalQueueOptions = {},
): { tasks: TaskSummaryDTO[]; isLoading: boolean; isFetching: boolean; refetch: () => void } {
  const { statuses, limitPerProject = 50, enabled = true } = options;
  const key = `${slugs.join(",")}|${(statuses ?? []).join(",")}|${limitPerProject}`;

  const query = useQuery({
    queryKey: qk.tasks.global(key),
    queryFn: async ({ signal }) => {
      const pages = await Promise.all(
        slugs.map((slug) =>
          tasksApi
            .list(
              slug,
              {
                status: statuses ? [...statuses] : null,
                limit: limitPerProject,
                sort: "priority",
                order: "desc",
              },
              signal,
            )
            .then((page) => page.items)
            .catch(() => [] as TaskSummaryDTO[]),
        ),
      );
      // Highest priority first across projects; priority is the only field the
      // board is contractually sorted by (Doc 04 §5.2).
      return pages.flat().sort((a, b) => b.priority - a.priority || b.age_hours - a.age_hours);
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
    enabled: enabled && slugs.length > 0,
  });

  return {
    tasks: query.data ?? [],
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    refetch: () => void query.refetch(),
  };
}
