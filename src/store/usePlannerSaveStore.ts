"use client";

import { create } from "zustand";

export type PlannerSaveStatus = "idle" | "saving" | "saved" | "error" | "conflict";

type PlannerSaveState = {
  status: PlannerSaveStatus;
  message: string | null;
  markSaving: () => void;
  markSaved: () => void;
  markError: (message?: string) => void;
  /** Someone else saved the planner; saves keep failing until the user reloads the saved copy. */
  markConflict: () => void;
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
  markConflict: () => {
    if (savedTimer) {
      clearTimeout(savedTimer);
      savedTimer = undefined;
    }
    set({ status: "conflict", message: "Planner changed elsewhere" });
  },
  clear: () => {
    if (savedTimer) {
      clearTimeout(savedTimer);
      savedTimer = undefined;
    }
    set({ status: "idle", message: null });
  },
}));
