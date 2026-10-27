"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";
import { Toaster } from "@/components/ui/toaster";
import { CheatSheet } from "@/components/hud/cheat-sheet";
import { HotkeyRoot } from "@/components/hud/hotkey-root";

/** Doc 06 §2.1 — the single client boundary: QueryClient, hotkey root, toast portal. */

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && !error.retryable) return false;
          return failureCount < 2;
        },
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false },
    },
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <HotkeyRoot />
      {children}
      <CheatSheet />
      <Toaster />
    </QueryClientProvider>
  );
}
