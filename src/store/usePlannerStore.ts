"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { parseCalendarDate, todayDateKey, totalWorkingHoursForSprint } from "@/lib/scheduler/calendar";
import { schedule } from "@/lib/scheduler/engine";
import {
  computeSprintUtilizationFromTasks,
  computeUtilization,
  type ResourceUtilization,
  type SprintTaskUtilization,
} from "@/lib/scheduler/utilization";
import { appendTaskIdsToDashboardOrder, buildDashboardTaskOrder } from "@/lib/planner/dashboardTaskOrder";
import {
  defaultPlannerMeta,
  mergePlannerMetaPatch,
  PLANNER_META_RULES_VERSION,
  type PlannerMeta,
} from "@/lib/planner/plannerMeta";
import {
  applyPlannerMetaForTaskPatch,
  clearTasksNeedRemark,
  filterTaskPatchToActualChanges,
  markTaskIdsNeedRemark,
  removeTaskIdFromNeedRemark,
  TASK_PATCH_KEYS_IGNORED_FOR_REMARK,
} from "@/lib/planner/pendingMarkProgress";
import {
  deserializeScheduleResult,
  mergeFrozenScheduleWithFresh,
  serializeScheduleResult,
} from "@/lib/planner/scheduleSnapshot";
import { archiveSprintSnapshot } from "@/lib/history/client";
import type { BulkPasteRow } from "@/lib/planner/bulkTaskPaste";
import { coerceAssigneeNamesToRoster } from "@/lib/planner/resourceIdentity";
import {
  collapseTasksByStoryLink,
  filterDraftsSkippingExistingStoryLinks,
} from "@/lib/planner/storyLinkIdentity";
import {
  activeSprintTasks,
  buildCarryOverTasks,
  compactPrioritiesAfterRelease,
  enforceUniquePoPriorities,
} from "./taskRules";
import { ensureDefaultMobileResources, normalizeMobileAppFlag } from "@/lib/scheduler/mobilePlatform";
import {
  SQUAD_CAPACITY_HOURS_MAX,
  type Config,
  type Resource,
  type ScheduleResult,
  type Task,
  type TaskWorkflowStatus,
} from "@/lib/scheduler/types";
import {
  DEFAULT_JIRA_STORY_STATUSES,
  DEFAULT_TASK_STATUS,
  isReleasedTaskStatus,
  normalizeTaskStatus,
} from "@/lib/scheduler/taskStatus";
import {
  mergeIncomingTasksWithCurrent,
  normalizeReplanStep,
  shouldSkipIncomingPlannerSnapshot,
} from "./replanMerge";

export { activeSprintTasks } from "./taskRules";

interface PlannerState {
  hasHydrated: boolean;
  activeSquadId: string | null;
  timelineStartDate: string | null;
  /** ISO time of last local edit; used to avoid server hydrate overwriting unsynced pulls. */
  lastLocalMutationAt: string | null;
  /** Last known server updatedAt for optimistic concurrency on save. */
  lastServerUpdatedAt: string | null;
  /**
   * Bumped on Start New Sprint so the dashboard can reset filters
   * (carry-overs become current-sprint rows).
   */
  sprintBoardGeneration: number;
  tasks: Task[];
  resources: Resource[];
  config: Config;
  plannerMeta: PlannerMeta;
  result: ScheduleResult;
  remainingUtilization: ResourceUtilization[];
  sprintUtilization: SprintTaskUtilization;
  addTask: () => string;
  addTasks: (drafts: BulkPasteRow[]) => string[];
  updateTask: (id: string, patch: Partial<Task>) => void;
  /** Apply the same patch to many tasks in one reschedule / save. */
  updateTasks: (ids: string[], patch: Partial<Task>) => void;
  removeTask: (id: string) => void;
  addResource: (type: Resource["type"]) => void;
  /** Append a Jira-validated roster person (exact display name). */
  addMappedResource: (resource: Resource) => void;
  updateResource: (index: number, resource: Resource) => void;
  removeResource: (index: number) => void;
  /** Rename resources to Jira display names and clear nicknames (after assignee sync). */
  applyJiraResourceRenames: (renames: Array<{ from: string; to: string }>) => void;
  clearResourceNicknames: () => void;
  updateConfig: (patch: Partial<Config>) => void;
  startNewSprint: (options?: { sprintStartDate?: string }) => Promise<void>;
  /** Replace the live board with an archived History snapshot (tasks / resources / config). */
  restoreSprintFromHistory: (snapshot: {
    tasks: Task[];
    resources: Resource[];
    config: Config;
  }) => void;
  hydrateFromServer: (data: {
    tasks: Task[];
    resources: Resource[];
    config: Config;
    plannerMeta?: PlannerMeta;
    timelineStartDate?: string | null;
    serverUpdatedAt?: string | null;
  }) => void;
  markProgressNow: () => void;
  markPlannerSyncedToServer: (serverUpdatedAt?: string | null) => void;
  setHasHydrated: (value: boolean) => void;
  setActiveSquadId: (squadId: string | null) => void;
  setTimelineStartDate: (timelineStartDate: string | null) => void;
  hydrateEmptySquad: () => void;
}

