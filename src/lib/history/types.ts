import type { Config, Resource, Task } from "@/lib/scheduler/types";

export interface SprintHistorySummary {
  totalTasks: number;
  carryOverTasks: number;
  totalResources: number;
}

/** Lightweight list row — no snapshot blobs. */
export interface SprintHistoryListItem {
  id: string;
  archivedAt: string;
  squadId: string;
  sprintStartDate: string;
  planningSunday: string;
  summary: SprintHistorySummary;
}

export interface SprintHistoryEntry extends SprintHistoryListItem {
  tasks: Task[];
  resources: Resource[];
  config: Config;
}
