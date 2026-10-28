"use client";

import { useEffect, useState } from "react";
import { errorMessage } from "@/lib/api/errors";
import { useArchiveProject, usePurgeProject, useUpdateProject } from "@/lib/api/queries";
import { toast } from "@/hooks/use-toast";
import type { ProjectDTO } from "@/lib/types/api";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { Kbd } from "@/components/ui/kbd";

/**
 * Edit a project and archive/restore or delete it.
 *
 * `slug` is immutable (Doc 01 §6.3) so it renders as read-only text rather than
 * a disabled input — a disabled field reads as "temporarily unavailable".
 * Archiving is reversible (Doc 04 §5.1), which is why it lives here instead of
 * behind a destructive-only confirm. Permanent delete requires the operator to
 * retype the slug: it is the one action no undo covers.
 */

const HEX_RE = /^#[0-9A-Fa-f]{6}$/;
const ACCENTS = ["#00F2FE", "#7CF7C4", "#FFB86B", "#FF6B9D", "#B48BFF", "#5EE7FF"] as const;

export type EditProjectDialogProps = {
  open: boolean;
  project: ProjectDTO;
  onClose: () => void;
  onSaved?: (project: ProjectDTO) => void;
  onArchived?: (project: ProjectDTO) => void;
  /** Fires after a permanent delete, so the caller can drop the row. */
  onDeleted?: (slug: string) => void;
};