const createDefaultConfig = (): Config => {
  const today = todayDateKey();
  return {
    sprintStartDate: today,
    planningSunday: today,
    extraHolidays: [],
    hoursPerDay: 6,
    sprintWorkingDays: 10,
    theme: "ocean",
    releaseStrategy: "earliestStoriesFirst",
    workdayStartHour: 11,
    replanAsOf: null,
  };
};

const emptyTask = (): Task => ({
  id: crypto.randomUUID(),
  storyName: "",
  storyLink: "",
  tags: [],
  taskNotes: "",
  poPriority: null,
  feDevs: [],
  feHours: 0,
  beDevs: [],
  beHours: 0,
  androidDevs: [],
  androidHours: 0,
  iosDevs: [],
  iosHours: 0,
  needsIos: false,
  mobileApp: "none",
  moStartDate: null,
  integrationHours: 0,
  integrationFlags: {
    needsDevOps: false,
    needsCdc: false,
    needsDbSync: false,
    needsOtherSquad: false,
    needsThirdParty: false,
  },
  qcs: [],
  qcHours: 0,
  productManagers: [],
  bufferHours: 0,
  replanFromStep: null,
  carryToNextSprint: false,
  releaseGroup: null,
  status: DEFAULT_TASK_STATUS,
});

type LegacyTaskFields = {
  moDevs?: string[];
  moHours?: number;
  jira?: {
    subtasks?: Array<{ role?: string }>;
  };
};

const normalizeJiraSubtaskRole = (role: unknown): "fe" | "be" | "android" | "ios" => {
  if (role === "be") return "be";
  if (role === "ios") return "ios";
  if (role === "android" || role === "mo") return "android";
  return "fe";
};

/** Fields that do not change schedule math — skip full reschedule on patch. */
const COSMETIC_TASK_PATCH_KEYS = new Set<keyof Task>(TASK_PATCH_KEYS_IGNORED_FOR_REMARK);
const patchRequiresReschedule = (patch: Partial<Task>): boolean =>
  Object.keys(patch).some((key) => !COSMETIC_TASK_PATCH_KEYS.has(key as keyof Task));

const derive = (tasks: Task[], resources: Resource[], config: Config) => {
  const result = schedule(activeSprintTasks(tasks), resources, config);
  const remainingUtilization = computeUtilization(resources, result, config);
  const sprintUtilization = computeSprintUtilizationFromTasks(tasks, resources, config);
  return { result, remainingUtilization, sprintUtilization };
};

type BuildPlannerOptions = {
  /** When true, recomputes Cur (UAT/Production) schedule. Defaults to false while UAT tracking is on. */
  rescheduleCur?: boolean;
  /**
   * Keep every row even when story links collide (History restore).
   * Default collapses same-link duplicates on normal builds.
   */
  preserveDuplicateStoryLinks?: boolean;
};

const captureCurScheduleMeta = (meta: PlannerMeta, result: ScheduleResult, takenAt: string): PlannerMeta => ({
  ...meta,
  curScheduleSnapshot: serializeScheduleResult(result),
  curScheduleTakenAt: takenAt,
});

const hasReleaseDates = (result: ScheduleResult) => result.tasks.some((task) => task.releaseDate != null);

/**
 * When estimated baseline exists, UAT tracking turns on — but Mark Progress freeze
 * only works with a Cur snapshot. Seed it from the current schedule so later edits
 * light Mark Progress instead of live-recalculating.
 */
const seedCurScheduleFreeze = (meta: PlannerMeta, result: ScheduleResult): PlannerMeta => {
  let next = mergePlannerMetaPatch(meta);
  if (!next.uatTrackingEnabled && next.snapshot1TakenAt != null) {
    next = { ...next, uatTrackingEnabled: true };
  }
  if (next.uatTrackingEnabled && !next.curScheduleSnapshot && hasReleaseDates(result)) {
    const takenAt = next.replanAsOf ?? next.curScheduleTakenAt ?? new Date().toISOString();
    next = captureCurScheduleMeta(next, result, takenAt);
  }
  return next;
};

