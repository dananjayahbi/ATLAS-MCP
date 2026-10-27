"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { useProjects } from "@/lib/api/queries";
import { useLastProject } from "@/hooks/use-last-project";

/**
 * Resolves the project scope the SSE channel should subscribe to (Doc 09 §11.1).
 *
 * Priority: the slug in the URL → the last project the operator opened → the
 * first registered project. Returning a stable slug is what lets `AppShell` mount
 * exactly **one** `EventSource` for the whole app; mounting the hook per page
 * would open a second connection on every navigation.
 */
export function useActiveProjectSlug(): string | null {
  const pathname = usePathname() ?? "";
  const projects = useProjects();

  const fromPath = useMemo(() => {
    const match = /\/projects\/([^/?#]+)/.exec(pathname);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }, [pathname]);

  const first = projects.data?.items?.[0]?.slug ?? null;
  const last = useLastProject(fromPath ?? first);

  return fromPath ?? last ?? first;
}
