"use client";

/**
 * Doc 07 §1.3 / §12.2 — read-only banner. In `review` mode every mutating tool
 * and the export button are unavailable, so the reason must be visible.
 */
export interface ReviewBannerProps {
  message?: string;
}

export function ReviewBanner({ message }: ReviewBannerProps) {
  return (
    <div
      className="pointer-events-none absolute left-2 top-2 rounded-[var(--radius-chip)] border px-2 py-1 font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)] tracking-[0.08em]"
      role="note"
      style={{
        borderColor: "var(--color-review)",
        background: "var(--color-review-tint)",
        color: "var(--color-review)",
      }}
    >
      {message ?? "REVIEW MODE · READ ONLY"}
    </div>
  );
}

export default ReviewBanner;