const normalizeTask = (task: Task): Task => {
  const legacy = task as Task & LegacyTaskFields;
  const androidDevs = Array.isArray(task.androidDevs)
    ? task.androidDevs
    : Array.isArray(legacy.moDevs)
      ? legacy.moDevs
      : [];
  const androidHours = Number.isFinite(task.androidHours)
    ? Math.max(0, task.androidHours)
    : Number.isFinite(legacy.moHours)
      ? Math.max(0, legacy.moHours as number)
      : 0;
  const needsIos = Boolean(task.needsIos);
  const iosDevs = Array.isArray(task.iosDevs) ? task.iosDevs : [];
  const iosHours = Number.isFinite(task.iosHours) ? Math.max(0, task.iosHours) : 0;

  return {
    ...task,
    storyName: task.storyName ?? "",
    storyLink: task.storyLink ?? "",
    tags: Array.isArray(task.tags) ? task.tags : [],
    taskNotes: task.taskNotes ?? "",
    poPriority:
      task.poPriority === null || task.poPriority === undefined
        ? null
        : Math.max(1, Math.trunc(task.poPriority) || 1),
    feDevs: Array.isArray(task.feDevs) ? task.feDevs : [],
    feHours: Number.isFinite(task.feHours) ? Math.max(0, task.feHours) : 0,
    beDevs: Array.isArray(task.beDevs) ? task.beDevs : [],
    beHours: Number.isFinite(task.beHours) ? Math.max(0, task.beHours) : 0,
    androidDevs,
    androidHours,
    iosDevs: needsIos ? iosDevs : [],
    iosHours: needsIos ? iosHours : 0,
    needsIos,
    mobileApp: normalizeMobileAppFlag(task.mobileApp),
    moStartDate: (() => {
      const raw = typeof task.moStartDate === "string" ? task.moStartDate.trim() : "";
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    })(),
    integrationHours: Number.isFinite(task.integrationHours) ? Math.max(0, task.integrationHours) : 0,
    integrationFlags: {
      needsDevOps: task.integrationFlags?.needsDevOps ?? false,
      needsCdc: task.integrationFlags?.needsCdc ?? false,
      needsDbSync: task.integrationFlags?.needsDbSync ?? false,
      needsOtherSquad: task.integrationFlags?.needsOtherSquad ?? false,
      needsThirdParty: task.integrationFlags?.needsThirdParty ?? false,
    },
    qcs: Array.isArray(task.qcs) ? task.qcs : [],
    qcHours: Number.isFinite(task.qcHours) ? Math.max(0, task.qcHours) : 0,
    productManagers: Array.isArray(task.productManagers) ? task.productManagers : [],
    bufferHours: Number.isFinite(task.bufferHours) ? Math.max(0, task.bufferHours ?? 0) : 0,
    replanFromStep: normalizeReplanStep(task.replanFromStep),
    status: normalizeTaskStatus(task.status),
    carryToNextSprint: task.carryToNextSprint ?? false,
    releaseGroup:
      typeof task.releaseGroup === "string" && task.releaseGroup.trim() ? task.releaseGroup.trim() : null,
    jira: task.jira
      ? {
          parentIssueKey: task.jira.parentIssueKey ?? "",
          lastPushedAt: task.jira.lastPushedAt ?? null,
          lastPulledAt: task.jira.lastPulledAt ?? null,
          subtasks: Array.isArray(task.jira.subtasks)
            ? task.jira.subtasks.map((subtask) => ({
                key: subtask.key ?? "",
                role: normalizeJiraSubtaskRole(subtask.role),
                assigneeName: subtask.assigneeName ?? "",
                hours: Number.isFinite(subtask.hours) ? subtask.hours : 0,
              }))
            : [],
        }
      : undefined,
  };
};

const normalizeResourceCapacities = (resources: Resource[]): Resource[] =>
  resources.map((resource) => {
    const normalizedLegacyCapacity =
      resource.capacityHours === undefined
        ? undefined
        : Math.max(0, Math.min(SQUAD_CAPACITY_HOURS_MAX, resource.capacityHours));
    const ownershipMode = resource.ownershipMode ?? "shared";
    const ourSquadHours =
      resource.ourSquadHours === undefined
        ? normalizedLegacyCapacity
        : Math.max(0, Math.min(SQUAD_CAPACITY_HOURS_MAX, resource.ourSquadHours));
    return {
      ...resource,
      nickname: undefined,
      ownershipMode,
      ourSquadHours,
      capacityHours: normalizedLegacyCapacity,
    };
  });

const normalizeConfig = (config: Config): Config => ({
  ...config,
  workdayStartHour: config.workdayStartHour ?? 11,
  replanAsOf: config.replanAsOf ?? null,
});

const pruneRemovedTaskIdsFromPlannerMeta = (meta: PlannerMeta, removedIds: string[]): PlannerMeta => {
  if (removedIds.length === 0) {
    return meta;
  }
  const drop = new Set(removedIds);
  let next = meta;
  for (const id of removedIds) {
    next = removeTaskIdFromNeedRemark(next, id);
  }
  const dashboardTaskOrder = next.dashboardTaskOrder.filter((id) => !drop.has(id));
  if (dashboardTaskOrder.length === next.dashboardTaskOrder.length) {
    return next;
  }
  return { ...next, dashboardTaskOrder };
};

const buildState = (
  tasks: Task[],
  resources: Resource[],
  config: Config,
  options?: Pick<BuildPlannerOptions, "preserveDuplicateStoryLinks">,
) => {
  const normalizedResources = ensureDefaultMobileResources(normalizeResourceCapacities(resources));
  const normalizedTasks = tasks.map((task) => {
    const normalized = normalizeTask(task);
    return {
      ...normalized,
      feDevs: coerceAssigneeNamesToRoster(normalized.feDevs, normalizedResources),
      beDevs: coerceAssigneeNamesToRoster(normalized.beDevs, normalizedResources),
      androidDevs: coerceAssigneeNamesToRoster(normalized.androidDevs, normalizedResources),
      iosDevs: coerceAssigneeNamesToRoster(normalized.iosDevs, normalizedResources),
      qcs: coerceAssigneeNamesToRoster(normalized.qcs, normalizedResources),
      productManagers: coerceAssigneeNamesToRoster(normalized.productManagers ?? [], normalizedResources),
    };
  });
  const { tasks: boardTasks, removedIds } = options?.preserveDuplicateStoryLinks
    ? { tasks: normalizedTasks, removedIds: [] as string[] }
    : collapseTasksByStoryLink(normalizedTasks);
  const cfg = normalizeConfig(config);
  return {
    tasks: boardTasks,
    removedDuplicateTaskIds: removedIds,
    resources: normalizedResources,
    config: cfg,
    ...derive(boardTasks, normalizedResources, cfg),
  };
};

