import { Skeleton } from "@/components/ui/skeleton";

/** Doc 06 §16.5 — first-load shell skeleton (no shimmer). */
export default function Loading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4">
      <Skeleton lines={2} widths={["30%", "55%"]} />
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[264px_minmax(0,1fr)_320px]">
        <Skeleton lines={6} />
        <Skeleton lines={8} />
        <Skeleton lines={6} />
      </div>
    </div>
  );
}
