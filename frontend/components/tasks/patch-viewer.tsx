"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/format/cn";
import { useAssetText } from "@/hooks/use-asset-text";
import type { AssetDTO } from "@/lib/types/enums";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Doc 06 §10.2 — the patch/log viewer. `<pre><code>` with text content only:
 * never `dangerouslySetInnerHTML`, never a diff parser that rebuilds files.
 */

export type PatchViewerProps = {
  asset: AssetDTO | null;
  chunkLines?: number;
  className?: string;
};

const CHUNK = 20_000;

type Tone = "add" | "del" | "hunk" | "meta" | "plain";

function toneOf(line: string): Tone {
  if (line.startsWith("+++") || line.startsWith("---")) return "meta";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+")) return "add";
  if (line.startsWith("-")) return "del";
  if (line.startsWith("\\")) return "meta";
  return "plain";
}

const TONE_CLASS: Record<Tone, string> = {
  add: "text-success-soft",
  del: "text-critical-hot",
  hunk: "text-review-hot",
  meta: "text-disabled",
  plain: "text-secondary",
};

export function PatchViewer({ asset, chunkLines = CHUNK, className }: PatchViewerProps) {
  const [visibleChunks, setVisibleChunks] = useState(1);
  const { text, loading, error, truncated } = useAssetText(asset?.url ?? null);

  const lines = useMemo(() => (text ? text.split(/\r?\n/) : []), [text]);
  const limit = chunkLines * visibleChunks;
  const shown = lines.slice(0, limit);

  if (!asset) {
    return <EmptyState inline title="No patch asset" hint="The agent did not attach an OUTPUT_PATCH." />;
  }
  if (loading) return <Skeleton lines={6} />;
  if (error) return <EmptyState inline title="Patch unavailable" hint={error} />;

  return (
    <div className={cn("flex min-h-0 flex-col gap-1", className)}>
      <pre
        aria-label={`${asset.filename} — literal patch text, never executed`}
        tabIndex={0}
        className="max-h-[52vh] min-h-0 overflow-auto rounded-hud border border-grid bg-inset p-2 font-machine text-machine-sm leading-relaxed"
      >
        <code>
          {shown.map((line, index) => (
            <span key={index} className={cn("block whitespace-pre-wrap break-words", TONE_CLASS[toneOf(line)])}>
              {line.length > 0 ? line : " "}
            </span>
          ))}
        </code>
      </pre>
      <div className="flex flex-wrap items-center gap-2 font-machine text-hud-micro text-disabled">
        <span className="tabular-nums">
          {Math.min(shown.length, lines.length)} / {lines.length} lines
        </span>
        {truncated ? <span className="text-review-hot">truncated at 1 MB client cap</span> : null}
        <span className="min-w-0 flex-1" />
        {lines.length > shown.length ? (
          <Button size="sm" onClick={() => setVisibleChunks((value) => value + 1)}>
            Show more
          </Button>
        ) : null}
        <a href={asset.url.replace(/\/content$/, "/download")} className="hover:text-primary" download>
          Download
        </a>
      </div>
    </div>
  );
}