const buildBaselineReleaseMap = (result: ScheduleResult): Record<string, string> => {
  const map: Record<string, string> = {};
  result.tasks.forEach((task) => {
    if (task.releaseDate) {
      map[task.id] = task.releaseDate.toISOString();
    }
  });
  return map;
};

const ensureEstimatedBaseline = (
  meta: PlannerMeta,
  result: ScheduleResult,
  nowIso: string,
): PlannerMeta => {
  if (meta.estimatedBaselineCapturedAt) {
    return meta;
  }
  if (!hasReleaseDates(result)) {
    return meta;
  }
  return {
    ...meta,
    snapshot1ReleaseByTaskId:
      Object.keys(meta.snapshot1ReleaseByTaskId).length > 0 ? meta.snapshot1ReleaseByTaskId : buildBaselineReleaseMap(result),
    snapshot1TakenAt: meta.snapshot1TakenAt ?? nowIso,
    estimatedBaselineCapturedAt: nowIso,
  };
};

const runPlannerMetaMigration = (
  meta: PlannerMeta,
  result: ScheduleResult,
  config: Config,
): { plannerMeta: PlannerMeta; config: Config } => {
  if (meta.rulesVersion >= PLANNER_META_RULES_VERSION) {
    return { plannerMeta: meta, config };
  }
  const migrationNow = new Date().toISOString();
  let nextMeta: PlannerMeta = { ...meta, rulesVersion: PLANNER_META_RULES_VERSION };
  let nextConfig = config;

  if (meta.rulesVersion < 2 && nextMeta.uatTrackingEnabled && !nextMeta.curScheduleSnapshot && hasReleaseDates(result)) {
    nextMeta = captureCurScheduleMeta(nextMeta, result, nextMeta.replanAsOf ?? migrationNow);
  }

  if (!nextMeta.estimatedBaselineCapturedAt) {
    if (nextMeta.snapshot1TakenAt) {
      nextMeta = { ...nextMeta, estimatedBaselineCapturedAt: nextMeta.snapshot1TakenAt };
    } else {
      nextMeta = ensureEstimatedBaseline(nextMeta, result, migrationNow);
    }
  }

  if (!nextMeta.uatTrackingEnabled && nextMeta.snapshot1TakenAt != null) {
    nextMeta = { ...nextMeta, uatTrackingEnabled: true };
  }

  if (nextMeta.uatTrackingEnabled && !config.replanAsOf) {
    nextConfig = normalizeConfig({ ...config, replanAsOf: migrationNow });
    nextMeta = { ...nextMeta, replanAsOf: migrationNow };
  }

  return { plannerMeta: nextMeta, config: nextConfig };
};

const applyFrozenCurSchedule = (
  tasks: Task[],
  resources: Resource[],
  built: ReturnType<typeof derive> & { config: Config },
  plannerMeta: PlannerMeta,
): Pick<PlannerState, "result" | "remainingUtilization"> => {
  if (!plannerMeta.uatTrackingEnabled || !plannerMeta.curScheduleSnapshot) {
    return { result: built.result, remainingUtilization: built.remainingUtilization };
  }
  const frozen = deserializeScheduleResult(plannerMeta.curScheduleSnapshot);
  const activeIds = new Set(activeSprintTasks(tasks).map((task) => task.id));
  const result = mergeFrozenScheduleWithFresh(frozen, built.result, activeIds, built.config);
  return {
    result,
    remainingUtilization: computeUtilization(resources, result, built.config),
  };
};

const finalizePlannerBuild = (
  built: ReturnType<typeof buildState>,
  plannerMeta: PlannerMeta,
  options?: BuildPlannerOptions,
) => {
  const { removedDuplicateTaskIds, ...builtState } = built;
  const migrated = runPlannerMetaMigration(
    pruneRemovedTaskIdsFromPlannerMeta(mergePlannerMetaPatch(plannerMeta), removedDuplicateTaskIds),
    builtState.result,
    builtState.config,
  );
  // Seed Cur freeze when tracking is on but snapshot was never captured (e.g. baseline-only meta).
  let nextMeta = seedCurScheduleFreeze(migrated.plannerMeta, builtState.result);
  const shouldRescheduleCur = options?.rescheduleCur ?? !nextMeta.uatTrackingEnabled;
  let result = builtState.result;
  let remainingUtilization = builtState.remainingUtilization;

  if (shouldRescheduleCur) {
    const takenAt = new Date().toISOString();
    if (nextMeta.uatTrackingEnabled) {
      nextMeta = captureCurScheduleMeta(nextMeta, result, takenAt);
    }
  } else {
    const frozen = applyFrozenCurSchedule(builtState.tasks, builtState.resources, builtState, nextMeta);
    result = frozen.result;
    remainingUtilization = frozen.remainingUtilization;
  }

  return {
    ...builtState,
    config: migrated.config,
    result,
    remainingUtilization,
    plannerMeta: ensureEstimatedBaseline(nextMeta, result, new Date().toISOString()),
  };
};

