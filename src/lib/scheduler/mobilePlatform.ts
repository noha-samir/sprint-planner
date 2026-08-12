import type { MobileAppFlag, Resource, Task } from "./types";

/** Default Mobile team members shown in Android/iOS assignee pickers. */
export const DEFAULT_MOBILE_RESOURCE_NAMES = ["Attar", "Hassan", "Mina"] as const;

/** Hassan is Mobile (Android), never FE. */
export const MOBILE_ONLY_RESOURCE_NAMES = ["Hassan"] as const;

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

/**
 * Ensure Mobile-only names are not typed as FE.
 * Does not auto-create Attar/Hassan/Mina — Resources should use exact Jira display names.
 */
export const ensureDefaultMobileResources = (resources: Resource[]): Resource[] => {
  const mobileOnly = new Set(MOBILE_ONLY_RESOURCE_NAMES.map((name) => name.toLowerCase()));
  return resources.filter((resource) => {
    if (resource.type !== "FE") return true;
    return !mobileOnly.has(resource.name.trim().toLowerCase());
  });
};
