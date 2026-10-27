"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_BOARD_FILTER, type BoardFilter } from "@/lib/api/keys";
import { TASK_STATUS_ORDER } from "@/lib/format/tone";
import type { TaskStatus } from "@/lib/types/enums";

/**
 * Doc 06 §8.3 / §5.4 — board filters round-trip through the URL so a filtered
 * board is shareable and survives a reload. Search is debounced here so typing
 * does not push a history entry per keystroke.
 */

const SEARCH_DEBOUNCE_MS = 250;

function parseStatuses(raw: string | null): TaskStatus[] {
  if (!raw) return [];
  const valid = new Set<string>(TASK_STATUS_ORDER);
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is TaskStatus => valid.has(value));
}

function parseSort(raw: string | null): BoardFilter["sort"] {
  return raw === "created" || raw === "updated" || raw === "priority" ? raw : "priority";
}

export type UseBoardFilter = {
  filter: BoardFilter;
  setQuery: (value: string) => void;
  setStatuses: (value: TaskStatus[]) => void;
  setAgent: (value: string | null) => void;
  setBlockedOnly: (value: boolean) => void;
  setPriorityMin: (value: number | null) => void;
  setSort: (value: string) => void;
  reset: () => void;
};

export function useBoardFilter(): UseBoardFilter {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQueryState] = useState(urlQuery);
  const timer = useRef<number | undefined>(undefined);

  // Keep the input in sync when the URL changes from a link or Back.
  useEffect(() => setQueryState(urlQuery), [urlQuery]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const write = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => write({ q: value.trim() || null }), SEARCH_DEBOUNCE_MS);
    },
    [write],
  );

  const filter = useMemo<BoardFilter>(
    () => ({
      ...DEFAULT_BOARD_FILTER,
      q: urlQuery || null,
      status: parseStatuses(searchParams.get("status")),
      agent: searchParams.get("agent"),
      blocked: searchParams.get("blocked") === "1" ? true : null,
      discovered: searchParams.get("discovered") === "1" ? true : null,
      priorityMin: searchParams.get("pmin") ? Number(searchParams.get("pmin")) : null,
      sort: parseSort(searchParams.get("sort")),
      order: searchParams.get("order") === "asc" ? "asc" : "desc",
    }),
    [searchParams, urlQuery],
  );

  const setStatuses = useCallback(
    (value: TaskStatus[]) => write({ status: value.length > 0 ? value.join(",") : null }),
    [write],
  );
  const setAgent = useCallback((value: string | null) => write({ agent: value }), [write]);
  const setBlockedOnly = useCallback((value: boolean) => write({ blocked: value ? "1" : null }), [write]);
  const setPriorityMin = useCallback(
    (value: number | null) => write({ pmin: value === null ? null : String(value) }),
    [write],
  );
  const setSort = useCallback(
    (value: string) => write({ sort: value === "priority" ? null : value }),
    [write],
  );
  const reset = useCallback(
    () =>
      write({
        q: null,
        status: null,
        agent: null,
        blocked: null,
        discovered: null,
        pmin: null,
        sort: null,
      }),
    [write],
  );

  return { filter, setQuery, setStatuses, setAgent, setBlockedOnly, setPriorityMin, setSort, reset };
}