type PersistedSlice = Pick<
  PlannerState,
  | "tasks"
  | "resources"
  | "config"
  | "plannerMeta"
  | "timelineStartDate"
  | "activeSquadId"
  | "lastLocalMutationAt"
  | "lastServerUpdatedAt"
>;

const mergePersistedWithDerived = (persistedState: unknown, currentState: PlannerState): PlannerState => {
  if (persistedState == null || typeof persistedState !== "object") {
    return currentState;
  }
  const merged = { ...currentState, ...(persistedState as PersistedSlice) };
  const { tasks, resources, config, plannerMeta } = merged;
  if (!Array.isArray(tasks) || !Array.isArray(resources) || config == null) {
    return merged;
  }
  const meta = mergePlannerMetaPatch(plannerMeta);
  const normalizedResources = normalizeResourceCapacities(resources);
  const cfg = normalizeConfig(config);
  const normalizedTasks = tasks.map((task) => normalizeTask(task));
  const built = buildState(normalizedTasks, normalizedResources, cfg);
  const finalized = finalizePlannerBuild(built, meta);
  return {
    ...merged,
    ...finalized,
    ...(built.removedDuplicateTaskIds.length > 0 ? touchMutation() : {}),
  };
};

const touchMutation = (): { lastLocalMutationAt: string } => ({
  lastLocalMutationAt: new Date().toISOString(),
});

