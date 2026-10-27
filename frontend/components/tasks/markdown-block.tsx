import { useMemo } from "react";

/**
 * Doc 06 §10.3 / Doc 01 §14.4 — sanitised static rendering of `review_summary` and
 * task descriptions. No raw HTML, no `dangerouslySetInnerHTML`, no execution.
 */

export type MarkdownBlockProps = {
  source: string;
};

export function MarkdownBlock({ source }: MarkdownBlockProps) {
  const blocks = useMemo(() => source.split(/\n{2,}/).filter((block) => block.trim().length > 0), [source]);

  return (
    <div className="flex flex-col gap-2 text-hud-body text-secondary">
      {blocks.map((block, index) => {
        if (block.startsWith("```")) {
          const body = block.replace(/^```[a-z]*\n?/i, "").replace(/```$/, "");
          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-hud border border-grid bg-inset p-2 font-machine text-machine-sm text-machine"
            >
              <code>{body}</code>
            </pre>
          );
        }
        if (block.startsWith("#")) {
          return (
            <h3 key={index} className="text-hud-title text-primary">
              {block.replace(/^#+\s*/, "")}
            </h3>
          );
        }
        if (block.startsWith("- ") || block.startsWith("* ")) {
          return (
            <ul key={index} className="list-disc pl-4">
              {block.split("\n").map((line, i) => (
                <li key={i}>{line.replace(/^[-*]\s*/, "")}</li>
              ))}
            </ul>
          );
        }
        return <p key={index}>{block}</p>;
      })}
    </div>
  );
}
