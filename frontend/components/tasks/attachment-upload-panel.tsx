"use client";

import { useState } from "react";
import { useAttachmentUpload } from "@/hooks/use-attachment-upload";
import { toast } from "@/hooks/use-toast";
import { AlertBanner } from "@/components/ui/alert-banner";
import { Button } from "@/components/ui/button";
import { UploadDropzone } from "@/components/tasks/upload-dropzone";

/**
 * Add screenshots to an existing task. Collapsed by default so the sidebar does
 * not permanently spend vertical space on a drop target.
 */

export type AttachmentUploadPanelProps = {
  taskId: string;
  onUploaded?: () => void;
  disabled?: boolean;
};

export function AttachmentUploadPanel({ taskId, onUploaded, disabled = false }: AttachmentUploadPanelProps) {
  const attachments = useAttachmentUpload();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [failed, setFailed] = useState<readonly string[]>([]);

  const upload = async () => {
    setFailed([]);
    const result = await attachments.upload(taskId, files, "INPUT_SCREENSHOT");
    if (result.done > 0) {
      toast({
        level: "info",
        title: `${result.done} image${result.done === 1 ? "" : "s"} attached`,
      });
      setFiles([]);
      onUploaded?.();
    }
    if (result.failed.length > 0) setFailed(result.failed);
  };

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="mt-1" onClick={() => setOpen(true)} disabled={disabled}>
        + Add screenshots
      </Button>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-1">
      <UploadDropzone
        files={files}
        onChange={setFiles}
        disabled={attachments.uploading}
        hint="Drop images for the agent to see"
      />
      {failed.length > 0 ? (
        <AlertBanner severity="warning">
          {failed.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </AlertBanner>
      ) : null}
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="primary"
          onClick={() => void upload()}
          loading={attachments.uploading}
          disabled={files.length === 0}
        >
          Upload {files.length > 0 ? `(${files.length})` : ""}
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setOpen(false);
            setFiles([]);
            setFailed([]);
          }}
          disabled={attachments.uploading}
        >
          Cancel
        </Button>
        {attachments.progress ? (
          <span className="font-machine text-hud-micro tabular-nums text-muted">
            {attachments.progress.done}/{attachments.progress.total}
          </span>
        ) : null}
      </div>
    </div>
  );
}