export const taskStatuses: TaskWorkflowStatus[] = [...DEFAULT_JIRA_STORY_STATUSES];
export const usePlannerStore = create<PlannerState>()(
  persist(
    (set, get) => {
      const buildWithPlannerMeta = (
        tasks: Task[],
        resources: Resource[],
        config: Config,
        plannerMeta: PlannerMeta,
        options?: BuildPlannerOptions,
      ) =>
        finalizePlannerBuild(
          buildState(tasks, resources, config, {
            preserveDuplicateStoryLinks: options?.preserveDuplicateStoryLinks,
          }),
          plannerMeta,
          options,
        );
      return ({
      hasHydrated: false,
      activeSquadId: null,
      timelineStartDate: null,
      lastLocalMutationAt: null,
      lastServerUpdatedAt: null,
      sprintBoardGeneration: 0,
      ...buildState([], [], createDefaultConfig()),
      plannerMeta: defaultPlannerMeta(),
      setHasHydrated: (value) => set({ hasHydrated: value }),
      setActiveSquadId: (activeSquadId) => set({ activeSquadId }),
      setTimelineStartDate: (timelineStartDate) => set({ timelineStartDate }),
      markPlannerSyncedToServer: (serverUpdatedAt) =>
        set({
          lastLocalMutationAt: null,
          ...(serverUpdatedAt !== undefined
            ? { lastServerUpdatedAt: serverUpdatedAt?.trim() || null }
            : {}),
        }),
      hydrateEmptySquad: () => {
        const today = todayDateKey();
        set({
          ...buildWithPlannerMeta(
            [],
            [],
            normalizeConfig({
              ...createDefaultConfig(),
              sprintStartDate: today,
              planningSunday: today,
            }),
            defaultPlannerMeta(),
          ),
          plannerMeta: defaultPlannerMeta(),
          timelineStartDate: null,
          ...touchMutation(),
        });
      },
      addTask: () => {
        const { tasks, resources, config, plannerMeta } = get();
        const newTask = emptyTask();
        // Empty To Do rows do not need Mark Progress; hours/assignee edits will flag later.
        set({
          ...buildWithPlannerMeta([...tasks, newTask], resources, config, plannerMeta),
          ...touchMutation(),
        });
        return newTask.id;
      },
      addTasks: (drafts) => {
        const { tasks, resources, config, plannerMeta, result: currentResult } = get();
        const validDrafts = filterDraftsSkippingExistingStoryLinks(
          drafts.filter((draft) => draft.isValid),
          tasks,
        );
        if (validDrafts.length === 0) {
          return [];
        }

        const newTasks = validDrafts.map((draft) =>
          normalizeTask({
            ...emptyTask(),
            storyName: draft.storyName,
            storyLink: draft.storyLink,
            beDevs: draft.beDevs,
            feDevs: draft.feDevs,
            androidDevs: draft.androidDevs,
            iosDevs: draft.iosDevs,
            qcs: draft.qcs,
            productManagers: draft.productManagers ?? [],
            beHours: draft.beHours ?? 0,
            feHours: draft.feHours ?? 0,
            androidHours: draft.androidHours ?? 0,
            iosHours: draft.iosHours ?? 0,
            needsIos: draft.needsIos ?? false,
            mobileApp: draft.mobileApp ?? "none",
            moStartDate: draft.moStartDate ?? null,
            qcHours: draft.qcHours ?? 0,
            tags: Array.isArray(draft.tags) ? [...new Set(draft.tags.map((tag) => tag.trim()).filter(Boolean))] : [],
            issueType: draft.issueType,
            isEmStory: draft.isEmStory,
          }),
        );

        const combinedTasks = [...tasks, ...newTasks];
        const newTaskIds = newTasks.map((task) => task.id);
        const activeIds = activeSprintTasks(combinedTasks).map((task) => task.id);

        let nextMeta = seedCurScheduleFreeze(plannerMeta, currentResult);
        if (nextMeta.uatTrackingEnabled) {
          nextMeta = {
            ...nextMeta,
            dashboardTaskOrder: appendTaskIdsToDashboardOrder(
              nextMeta.dashboardTaskOrder,
              activeIds,
              newTaskIds,
            ),
          };
        }
        nextMeta = markTaskIdsNeedRemark(nextMeta, newTaskIds);

        set({
          ...buildWithPlannerMeta(combinedTasks, resources, config, nextMeta),
          ...touchMutation(),
        });
        return newTaskIds;
      },
      updateTask: (id, patch) => {
        const { tasks, resources, config, plannerMeta, result: currentResult } = get();
        const previous = tasks.find((t) => t.id === id);
        if (!previous) {
          return;
        }

        const effectivePatch = filterTaskPatchToActualChanges(previous, patch);
        if (Object.keys(effectivePatch).length === 0) {
          return;
        }

        if (!patchRequiresReschedule(effectivePatch)) {
          const updated = tasks.map((task) =>
            task.id === id ? normalizeTask({ ...task, ...effectivePatch }) : task,
          );
          set({
            tasks: updated,
            plannerMeta: applyPlannerMetaForTaskPatch(plannerMeta, id, effectivePatch, previous),
            ...touchMutation(),
          });
          return;
        }

        // Freeze the pre-edit schedule first so Mark Progress lights and Cur does not jump.
        const metaBeforeEdit = seedCurScheduleFreeze(plannerMeta, currentResult);
        const patched = tasks.map((task) =>
          task.id === id ? normalizeTask({ ...task, ...effectivePatch }) : task,
        );
        let updated =
          Object.prototype.hasOwnProperty.call(effectivePatch, "poPriority") &&
          effectivePatch.poPriority !== undefined
            ? enforceUniquePoPriorities(patched, id, effectivePatch.poPriority ?? null)
            : patched;
        const becameReleased =
          !isReleasedTaskStatus(previous.status) &&
          isReleasedTaskStatus(updated.find((t) => t.id === id)?.status ?? "");
        if (becameReleased) {
          updated = compactPrioritiesAfterRelease(updated, id);
        }
        set({
          ...buildWithPlannerMeta(
            updated,
            resources,
            config,
            applyPlannerMetaForTaskPatch(metaBeforeEdit, id, effectivePatch, previous),
          ),
          ...touchMutation(),
        });
      },
      updateTasks: (ids, patch) => {
        const idSet = new Set(ids);
        if (idSet.size === 0 || Object.keys(patch).length === 0) {
          return;
        }

        const { tasks, resources, config, plannerMeta, result: currentResult } = get();
        const previousById = new Map(tasks.map((task) => [task.id, task]));
        const changedIds: string[] = [];
        const updated = tasks.map((task) => {
          if (!idSet.has(task.id)) {
            return task;
          }
          const effectivePatch = filterTaskPatchToActualChanges(task, patch);
          if (Object.keys(effectivePatch).length === 0) {
            return task;
          }
          changedIds.push(task.id);
          return normalizeTask({ ...task, ...effectivePatch });
        });
        if (changedIds.length === 0) {
          return;
        }

        let nextMeta = plannerMeta;
        if (patchRequiresReschedule(patch)) {
          nextMeta = seedCurScheduleFreeze(plannerMeta, currentResult);
        }
        for (const id of changedIds) {
          nextMeta = applyPlannerMetaForTaskPatch(nextMeta, id, patch, previousById.get(id));
        }

        if (!patchRequiresReschedule(patch)) {
          set({
            tasks: updated,
            plannerMeta: nextMeta,
            ...touchMutation(),
          });
          return;
        }

        set({
          ...buildWithPlannerMeta(updated, resources, config, nextMeta),
          ...touchMutation(),
        });
      },
      removeTask: (id) => {
        const { tasks, resources, config, plannerMeta } = get();
        set({
          ...buildWithPlannerMeta(
            tasks.filter((task) => task.id !== id),
            resources,
            config,
            removeTaskIdFromNeedRemark(plannerMeta, id),
          ),
          ...touchMutation(),
        });
      },
      addResource: (type) => {
        const { tasks, resources, config, plannerMeta } = get();
        const totalHours = Math.min(SQUAD_CAPACITY_HOURS_MAX, totalWorkingHoursForSprint(config));
        set({
          ...buildWithPlannerMeta(
            tasks,
            [
              ...resources,
              {
                type,
                name: `${type}-${resources.length + 1}`,
                ownershipMode: "shared",
                ourSquadHours: totalHours,
                capacityHours: totalHours,
              },
            ],
            config,
            markTaskIdsNeedRemark(
              plannerMeta,
              activeSprintTasks(tasks).map((task) => task.id),
            ),
          ),
          ...touchMutation(),
        });
      },
      addMappedResource: (resource) => {
        const { tasks, resources, config, plannerMeta } = get();
        const name = resource.name.trim();
        if (!name) return;
        if (resources.some((row) => row.name.trim().toLowerCase() === name.toLowerCase())) {
          return;
        }
        set({
          ...buildWithPlannerMeta(
            tasks,
            [...resources, { ...resource, name, nickname: undefined }],
            config,
            markTaskIdsNeedRemark(
              plannerMeta,
              activeSprintTasks(tasks).map((task) => task.id),
            ),
          ),
          ...touchMutation(),
        });
      },
      updateResource: (index, resource) => {
        const { tasks, resources, config, plannerMeta } = get();
        const previous = resources[index];
        const updated = resources.map((item, idx) => (idx === index ? resource : item));
        const updatedTasks =
          previous && previous.name !== resource.name
            ? tasks.map((task) => ({
                ...task,
                feDevs: task.feDevs.map((name) => (name === previous.name ? resource.name : name)),
                beDevs: task.beDevs.map((name) => (name === previous.name ? resource.name : name)),
                androidDevs: task.androidDevs.map((name) =>
                  name === previous.name ? resource.name : name,
                ),
                iosDevs: task.iosDevs.map((name) => (name === previous.name ? resource.name : name)),
                qcs: task.qcs.map((name) => (name === previous.name ? resource.name : name)),
                productManagers: (task.productManagers ?? []).map((name) =>
                  name === previous.name ? resource.name : name,
                ),
              }))
            : tasks;
        set({
          ...buildWithPlannerMeta(
            updatedTasks,
            updated,
            config,
            markTaskIdsNeedRemark(
              plannerMeta,
              activeSprintTasks(updatedTasks).map((task) => task.id),
            ),
          ),
        });
      },
      removeResource: (index) => {
        const { tasks, resources, config, plannerMeta } = get();
        const removed = resources[index];
        const updatedResources = resources.filter((_, idx) => idx !== index);
        const updatedTasks = removed
          ? tasks.map((task) => ({
              ...task,
              feDevs: task.feDevs.filter((name) => name !== removed.name),
              beDevs: task.beDevs.filter((name) => name !== removed.name),
              androidDevs: task.androidDevs.filter((name) => name !== removed.name),
              iosDevs: task.iosDevs.filter((name) => name !== removed.name),
              qcs: task.qcs.filter((name) => name !== removed.name),
              productManagers: (task.productManagers ?? []).filter((name) => name !== removed.name),
            }))
          : tasks;
        set({
          ...buildWithPlannerMeta(
            updatedTasks,
            updatedResources,
            config,
            markTaskIdsNeedRemark(
              plannerMeta,
              activeSprintTasks(updatedTasks).map((task) => task.id),
            ),
          ),
        });
      },
      applyJiraResourceRenames: (renames) => {
        // Server already persisted renames — do not touchMutation (autosave would overwrite with stale short names).
        const { tasks, resources, config, plannerMeta } = get();
        if (renames.length === 0) {
          const cleared = resources.map((resource) => ({ ...resource, nickname: undefined }));
          set({
            ...buildWithPlannerMeta(tasks, cleared, config, plannerMeta),
          });
          return;
        }
        const renameMap = new Map(
          renames
            .map((row) => [row.from.trim(), row.to.trim()] as const)
            .filter(([from, to]) => from && to && from !== to),
        );
        const remap = (name: string) => renameMap.get(name) ?? name;
        const updatedResources = resources.map((resource) => {
          const nextName = remap(resource.name);
          return { ...resource, name: nextName, nickname: undefined };
        });
        const updatedTasks = tasks.map((task) => ({
          ...task,
          feDevs: task.feDevs.map(remap),
          beDevs: task.beDevs.map(remap),
          androidDevs: task.androidDevs.map(remap),
          iosDevs: task.iosDevs.map(remap),
          qcs: task.qcs.map(remap),
          productManagers: (task.productManagers ?? []).map(remap),
        }));
        set({
          ...buildWithPlannerMeta(
            updatedTasks,
            updatedResources,
            config,
            markTaskIdsNeedRemark(
              plannerMeta,
              activeSprintTasks(updatedTasks).map((task) => task.id),
            ),
          ),
        });
      },
      clearResourceNicknames: () => {
        // Server already cleared nicknames — mirror locally without marking dirty.
        const { tasks, resources, config, plannerMeta } = get();
        const cleared = resources.map((resource) => ({ ...resource, nickname: undefined }));
        set({
          ...buildWithPlannerMeta(tasks, cleared, config, plannerMeta),
        });
      },
      updateConfig: (patch) => {
        const { tasks, resources, config, plannerMeta } = get();
        const merged = normalizeConfig({ ...config, ...patch });
        if (patch.sprintStartDate) {
          merged.planningSunday = patch.sprintStartDate;
        }
        set({
          ...buildWithPlannerMeta(
            tasks,
            resources,
            merged,
            markTaskIdsNeedRemark(
              plannerMeta,
              activeSprintTasks(tasks).map((task) => task.id),
            ),
          ),
        });
      },
      startNewSprint: async (options) => {
        const { tasks, resources, config, plannerMeta } = get();
        const requestedStart = options?.sprintStartDate?.trim() ?? "";
        const sprintStartDate =
          /^\d{4}-\d{2}-\d{2}$/.test(requestedStart) &&
          !Number.isNaN(parseCalendarDate(requestedStart).getTime())
            ? requestedStart
            : todayDateKey();
        // Must succeed before changing the live board — otherwise the sprint is only in memory.
        await archiveSprintSnapshot({
          tasks,
          resources,
          config,
          squadId: get().activeSquadId,
          retentionMode: "new_sprint",
        });
        const nextConfig = normalizeConfig({
          ...createDefaultConfig(),
          ...config,
          sprintStartDate,
          planningSunday: sprintStartDate,
          extraHolidays: [],
          replanAsOf: null,
        });
        const carryOverTasks = buildCarryOverTasks(tasks);
        const keptIds = new Set(carryOverTasks.map((task) => task.id));
        const preservedOrder = plannerMeta.dashboardTaskOrder.filter((id) => keptIds.has(id));
        const seedMeta: PlannerMeta = {
          ...defaultPlannerMeta(),
          uatTrackingEnabled: plannerMeta.uatTrackingEnabled,
          dashboardTaskOrder: preservedOrder,
          estimatedBaselineCapturedAt: plannerMeta.estimatedBaselineCapturedAt,
          snapshot1ReleaseByTaskId: Object.fromEntries(
            Object.entries(plannerMeta.snapshot1ReleaseByTaskId).filter(([id]) => keptIds.has(id)),
          ),
          snapshot1TakenAt: plannerMeta.snapshot1TakenAt,
        };
        const built = buildWithPlannerMeta(carryOverTasks, resources, nextConfig, seedMeta, {
          rescheduleCur: true,
        });
        const dashboardTaskOrder =
          preservedOrder.length > 0
            ? preservedOrder
            : buildDashboardTaskOrder(activeSprintTasks(built.tasks), built.result);
        set({
          ...built,
          plannerMeta: {
            ...built.plannerMeta,
            uatTrackingEnabled: plannerMeta.uatTrackingEnabled,
            dashboardTaskOrder,
          },
          sprintBoardGeneration: get().sprintBoardGeneration + 1,
          ...touchMutation(),
        });
      },
      restoreSprintFromHistory: (snapshot) => {
        const nextConfig = normalizeConfig(snapshot.config);
        const built = buildWithPlannerMeta(
          snapshot.tasks,
          snapshot.resources,
          nextConfig,
          defaultPlannerMeta(),
          { rescheduleCur: true, preserveDuplicateStoryLinks: true },
        );
        const dashboardTaskOrder = buildDashboardTaskOrder(
          activeSprintTasks(built.tasks),
          built.result,
        );
        set({
          ...built,
          plannerMeta: {
            ...built.plannerMeta,
            uatTrackingEnabled: true,
            dashboardTaskOrder,
          },
          sprintBoardGeneration: get().sprintBoardGeneration + 1,
          ...touchMutation(),
        });
      },
      hydrateFromServer: (data) => {
        const localMutationAt = get().lastLocalMutationAt;
        const serverUpdatedAt =
          typeof data.serverUpdatedAt === "string" ? data.serverUpdatedAt : null;
        if (
          shouldSkipIncomingPlannerSnapshot({
            incomingUpdatedAt: serverUpdatedAt,
            localMutationAt,
            knownServerUpdatedAt: get().lastServerUpdatedAt,
          })
        ) {
          // Stale GET or unsynced local edits — keep the in-memory board (including new rows).
          return;
        }
        const mergedMeta = mergePlannerMetaPatch(data.plannerMeta);
        const mergedTasks = mergeIncomingTasksWithCurrent(data.tasks, get().tasks, {
          keepLocalOnly: Boolean(localMutationAt),
        });
        const normalizedConfig = normalizeConfig(data.config);
        const built = buildState(
          mergedTasks.map((t) => normalizeTask(t)),
          normalizeResourceCapacities(data.resources),
          normalizedConfig,
        );
        const finalized = finalizePlannerBuild(built, mergedMeta);
        set({
          ...finalized,
          timelineStartDate:
            typeof data.timelineStartDate === "string" ? data.timelineStartDate : null,
          lastLocalMutationAt:
            built.removedDuplicateTaskIds.length > 0
              ? new Date().toISOString()
              : localMutationAt,
          lastServerUpdatedAt: serverUpdatedAt ?? get().lastServerUpdatedAt,
        });
      },
      markProgressNow: () => {
        set((s) => {
          const iso = new Date().toISOString();
          const nextConfig = normalizeConfig({ ...s.config, replanAsOf: iso });
          const baseMeta = ensureEstimatedBaseline(s.plannerMeta, s.result, iso);
          const nextMeta: PlannerMeta = {
            ...baseMeta,
            uatTrackingEnabled: true,
            rulesVersion: PLANNER_META_RULES_VERSION,
            replanAsOf: iso,
          };
          const built = buildWithPlannerMeta(s.tasks, s.resources, nextConfig, nextMeta, { rescheduleCur: true });
          const dashboardTaskOrder = buildDashboardTaskOrder(activeSprintTasks(built.tasks), built.result);
          return {
            ...built,
            plannerMeta: clearTasksNeedRemark({
              ...built.plannerMeta,
              uatTrackingEnabled: true,
              replanAsOf: iso,
              dashboardTaskOrder,
            }),
            ...touchMutation(),
          };
        });
      },
    });
    },
    {
      name: "planner-store",
      partialize: ({
        tasks,
        resources,
        config,
        plannerMeta,
        timelineStartDate,
        activeSquadId,
        lastLocalMutationAt,
        lastServerUpdatedAt,
      }) => ({
        tasks,
        resources,
        config,
        plannerMeta,
        timelineStartDate,
        activeSquadId,
        lastLocalMutationAt,
        lastServerUpdatedAt,
      }),
      merge: mergePersistedWithDerived,
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