export function EditProjectDialog({
  open,
  project,
  onClose,
  onSaved,
  onArchived,
  onDeleted,
}: EditProjectDialogProps) {
  const update = useUpdateProject();
  const archive = useArchiveProject();
  const purge = usePurgeProject();

  const [name, setName] = useState(project.name);
  const [repoPath, setRepoPath] = useState(project.local_repo_path);
  const [accent, setAccent] = useState(project.accent_color);
  const [rules, setRules] = useState(project.global_rules_md);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(project.name);
    setRepoPath(project.local_repo_path);
    setAccent(project.accent_color);
    setRules(project.global_rules_md);
    setError(null);
    setConfirmArchive(false);
    setConfirmDelete(false);
    setConfirmSlug("");
  }, [open, project]);

  const archived = project.archived_at !== null;
  const busy = update.isPending || archive.isPending || purge.isPending;
  const dirty =
    name.trim() !== project.name ||
    repoPath.trim() !== project.local_repo_path ||
    accent !== project.accent_color ||
    rules !== project.global_rules_md;

  const submit = async () => {
    if (!name.trim() || !repoPath.trim()) {
      setError("Name and repository path are required.");
      return;
    }
    const body: Record<string, string> = {};
    if (name.trim() !== project.name) body.name = name.trim();
    if (repoPath.trim() !== project.local_repo_path) body.local_repo_path = repoPath.trim();
    if (HEX_RE.test(accent) && accent !== project.accent_color) body.accent_color = accent;
    if (rules !== project.global_rules_md) body.global_rules_md = rules;

    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    try {
      const saved = await update.mutateAsync({ slug: project.slug, body });
      toast({ level: "info", title: "Project updated" });
      onSaved?.(saved);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const toggleArchive = async () => {
    try {
      const saved = await archive.mutateAsync({ slug: project.slug, archived: !archived });
      toast({
        level: archived ? "info" : "warn",
        title: archived ? `Project restored: ${saved.name}` : `Project archived: ${saved.name}`,
      });
      onArchived?.(saved);
      setConfirmArchive(false);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const doPurge = async () => {
    try {
      await purge.mutateAsync({ slug: project.slug });
      toast({ level: "warn", title: `Project deleted: ${project.name}` });
      onDeleted?.(project.slug);
      setConfirmDelete(false);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <Dialog
      open={open}
      title="Project settings"
      description={`${project.slug} · slug is immutable`}
      onClose={() => {
        if (busy) return;
        onClose();
      }}
      busy={busy}
      footer={
        <>
          <Button
            size="sm"
            variant={archived ? "outline" : "ghost"}
            onClick={() => {
              setConfirmArchive(true);
              setConfirmDelete(false);
            }}
            disabled={busy || confirmArchive}
            title={archived ? "Put this project back on the board" : "Hide this project from the board"}
          >
            {archived ? "Restore" : "Archive"}
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={() => {
              setConfirmDelete(true);
              setConfirmArchive(false);
            }}
            disabled={busy || confirmDelete}
            title="Delete this project and its storage permanently"
          >
            Delete…
          </Button>
          <span className="min-w-0 flex-1" />
          <Button size="sm" onClick={onClose} disabled={busy}>
            Cancel <Kbd size="xs">Esc</Kbd>
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={() => void submit()}
            loading={update.isPending}
            disabled={!dirty || confirmArchive || confirmDelete}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {error ? <AlertBanner severity="warning">{error}</AlertBanner> : null}
        {archived ? (
          <AlertBanner severity="info">
            Archived projects stay readable, but agents skip them when claiming work. Restore to put it back in
            the queue.
          </AlertBanner>
        ) : null}

        {confirmArchive ? (
          <div
            className={
              archived
                ? "rounded-hud border border-flow/40 bg-flow-tint p-2"
                : "rounded-hud border border-critical/50 bg-critical-tint p-2"
            }
          >
            <p className="text-hud-body text-primary">
              {archived ? "Restore" : "Archive"} <span className="font-machine">{project.name}</span>?
            </p>
            <p className="mt-1 text-hud-micro text-secondary">
              {archived
                ? "Queued tasks become claimable again."
                : `${project.counters.pending + project.counters.in_progress} active task(s) will stop being claimable until you restore it. Nothing is deleted.`}
            </p>
            <div className="mt-1 flex items-center gap-1">
              <Button size="sm" onClick={() => setConfirmArchive(false)} disabled={archive.isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant={archived ? "primary" : "danger"}
                onClick={() => void toggleArchive()}
                loading={archive.isPending}
              >
                {archived ? "Restore" : "Archive"}
              </Button>
            </div>
          </div>
        ) : null}

        {confirmDelete ? (
          <div className="rounded-hud border border-critical/50 bg-critical-tint p-2">
            <p className="text-hud-body text-primary">
              Delete <span className="font-machine">{project.name}</span> permanently?
            </p>
            <p className="mt-1 text-hud-micro text-secondary">
              Every task, asset and the project folder are removed. This cannot be undone — archive instead if
              you may want the evidence back. Type <span className="font-machine text-primary">{project.slug}</span>{" "}
              to confirm.
            </p>
            <input
              type="text"
              value={confirmSlug}
              onChange={(event) => setConfirmSlug(event.target.value)}
              aria-label="Type the project slug to confirm deletion"
              placeholder={project.slug}
              className="mt-1 w-full rounded-chip border border-grid bg-canvas px-1.5 py-0.5 font-machine text-machine-sm text-primary placeholder:text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-flow"
            />
            <div className="mt-1 flex items-center gap-1">
              <Button
                size="sm"
                onClick={() => {
                  setConfirmDelete(false);
                  setConfirmSlug("");
                }}
                disabled={purge.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => void doPurge()}
                loading={purge.isPending}
                disabled={confirmSlug.trim() !== project.slug}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex items-baseline gap-2 rounded-chip border border-grid bg-inset px-2 py-1">
          <span className="text-hud-micro uppercase tracking-[0.08em] text-secondary">Slug</span>
          <span className="font-machine text-machine-sm text-primary">{project.slug}</span>
          <span className="min-w-0 flex-1" />
          <span className="font-machine text-hud-micro text-disabled">{project.id.slice(0, 8)}</span>
        </div>

        <TextField
          label="Name"
          required
          value={name}
          maxLength={120}
          disabled={confirmArchive || confirmDelete}
          onChange={(event) => setName(event.target.value)}
          data-autofocus
        />

        <TextField
          label="Repository path"
          required
          value={repoPath}
          disabled={confirmArchive || confirmDelete}
          onChange={(event) => setRepoPath(event.target.value)}
          hint="Absolute native path. Not verified to exist."
        />

        <fieldset className="flex flex-col gap-1" disabled={confirmArchive || confirmDelete}>
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
          rows={4}
          value={rules}
          disabled={confirmArchive || confirmDelete}
          onChange={(event) => setRules(event.target.value)}
          hint="Injected into every agent prompt for this project."
        />
      </div>
    </Dialog>
  );
}
