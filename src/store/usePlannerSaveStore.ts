"use client";

import { create } from "zustand";

export type PlannerSaveStatus = "idle" | "saving" | "saved" | "error";

type PlannerSaveState = {
  status: PlannerSaveStatus;
  message: string | null;
  markSaving: () => void;
  markSaved: () => void;
  markError: (message?: string) => void;
  clear: () => void;
};

let savedTimer: ReturnType<typeof setTimeout> | undefined;

export const usePlannerSaveStore = create<PlannerSaveState>((set) => ({
  status: "idle",
  message: null,
  markSaving: () => {
    if (savedTimer) {
      clearTimeout(savedTimer);
      savedTimer = undefined;
    }
    set({ status: "saving", message: "Saving…" });
  },
  markSaved: () => {
    if (savedTimer) {
      clearTimeout(savedTimer);
    }
    set({ status: "saved", message: "Saved" });
    savedTimer = setTimeout(() => {
      set({ status: "idle", message: null });
      savedTimer = undefined;
    }, 1800);
  },
  markError: (message = "Save failed") => {
    if (savedTimer) {
      clearTimeout(savedTimer);
      savedTimer = undefined;
    }
    set({ status: "error", message });
  },
  clear: () => {
    if (savedTimer) {
      clearTimeout(savedTimer);
      savedTimer = undefined;
    }
    set({ status: "idle", message: null });
  },
}));
