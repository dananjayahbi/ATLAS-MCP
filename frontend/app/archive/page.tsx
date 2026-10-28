import { ArchiveOverview } from "@/components/board/archive-overview";

/** `/archive` — archived projects and tasks, with restore. */
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="h-full min-h-0 overflow-auto">
      <ArchiveOverview />
    </div>
  );
}
