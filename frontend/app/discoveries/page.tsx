import { Suspense } from "react";
import { DiscoveryTriage } from "@/components/discoveries/discovery-triage";
import { Skeleton } from "@/components/ui/skeleton";

/** Doc 06 §2.1 — `/discoveries`. */
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="h-full min-h-0 overflow-auto">
      <Suspense fallback={<div className="p-4"><Skeleton lines={8} /></div>}>
        <DiscoveryTriage />
      </Suspense>
    </div>
  );
}
