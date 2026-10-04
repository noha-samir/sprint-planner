import type { MobileAppFlag, Task } from "./types";

export type MobileHoursTask = Pick<Task, "androidHours" | "iosHours" | "needsIos">;

/** iOS estimate used by schedule / Jira when the Needs iOS flag is on. */
export const effectiveIosHours = (task: MobileHoursTask): number =>
  task.needsIos ? Math.max(0, task.iosHours ?? 0) : 0;

/** Parent / weight mobile hours: Android + optional iOS. */
export const effectiveMobileHours = (task: MobileHoursTask): number =>
  Math.max(0, task.androidHours ?? 0) + effectiveIosHours(task);

export const normalizeMobileAppFlag = (value: unknown): MobileAppFlag => {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "star" || raw === "star app") return "star";
  if (raw === "hubs" || raw === "hubs app" || raw === "hub") return "hubs";
  return "none";
};

export const mobileAppLabel = (flag: MobileAppFlag | undefined): string | null => {
  if (flag === "star") return "Star app";
  if (flag === "hubs") return "Hubs app";
  return null;
};
