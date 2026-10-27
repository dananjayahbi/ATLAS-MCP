"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { capacityOf, useShellStore, type SplitLayout } from "./use-shell-store";

/**
 * Doc 06 §5.4 — the URL is authoritative for layout and pane assignments; Zustand
 * holds a mirror for zero-latency paint and writes through with `router.replace`.
 */

export type ShellParams = {
  layout: SplitLayout;
  projects: (string | null)[];
  tasks: (string | null)[];
};

const MINUS = "-";

function splitList(value: string | null, capacity: number): (string | null)[] {
  const parts = (value ?? "").split(",").map((part) => (part && part !== MINUS ? decodeURIComponent(part) : null));
  const out = parts.slice(0, capacity);
  while (out.length < capacity) out.push(null);
  return out;
}

function parseLayout(value: string | null): SplitLayout {
  return value === "1x1" || value === "1x2" || value === "2x2" || value === "2x3" ? value : "1x2";
}

export type UseUrlState = {
  params: ShellParams;
  setLayout: (layout: SplitLayout) => void;
  assign: (slot: number, projectSlug: string | null, taskId?: string | null) => void;
  setParam: (key: string, value: string | null) => void;
};

export function useUrlState(): UseUrlState {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const searchParams = useSearchParams();
  const storeLayout = useShellStore((state) => state.layout);
  const storeSetLayout = useShellStore((state) => state.setLayout);
  const assignLocal = useShellStore((state) => state.assign);

  const params = useMemo<ShellParams>(() => {
    const layout = parseLayout(searchParams.get("layout"));
    const capacity = capacityOf(layout);
    return {
      layout,
      projects: splitList(searchParams.get("p"), capacity),
      tasks: splitList(searchParams.get("t"), capacity),
    };
  }, [searchParams]);

  const write = useCallback(
    (next: URLSearchParams) => {
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams.toString());
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      write(next);
    },
    [searchParams, write],
  );

  const setLayout = useCallback(
    (layout: SplitLayout) => {
      storeSetLayout(layout);
      const next = new URLSearchParams(searchParams.toString());
      const capacity = capacityOf(layout);
      next.set("layout", layout);
      const projects = splitList(next.get("p"), capacity).join(",");
      const tasks = splitList(next.get("t"), capacity).join(",");
      if (projects.replace(/[,-]/g, "") === "") next.delete("p");
      else next.set("p", projects);
      if (tasks.replace(/[,-]/g, "") === "") next.delete("t");
      else next.set("t", tasks);
      write(next);
    },
    [searchParams, storeSetLayout, write],
  );

  const assign = useCallback(
    (slot: number, projectSlug: string | null, taskId: string | null = null) => {
      const layout = parseLayout(searchParams.get("layout"));
      const capacity = capacityOf(layout);
      const projects = splitList(searchParams.get("p"), capacity);
      const tasks = splitList(searchParams.get("t"), capacity);
      projects[slot] = projectSlug;
      tasks[slot] = taskId;
      assignLocal(slot, projectSlug, taskId);
      const next = new URLSearchParams(searchParams.toString());
      next.set("layout", layout);
      const p = projects.map((value) => value ?? MINUS).join(",");
      const t = tasks.map((value) => value ?? MINUS).join(",");
      next.set("p", p);
      next.set("t", t);
      write(next);
    },
    [assignLocal, searchParams, write],
  );

  return { params: { ...params, layout: searchParams.has("layout") ? params.layout : storeLayout }, setLayout, assign, setParam };
}
