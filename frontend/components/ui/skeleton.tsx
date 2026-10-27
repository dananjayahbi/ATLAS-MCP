import { cn } from "@/lib/format/cn";

/** Doc 05 §8.10/§8.9 — skeleton (no shimmer) and empty state. */

export type SkeletonProps = {
  lines?: number;
  widths?: string[];
  dense?: boolean;
  className?: string;
};

export function Skeleton({ lines = 3, widths = ["100%", "92%", "64%"], dense = false, className }: SkeletonProps) {
  return (
    <div aria-busy="true" aria-live="polite" className={cn("flex flex-col gap-2", dense ? "py-1" : "py-2", className)}>
      <span className="sr-only">Loading</span>
      {Array.from({ length: lines }).map((_, index) => (
        <span
          key={index}
          aria-hidden
          style={{ width: widths[index % widths.length] }}
          className={cn("block rounded-chip bg-raised/60", dense ? "h-3" : "h-4")}
        />
      ))}
    </div>
  );
}

/** Doc 05 alias — one line of the same primitive. */
export const SkeletonLine = Skeleton;
