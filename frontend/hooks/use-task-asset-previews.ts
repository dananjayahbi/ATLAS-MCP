"use client";

import { useQuery } from "@tanstack/react-query";
import { assetsApi, type TaskAssetPreview } from "@/lib/api/assets";
import { qk } from "@/lib/api/keys";

/**
 * Board thumbnail index for one project. One request per project (Doc 06 §3.4
 * budget), keyed by slug so switching workspaces does not refetch a warm graph.
 */

export type AssetPreviewIndex = Map<string, TaskAssetPreview>;

export function useTaskAssetPreviews(slug: string) {
  const query = useQuery({
    queryKey: qk.assets.byProject(slug),
    queryFn: ({ signal }) => assetsApi.previews(slug, signal),
    staleTime: 20_000,
    refetchInterval: 60_000,
    enabled: slug.length > 0,
  });

  const index: AssetPreviewIndex = new Map(
    (query.data?.items ?? []).map((entry) => [entry.task_id, entry]),
  );
  return { index, isLoading: query.isLoading, isFetching: query.isFetching, refetch: query.refetch };
}
