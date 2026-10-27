import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/format/cn";

/** Doc 05 §8.6 — mono, tabular, truncation that always carries a `title`. */

export type MachineTextProps = {
  as?: ElementType;
  truncate?: "start" | "middle" | "end" | false;
  copyable?: boolean;
  dim?: boolean;
  title?: string;
  className?: string;
  children?: ReactNode;
};

export function MachineText({
  as: Tag = "span",
  truncate = "end",
  copyable = false,
  dim = false,
  title,
  className,
  children,
}: MachineTextProps) {
  const text = typeof children === "string" ? children : undefined;
  const resolvedTitle = title ?? text;
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <Tag
        title={resolvedTitle}
        dir={truncate === "start" ? "rtl" : undefined}
        className={cn(
          "font-machine text-machine-md tabular-nums",
          dim ? "text-muted" : "text-machine",
          truncate !== false && "block min-w-0 truncate",
          Tag === "code" && "rounded-chip bg-inset px-1 text-machine-sm",
          className,
        )}
      >
        {children}
      </Tag>
      {copyable && text ? <CopyButton value={text} /> : null}
    </span>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <button
      type="button"
      aria-label={`Copy ${value}`}
      title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
      }}
      className="shrink-0 rounded-chip border border-transparent px-1 font-machine text-hud-micro text-muted transition-colors duration-100 hover:border-grid hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
    >
      ⧉
    </button>
  );
}
