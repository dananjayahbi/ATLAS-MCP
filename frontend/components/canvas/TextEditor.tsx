"use client";

/**
 * Doc 07 §4.6 — the callout textarea. `Cmd/Ctrl+Enter` or blur commits,
 * `Esc` cancels, and the counter turns amber at 240 of 280 characters.
 */
import { useEffect, useRef, useState } from "react";
import { toScreenSpace } from "@/lib/canvas/geometry";
import { MAX_TEXT_CHARS, type Point, type ViewTransform } from "@/lib/canvas/types";

export interface TextEditorProps {
  anchor: Point;
  box: Point;
  view: ViewTransform;
  initialValue: string;
  maxChars?: number;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

export function TextEditor({
  anchor,
  box,
  view,
  initialValue,
  maxChars = MAX_TEXT_CHARS,
  onCommit,
  onCancel,
}: TextEditorProps) {
  const [value, setValue] = useState(initialValue);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const committedRef = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(initialValue.length, initialValue.length);
  }, [initialValue.length]);

  const screen = toScreenSpace(box, view);
  const anchorScreen = toScreenSpace(anchor, view);
  const near = Math.abs(value.length) >= 240;

  const commit = (text: string) => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(text);
  };

  return (
    <div
      className="absolute z-10"
      style={{ left: screen.x, top: screen.y }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        commit(value);
      }}
    >
      <textarea
        ref={ref}
        value={value}
        rows={3}
        maxLength={maxChars}
        aria-label="Callout text"
        placeholder="Describe the issue…"
        className="w-56 resize rounded-[var(--radius-hud)] border p-1.5 font-[family-name:var(--font-machine)] text-[length:var(--text-machine-md)] outline-none"
        style={{
          borderColor: "var(--color-flow)",
          background: "var(--color-raised)",
          color: "var(--text-primary)",
        }}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            committedRef.current = true;
            onCancel();
            return;
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            commit(value);
          }
        }}
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <span
          className="font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)]"
          style={{ color: near ? "var(--color-review)" : "var(--text-muted)" }}
        >
          {value.length}/{maxChars}
        </span>
        <span className="font-[family-name:var(--font-machine)] text-[length:var(--text-hud-micro)]" style={{ color: "var(--text-muted)" }}>
          leader → {Math.round(anchorScreen.x)}, {Math.round(anchorScreen.y)}
        </span>
      </div>
    </div>
  );
}

export default TextEditor;
