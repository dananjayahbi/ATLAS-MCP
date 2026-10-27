"use client";

import { useEffect, useState } from "react";

/**
 * Doc 06 §10.2 — patch/log assets render as **literal text**. They are fetched as
 * text (never parsed into markup) and capped at `1 MB` so a 5 MB patch cannot
 * freeze the tab; the viewer chunks beyond 20 000 lines with "show more".
 */

export const TEXT_ASSET_CAP_BYTES = 1_000_000;

export type AssetTextState = {
  text: string;
  loading: boolean;
  error: string | null;
  truncated: boolean;
};

export function useAssetText(url: string | null): AssetTextState {
  const [state, setState] = useState<AssetTextState>({ text: "", loading: false, error: null, truncated: false });

  useEffect(() => {
    if (!url) {
      setState({ text: "", loading: false, error: null, truncated: false });
      return;
    }
    const controller = new AbortController();
    setState({ text: "", loading: true, error: null, truncated: false });

    void fetch(url, { credentials: "same-origin", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Asset fetch failed (${response.status})`);
        const raw = await response.text();
        const truncated = raw.length > TEXT_ASSET_CAP_BYTES;
        setState({
          text: truncated ? raw.slice(0, TEXT_ASSET_CAP_BYTES) : raw,
          loading: false,
          error: null,
          truncated,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ text: "", loading: false, error: error instanceof Error ? error.message : "Asset fetch failed", truncated: false });
      });

    return () => controller.abort();
  }, [url]);

  return state;
}
