"use client";

import { useCallback, useState } from "react";
import { assetsApi } from "@/lib/api/assets";
import type { AssetKind } from "@/lib/types/enums";

/**
 * Uploads queued files to an existing task, one at a time.
 *
 * Sequential on purpose: the `upload` throttle family is 20 req/min (Doc 04
 * §3.4), so firing five parallel POSTs from one operator action would spend a
 * quarter of the budget in a single burst and hand back a 429 the UI would have
 * to explain.
 */

export type UploadProgress = {
  done: number;
  total: number;
  failed: readonly string[];
};

export type AttachmentUpload = {
  uploading: boolean;
  progress: UploadProgress | null;
  upload: (taskId: string, files: readonly File[], kind?: AssetKind) => Promise<UploadProgress>;
};

export function useAttachmentUpload(): AttachmentUpload {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  const upload = useCallback(
    async (taskId: string, files: readonly File[], kind: AssetKind = "INPUT_SCREENSHOT") => {
      if (files.length === 0) {
        const empty: UploadProgress = { done: 0, total: 0, failed: [] };
        setProgress(empty);
        return empty;
      }
      setUploading(true);
      const failed: string[] = [];
      let done = 0;
      setProgress({ done, total: files.length, failed });

      for (const file of files) {
        try {
          await assetsApi.upload(taskId, kind, file);
          done += 1;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "upload failed";
          failed.push(`${file.name}: ${reason}`);
        }
        setProgress({ done, total: files.length, failed: [...failed] });
      }

      setUploading(false);
      return { done, total: files.length, failed };
    },
    [],
  );

  return { uploading, progress, upload };
}
