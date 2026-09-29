"use client";

import { create } from "zustand";
import type { BulkNotificationSummary } from "@/lib/integrations/jira/bulkNotificationFormat";

export type JiraSyncMode = "push" | "pull";

export type JiraSyncPhase = "idle" | "syncing" | "saving";

export type JiraSyncTaskStatus = "pending" | "running" | "ok" | "failed";

export type JiraSyncTaskProgress = {
  taskId: string;
  storyName: string;
  status: JiraSyncTaskStatus;
  error?: string;
};

/** Work done before stories start syncing (e.g. searching Jira), shown on the loading screen. */
export type JiraSyncPreparing = {
  mode: JiraSyncMode;
  title: string;
  detail: string;
};

type JiraSyncState = {
  mode: JiraSyncMode | null;
  phase: JiraSyncPhase;
  active: boolean;
  preparing: JiraSyncPreparing | null;
  /** When the loading screen appeared (ms epoch); null when nothing is running. */
  busySince: number | null;
  total: number;
  completed: number;
  tasks: JiraSyncTaskProgress[];
  summary: string | null;
  summaryModel: BulkNotificationSummary | null;
  summaryIsError: boolean;
  summaryIsWarning: boolean;
  setPreparing: (preparing: JiraSyncPreparing | null) => void;
  start: (params: {
    mode: JiraSyncMode;
    tasks: Array<{ taskId: string; storyName: string }>;
  }) => void;
  markRunning: (taskId: string) => void;
  markDone: (params: { taskId: string; ok: boolean; error?: string }) => void;
  setPhase: (phase: JiraSyncPhase) => void;
  finish: (params: {
    summary: string;
    summaryModel?: BulkNotificationSummary | null;
    isError?: boolean;
    isWarning?: boolean;
  }) => void;
  clearSummary: () => void;
};

const initialState = {
  mode: null as JiraSyncMode | null,
  phase: "idle" as JiraSyncPhase,
  active: false,
  preparing: null as JiraSyncPreparing | null,
  busySince: null as number | null,
  total: 0,
  completed: 0,
  tasks: [] as JiraSyncTaskProgress[],
  summary: null as string | null,
  summaryModel: null as BulkNotificationSummary | null,
  summaryIsError: false,
  summaryIsWarning: false,
};

export const useJiraSyncStore = create<JiraSyncState>((set, get) => ({
  ...initialState,
  setPreparing: (preparing) => {
    const { active, busySince } = get();
    set({
      preparing,
      busySince: preparing || active ? (busySince ?? Date.now()) : null,
    });
  },
  start: ({ mode, tasks }) => {
    set({
      mode,
      phase: "syncing",
      active: true,
      preparing: null,
      busySince: get().busySince ?? Date.now(),
      total: tasks.length,
      completed: 0,
      tasks: tasks.map((task) => ({
        taskId: task.taskId,
        storyName: task.storyName,
        status: "pending",
      })),
      summary: null,
      summaryModel: null,
      summaryIsError: false,
      summaryIsWarning: false,
    });
  },
  markRunning: (taskId) => {
    set({
      phase: "syncing",
      tasks: get().tasks.map((task) =>
        task.taskId === taskId ? { ...task, status: "running", error: undefined } : task,
      ),
    });
  },
  markDone: ({ taskId, ok, error }) => {
    const tasks = get().tasks.map((task) =>
      task.taskId === taskId
        ? { ...task, status: ok ? ("ok" as const) : ("failed" as const), error }
        : task,
    );
    const completed = tasks.filter((task) => task.status === "ok" || task.status === "failed").length;
    set({ tasks, completed });
  },
  setPhase: (phase) => set({ phase }),
  finish: ({ summary, summaryModel = null, isError = false, isWarning = false }) => {
    set({
      active: false,
      phase: "idle",
      preparing: null,
      busySince: null,
      summary,
      summaryModel,
      summaryIsError: isError,
      summaryIsWarning: !isError && isWarning,
    });
  },
  clearSummary: () =>
    set({ summary: null, summaryModel: null, summaryIsError: false, summaryIsWarning: false }),
}));
