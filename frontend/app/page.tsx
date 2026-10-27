import { CommandCenterOverview } from "@/components/board/command-center";

/** Doc 06 §2.1 — command center root (server component; the shell is client). */
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="h-full min-h-0 overflow-auto">
      <CommandCenterOverview />
    </div>
  );
}
