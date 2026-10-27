"use client";

import { create } from "zustand";

/**
 * Doc 06 §3.6 — toast store. Zustand is already a dependency (Doc 01 §3), so the
 * host needs no provider and toasts can be raised from any client module.
 */

export type ToastLevel = "info" | "warn" | "error";

export type Toast = {
  id: string;
  level: ToastLevel;
  title: string;
  body?: string;
  kbd?: string;
  actionLabel?: string;
  onAction?: () => void;
  sticky: boolean;
  createdAt: number;
};

export type ToastInput = Omit<Toast, "id" | "createdAt" | "sticky"> & { sticky?: boolean };

type ToastStore = {
  toasts: Toast[];
  push: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

export const TOAST_TTL_MS = 6000;
let counter = 0;

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  push: (input) => {
    counter += 1;
    const id = `toast-${counter}`;
    const toast: Toast = { ...input, id, sticky: input.sticky ?? false, createdAt: Date.now() };
    set((state) => ({ toasts: [...state.toasts, toast].slice(-4) }));
    return id;
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Imperative helper for non-component call sites (mutation `onError`). */
export function toast(input: ToastInput): string {
  return useToastStore.getState().push(input);
}

export function useToasts(): Toast[] {
  return useToastStore((state) => state.toasts);
}
