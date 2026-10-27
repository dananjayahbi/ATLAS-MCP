import { Suspense } from "react";
import { ReviewGate } from "@/components/tasks/review-gate";
import { Skeleton } from "@/components/ui/skeleton";

/** Doc 06 §2.1 — `/reviews` (added because the Review Gate needs a shareable URL). */
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <div className="h-full min-h-0 overflow-auto">
      <Suspense fallback={<div className="p-4"><Skeleton lines={8} /></div>}>
        <ReviewGate />
      </Suspense>
    </div>
  );
}
