import type { CurScheduleSnapshot } from "./scheduleSnapshot";

export interface PlannerMeta {
  /** Estimated target release dates (frozen baseline), task id → ISO. */
  snapshot1ReleaseByTaskId: Record<string, string>;
  snapshot1TakenAt: string | null;
  estimatedBaselineCapturedAt: string | null;
  uatTrackingEnabled: boolean;
  /** Frozen current (Cur) schedule; updated only on Mark Progress Now. */
  curScheduleSnapshot: CurScheduleSnapshot | null;
  curScheduleTakenAt: string | null;
  /** Task ids touched since last Mark Progress Now; highlighted until remark again. */
  taskIdsNeedRemark: string[];
  /** Dashboard row order; refreshed only on Mark Progress Now. */
  dashboardTaskOrder: string[];
  rulesVersion: number;
  replanAsOf: string | null;
}

export const PLANNER_META_RULES_VERSION = 2;

export const defaultPlannerMeta = (): PlannerMeta => ({
  snapshot1ReleaseByTaskId: {},
  snapshot1TakenAt: null,
  estimatedBaselineCapturedAt: null,
  uatTrackingEnabled: false,
  curScheduleSnapshot: null,
  curScheduleTakenAt: null,
  taskIdsNeedRemark: [],
  dashboardTaskOrder: [],
  rulesVersion: PLANNER_META_RULES_VERSION,
  replanAsOf: null,
});

export function mergePlannerMetaPatch(persisted: Partial<PlannerMeta> | null | undefined): PlannerMeta {
  const d = defaultPlannerMeta();
  if (!persisted || typeof persisted !== "object") return d;
  return {
    snapshot1ReleaseByTaskId:
      persisted.snapshot1ReleaseByTaskId && typeof persisted.snapshot1ReleaseByTaskId === "object"
        ? persisted.snapshot1ReleaseByTaskId
        : d.snapshot1ReleaseByTaskId,
    snapshot1TakenAt:
      typeof persisted.snapshot1TakenAt === "string" ? persisted.snapshot1TakenAt : d.snapshot1TakenAt,
    estimatedBaselineCapturedAt:
      typeof persisted.estimatedBaselineCapturedAt === "string"
        ? persisted.estimatedBaselineCapturedAt
        : d.estimatedBaselineCapturedAt,
    uatTrackingEnabled:
      typeof persisted.uatTrackingEnabled === "boolean" ? persisted.uatTrackingEnabled : d.uatTrackingEnabled,
    curScheduleSnapshot:
      persisted.curScheduleSnapshot &&
      typeof persisted.curScheduleSnapshot === "object" &&
      typeof persisted.curScheduleSnapshot.sprintEndDate === "string" &&
      Array.isArray(persisted.curScheduleSnapshot.tasks)
        ? persisted.curScheduleSnapshot
        : d.curScheduleSnapshot,
    curScheduleTakenAt:
      typeof persisted.curScheduleTakenAt === "string" ? persisted.curScheduleTakenAt : d.curScheduleTakenAt,
    taskIdsNeedRemark: Array.isArray(persisted.taskIdsNeedRemark)
      ? persisted.taskIdsNeedRemark.filter((id): id is string => typeof id === "string")
      : d.taskIdsNeedRemark,
    dashboardTaskOrder: Array.isArray(persisted.dashboardTaskOrder)
      ? persisted.dashboardTaskOrder.filter((id): id is string => typeof id === "string")
      : persisted.curScheduleSnapshot?.tasks?.map((row) => row.id) ?? d.dashboardTaskOrder,
    rulesVersion:
      typeof persisted.rulesVersion === "number" && Number.isFinite(persisted.rulesVersion)
        ? persisted.rulesVersion
        : d.rulesVersion,
    replanAsOf: typeof persisted.replanAsOf === "string" ? persisted.replanAsOf : d.replanAsOf,
  };
}
