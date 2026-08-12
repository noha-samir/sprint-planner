"use client";

import { create } from "zustand";

export type JiraSyncMode = "push" | "pull";

export type JiraSyncPhase = "idle" | "syncing" | "saving";

export type JiraSyncTaskStatus = "pending" | "running" | "ok" | "failed";

export type JiraSyncTaskProgress = {
  taskId: string;
  storyName: string;
  status: JiraSyncTaskStatus;
  error?: string;
};

type JiraSyncState = {
  mode: JiraSyncMode | null;
  phase: JiraSyncPhase;
  active: boolean;
  total: number;
  completed: number;
  currentTaskId: string | null;
  currentStoryName: string | null;
  tasks: JiraSyncTaskProgress[];
  summary: string | null;
  summaryIsError: boolean;
  summaryIsWarning: boolean;
  start: (params: {
    mode: JiraSyncMode;
    tasks: Array<{ taskId: string; storyName: string }>;
  }) => void;
  markRunning: (taskId: string) => void;
  markDone: (params: { taskId: string; ok: boolean; error?: string }) => void;
  setPhase: (phase: JiraSyncPhase) => void;
  finish: (params: { summary: string; isError?: boolean; isWarning?: boolean }) => void;
  clearSummary: () => void;
};

const initialState = {
  mode: null as JiraSyncMode | null,
  phase: "idle" as JiraSyncPhase,
  active: false,
  total: 0,
  completed: 0,
  currentTaskId: null as string | null,
  currentStoryName: null as string | null,
  tasks: [] as JiraSyncTaskProgress[],
  summary: null as string | null,
  summaryIsError: false,
  summaryIsWarning: false,
};

export const useJiraSyncStore = create<JiraSyncState>((set, get) => ({
  ...initialState,
  start: ({ mode, tasks }) => {
    set({
      mode,
      phase: "syncing",
      active: true,
      total: tasks.length,
      completed: 0,
      currentTaskId: null,
      currentStoryName: null,
      tasks: tasks.map((task) => ({
        taskId: task.taskId,
        storyName: task.storyName,
        status: "pending",
      })),
      summary: null,
      summaryIsError: false,
      summaryIsWarning: false,
    });
  },
  markRunning: (taskId) => {
    const current = get().tasks.find((task) => task.taskId === taskId);
    set({
      phase: "syncing",
      currentTaskId: taskId,
      currentStoryName: current?.storyName ?? null,
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
    set({
      tasks,
      completed,
      currentTaskId: null,
      currentStoryName: null,
    });
  },
  setPhase: (phase) => set({ phase }),
  finish: ({ summary, isError = false, isWarning = false }) => {
    set({
      active: false,
      phase: "idle",
      currentTaskId: null,
      currentStoryName: null,
      summary,
      summaryIsError: isError,
      summaryIsWarning: !isError && isWarning,
    });
  },
  clearSummary: () => set({ summary: null, summaryIsError: false, summaryIsWarning: false }),
}));
