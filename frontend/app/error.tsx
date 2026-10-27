"use client";

import { cn } from "@/lib/format/cn";
import { Button } from "@/components/ui/button";

/** Doc 06 §16.5 — route error boundary body. */

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className={cn("flex max-w-lg flex-col items-center gap-2 rounded-hud border border-critical/40 bg-critical-tint/40 p-6 text-center")}>
        <span aria-hidden className="text-hud-heading text-critical-hot">
          ✖
        </span>
        <h1 className="text-hud-title text-primary">The HUD could not render this view</h1>
        <p className="text-hud-body text-secondary">{error.message || "An unexpected error occurred."}</p>
        {error.digest ? <p className="font-machine text-hud-micro text-muted">digest {error.digest}</p> : null}
        <Button variant="primary" size="md" onClick={reset} className="mt-2">
          Retry
        </Button>
      </div>
    </div>
  );
}
