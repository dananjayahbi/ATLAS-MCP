"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { errorMessage } from "@/lib/api/errors";
import { useCreateProject } from "@/lib/api/queries";
import type { ProjectCreateBody } from "@/lib/api/projects";
import { toast } from "@/hooks/use-toast";
import type { ProjectDTO } from "@/lib/types/api";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";

/**
 * Doc 04 §5.1 `POST /projects/` — scaffolds storage and the audit log. `slug` is
 * immutable after creation, so it is validated client-side against the same regex
 * the service enforces (`^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$`).
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const ACCENTS = ["#00F2FE", "#7CF7C4", "#FFB86B", "#FF6B9D", "#B48BFF", "#5EE7FF"] as const;

export type CreateProjectDialogProps = {
  open: boolean;
  onClose: () => void;
  onCreated?: (project: ProjectDTO) => void;
  /** Pre-fill from a filesystem path the operator pasted. */
  defaultRepoPath?: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function CreateProjectDialog({ open, onClose, onCreated, defaultRepoPath = "" }: CreateProjectDialogProps) {
  const router = useRouter();
  const create = useCreateProject();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [repoPath, setRepoPath] = useState(defaultRepoPath);
  const [accent, setAccent] = useState<string>(ACCENTS[0]);
  const [rules, setRules] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const slugError =
    attempted && !SLUG_RE.test(slug)
      ? "3–32 chars, lowercase letters/digits/hyphens, must start and end alphanumeric."
      : null;
  const nameError = attempted && name.trim().length === 0 ? "Name is required." : null;
  const pathError = attempted && repoPath.trim().length === 0 ? "Repository path is required." : null;

  const reset = () => {
    setName("");
    setSlug("");
    setSlugEdited(false);
    setRepoPath(defaultRepoPath);
    setAccent(ACCENTS[0]);
    setRules("");
    setError(null);
    setAttempted(false);
  };

  const submit = async () => {
    setAttempted(true);
    if (!SLUG_RE.test(slug) || name.trim().length === 0 || repoPath.trim().length === 0) return;
    const body: ProjectCreateBody = {
      slug,
      name: name.trim(),
      local_repo_path: repoPath.trim(),
      accent_color: HEX_RE.test(accent) ? accent : ACCENTS[0],
      ...(rules.trim() ? { global_rules_md: rules.trim() } : {}),
    };
    try {
      const project = await create.mutateAsync(body);
      toast({ level: "info", title: `Project created: ${project.name}` });
      onCreated?.(project);
      reset();
      onClose();
      router.push(`/projects/${project.slug}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      title="New project"
      description="Registers a workspace, scaffolds storage and seeds the audit log"
      onClose={() => {
        if (create.isPending) return;
        reset();
        onClose();
      }}
      busy={create.isPending}
      footer={
        <>
          <Button
            size="sm"
            onClick={() => {
              reset();
              onClose();
            }}
            disabled={create.isPending}
          >
            Cancel <Kbd size="xs">Esc</Kbd>
          </Button>
          <Button size="sm" variant="primary" onClick={() => void submit()} loading={create.isPending}>
            Create project
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}

        <TextField
          label="Name"
          required
          value={name}
          maxLength={120}
          error={nameError}
          autoFocus
          onChange={(event) => {
            const next = event.target.value;
            setName(next);
            if (!slugEdited) setSlug(slugify(next));
          }}
          placeholder="Alpha Backend"
        />

        <TextField
          label="Slug"
          required
          value={slug}
          maxLength={32}
          error={slugError}
          onChange={(event) => {
            setSlugEdited(true);
            setSlug(slugify(event.target.value));
          }}
          placeholder="alpha"
          hint="Immutable after creation; used in every URL and storage path."
        />

        <TextField
          label="Repository path"
          required
          value={repoPath}
          error={pathError}
          onChange={(event) => setRepoPath(event.target.value)}
          placeholder="E:\\dev\\alpha"
          hint="Absolute native path. Not verified to exist — archived machines still load."
        />

        <fieldset className="flex flex-col gap-1">
          <legend className="text-hud-micro uppercase tracking-[0.08em] text-secondary">Accent</legend>
          <div className="flex flex-wrap items-center gap-1">
            {ACCENTS.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Accent ${color}`}
                aria-pressed={accent === color}
                onClick={() => setAccent(color)}
                style={{ background: color }}
                className={
                  accent === color
                    ? "size-5 rounded-chip border-2 border-flow ring-2 ring-flow/40"
                    : "size-5 rounded-chip border border-grid hover:border-grid-strong"
                }
              />
            ))}
            <input
              type="text"
              value={accent}
              aria-label="Accent hex"
              onChange={(event) => setAccent(event.target.value)}
              className="w-24 rounded-chip border border-grid bg-canvas px-1.5 py-0.5 font-machine text-machine-sm text-primary"
            />
          </div>
        </fieldset>

        <TextAreaField
          label="Global rules (markdown)"
          rows={3}
          value={rules}
          onChange={(event) => setRules(event.target.value)}
          placeholder="Injected into every agent prompt for this project."
          hint="Optional"
        />
      </form>
    </Dialog>
  );
}
