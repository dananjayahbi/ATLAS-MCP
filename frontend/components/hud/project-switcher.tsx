"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/format/cn";

/** Doc 06 §5.2 — project switcher in the command bar. Data-driven accent dot only. */

export type SwitcherProject = { slug: string; name: string; accent_color: string };

export type ProjectSwitcherProps = {
  projects: SwitcherProject[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  className?: string;
};

export function ProjectSwitcher({ projects, activeSlug, onSelect, className }: ProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const active = projects.find((project) => project.slug === activeSlug) ?? null;

  return (
    <div className={cn("relative shrink-0", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-4 items-center gap-1.5 rounded-chip border border-grid bg-inset px-1.5 font-ui text-hud-micro uppercase tracking-[0.08em] text-secondary hover:border-grid-strong hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
      >
        <span
          aria-hidden
          className="size-1.5 rounded-full"
          style={{ background: active?.accent_color ?? "var(--text-muted)" }}
        />
        <span className="font-machine">{active ? active.slug.toUpperCase() : "SELECT PROJECT"}</span>
        <span aria-hidden className="text-disabled">
          ▾
        </span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close project switcher"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <ul
            id={listId}
            role="listbox"
            aria-label="Projects"
            className="absolute top-6 right-0 z-50 w-56 rounded-hud border border-grid-strong bg-raised p-1 shadow-hud-panel"
          >
            {projects.length === 0 ? (
              <li className="px-2 py-1 text-hud-body text-muted">No projects registered</li>
            ) : null}
            {projects.map((project) => {
              const selected = project.slug === activeSlug;
              return (
                <li key={project.slug} role="option" aria-selected={selected}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(project.slug);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-chip px-1.5 py-1 text-left text-hud-body hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow",
                      selected ? "text-flow" : "text-secondary",
                    )}
                  >
                    <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: project.accent_color }} />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    <span className="shrink-0 font-machine text-hud-micro text-muted">{project.slug}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}
