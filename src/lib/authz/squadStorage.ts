import {
  Prisma,
  type AssigneeRole,
  type OwnershipMode,
  type ResourceType,
  type TaskReplanStep,
  type Theme,
  type ReleaseStrategy,
} from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ensureDefaultMobileResources, normalizeMobileAppFlag } from "@/lib/scheduler/mobilePlatform";
import { sanitizeSquadKey } from "./permissions";

const EMPTY_PLANNER_PAYLOAD = {
  tasks: [],
  resources: [],
  config: null,
  plannerMeta: null,
  timelineStartDate: null,
  updatedAt: null,
};

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const defaultConfig = () => ({
  sprintStartDate: new Date().toISOString().slice(0, 10),
  planningSunday: new Date().toISOString().slice(0, 10),
  extraHolidays: [] as string[],
  hoursPerDay: 8,
  sprintWorkingDays: 10,
  theme: "ocean" as const,
  releaseStrategy: "earliestStoriesFirst" as const,
  workdayStartHour: 11 as number | null,
  replanAsOf: null as string | null,
});

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const toTheme = (value: unknown): Theme => {
  if (value === "sunset" || value === "forest" || value === "ocean") return value;
  return "ocean";
};

const toReleaseStrategy = (value: unknown): ReleaseStrategy => {
  if (value === "latestReleaseOnly" || value === "earliestStoriesFirst") return value;
  return "earliestStoriesFirst";
};

const toReplanStep = (value: unknown): TaskReplanStep | null => {
  if (
    value === "Start" ||
    value === "FE" ||
    value === "Integration" ||
    value === "QC" ||
    value === "Buffer"
  ) {
    return value;
  }
  return null;
};

const parseDateTime = (value: unknown): Date | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export class StalePlannerWriteError extends Error {
  serverUpdatedAt: string | null;

  constructor(serverUpdatedAt: string | null) {
    super("Planner state was updated elsewhere. Reload and retry.");
    this.name = "StalePlannerWriteError";
    this.serverUpdatedAt = serverUpdatedAt;
  }
}

export type WriteSquadPlannerOptions = {
  /** Client's last known server updatedAt. Required when server already has state. */
  baseUpdatedAt?: string | null;
  /** Max tasks accepted in one write (DoS guard). */
  maxTasks?: number;
  maxResources?: number;
};

const DEFAULT_MAX_TASKS = 500;
const DEFAULT_MAX_RESOURCES = 200;

async function ensureSquadExists(squadId: string): Promise<void> {
  const existing = await prisma.squad.findUnique({ where: { id: squadId }, select: { id: true } });
  if (!existing) {
    throw new Error(`Unknown squad "${squadId}". Provision it in user management first.`);
  }
}

export async function readSquadPlannerState(squadId: string): Promise<Record<string, unknown>> {
  const safe = sanitizeSquadKey(squadId);
  if (!safe) return { ...EMPTY_PLANNER_PAYLOAD };

  const [config, meta, holidays, tasks, resources] = await Promise.all([
    prisma.sprintConfig.findUnique({ where: { squadId: safe } }),
    prisma.plannerMeta.findUnique({
      where: { squadId: safe },
      include: {
        estimatedBaselines: true,
        needRemarkTasks: true,
        dashboardOrder: { orderBy: { position: "asc" } },
      },
    }),
    prisma.squadHoliday.findMany({ where: { squadId: safe }, orderBy: { date: "asc" } }),
    prisma.task.findMany({
      where: { squadId: safe },
      include: {
        assignees: true,
        tags: true,
        jiraLink: { include: { subtasks: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.resource.findMany({ where: { squadId: safe }, orderBy: { createdAt: "asc" } }),
  ]);

  if (!config && !meta && tasks.length === 0 && resources.length === 0) {
    return { ...EMPTY_PLANNER_PAYLOAD };
  }

  const configPayload = config
    ? {
        sprintStartDate: config.sprintStartDate,
        planningSunday: config.planningSunday,
        extraHolidays: holidays.map((row) => row.date),
        hoursPerDay: config.hoursPerDay,
        sprintWorkingDays: config.sprintWorkingDays,
        theme: config.theme,
        releaseStrategy: config.releaseStrategy,
        workdayStartHour: config.workdayStartHour ?? undefined,
        replanAsOf: config.replanAsOf,
      }
    : null;

  const plannerMeta = meta
    ? {
        snapshot1ReleaseByTaskId: Object.fromEntries(
          meta.estimatedBaselines.map((row) => [row.taskId, row.releaseAt]),
        ),
        snapshot1TakenAt: meta.snapshot1TakenAt,
        estimatedBaselineCapturedAt: meta.estimatedBaselineCapturedAt,
        uatTrackingEnabled: meta.uatTrackingEnabled,
        curScheduleSnapshot: meta.curScheduleSnapshot ?? null,
        curScheduleTakenAt: meta.curScheduleTakenAt,
        taskIdsNeedRemark: meta.needRemarkTasks.map((row) => row.taskId),
        dashboardTaskOrder: meta.dashboardOrder.map((row) => row.taskId),
        rulesVersion: meta.rulesVersion,
        replanAsOf: meta.replanAsOf,
      }
    : null;

  const updatedAtCandidates = [config?.updatedAt, meta?.updatedAt].filter(Boolean) as Date[];
  const updatedAt =
    updatedAtCandidates.length > 0
      ? new Date(Math.max(...updatedAtCandidates.map((d) => d.getTime()))).toISOString()
      : null;

  return {
    tasks: tasks.map((task) => {
      const feDevs = task.assignees.filter((a) => a.role === "FE").map((a) => a.resourceName);
      const beDevs = task.assignees.filter((a) => a.role === "BE").map((a) => a.resourceName);
      const androidDevs = task.assignees
        .filter((a) => a.role === "ANDROID" || (a.role as string) === "MO")
        .map((a) => a.resourceName);
      const iosDevs = task.assignees.filter((a) => a.role === "IOS").map((a) => a.resourceName);
      const qcs = task.assignees.filter((a) => a.role === "QC").map((a) => a.resourceName);
      const productManagers = task.assignees
        .filter((a) => a.role === "PM")
        .map((a) => a.resourceName);
      return {
        id: task.id,
        storyName: task.storyName,
        storyLink: task.storyLink,
        tags: task.tags.map((row) => row.tag),
        taskNotes: task.taskNotes,
        poPriority: task.poPriority,
        status: task.status,
        feDevs,
        feHours: task.feHours,
        beDevs,
        beHours: task.beHours,
        androidDevs,
        androidHours: task.androidHours,
        iosDevs,
        iosHours: task.iosHours,
        needsIos: task.needsIos,
        mobileApp: normalizeMobileAppFlag(
          (task as { mobileApp?: string }).mobileApp ?? "none",
        ),
        moStartDate: task.moStartDate
          ? task.moStartDate.toISOString().slice(0, 10)
          : null,
        integrationHours: task.integrationHours,
        integrationFlags: {
          needsDevOps: task.needsDevOps,
          needsCdc: task.needsCdc,
          needsDbSync: task.needsDbSync,
          needsOtherSquad: task.needsOtherSquad,
          needsThirdParty: task.needsThirdParty,
        },
        qcs,
        qcHours: task.qcHours,
        productManagers,
        bufferHours: task.bufferHours,
        replanFromStep: task.replanFromStep,
        carryToNextSprint: task.carryToNextSprint,
        releaseGroup: task.releaseGroup ?? undefined,
        issueType: task.issueType ?? undefined,
        isEmStory: task.isEmStory,
        jira: task.jiraLink
          ? {
              parentIssueKey: task.jiraLink.parentIssueKey,
              lastPushedAt: task.jiraLink.lastPushedAt?.toISOString() ?? null,
              lastPulledAt: task.jiraLink.lastPulledAt?.toISOString() ?? null,
              subtasks: task.jiraLink.subtasks.map((sub) => ({
                key: sub.key,
                role: (sub.role as string) === "mo" ? "android" : sub.role,
                assigneeName: sub.assigneeName,
                hours: sub.hours,
              })),
            }
          : undefined,
      };
    }),
    resources: ensureDefaultMobileResources(
      resources.map((resource) => ({
        name: resource.name,
        type: resource.type,
        capacityHours: resource.capacityHours ?? undefined,
        ownershipMode: resource.ownershipMode ?? undefined,
        ourSquadHours: resource.ourSquadHours ?? undefined,
        nickname: resource.nickname ?? undefined,
      })),
    ),
    config: configPayload,
    plannerMeta,
    timelineStartDate: config?.timelineStartDate ?? null,
    updatedAt,
  };
}

export async function writeSquadPlannerState(
  squadId: string,
  payload: Record<string, unknown>,
  options?: WriteSquadPlannerOptions,
): Promise<{ updatedAt: string }> {
  const safe = sanitizeSquadKey(squadId);
  if (!safe) throw new Error("Invalid squad id");

  await ensureSquadExists(safe);

  const maxTasks = options?.maxTasks ?? DEFAULT_MAX_TASKS;
  const maxResources = options?.maxResources ?? DEFAULT_MAX_RESOURCES;
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : [];
  const resources = Array.isArray(payload.resources) ? payload.resources : [];
  if (tasks.length > maxTasks) {
    throw new Error(`Too many tasks (max ${maxTasks}).`);
  }
  if (resources.length > maxResources) {
    throw new Error(`Too many resources (max ${maxResources}).`);
  }

  const configRaw = asRecord(payload.config);
  const defaults = defaultConfig();
  const holidays = asStringArray(configRaw.extraHolidays);
  const sprintStartDate =
    typeof configRaw.sprintStartDate === "string" ? configRaw.sprintStartDate : defaults.sprintStartDate;
  const planningSunday =
    typeof configRaw.planningSunday === "string" ? configRaw.planningSunday : defaults.planningSunday;
  const hoursPerDay = Number.isFinite(Number(configRaw.hoursPerDay))
    ? Number(configRaw.hoursPerDay)
    : defaults.hoursPerDay;
  const sprintWorkingDays = Number.isFinite(Number(configRaw.sprintWorkingDays))
    ? Number(configRaw.sprintWorkingDays)
    : defaults.sprintWorkingDays;
  const theme = toTheme(configRaw.theme ?? defaults.theme);
  const releaseStrategy = toReleaseStrategy(configRaw.releaseStrategy ?? defaults.releaseStrategy);
  const workdayStartHour = Number.isFinite(Number(configRaw.workdayStartHour))
    ? Number(configRaw.workdayStartHour)
    : null;
  const replanAsOf = typeof configRaw.replanAsOf === "string" ? configRaw.replanAsOf : null;
  const timelineStartDate =
    typeof payload.timelineStartDate === "string" ? payload.timelineStartDate : null;

  const metaRaw = asRecord(payload.plannerMeta);
  const snapshot1 = asRecord(metaRaw.snapshot1ReleaseByTaskId);
  const needRemark = asStringArray(metaRaw.taskIdsNeedRemark);
  const dashboardOrder = asStringArray(metaRaw.dashboardTaskOrder);

  const baseUpdatedAt = options?.baseUpdatedAt ?? null;
  const baseMs = baseUpdatedAt && Number.isFinite(Date.parse(baseUpdatedAt)) ? Date.parse(baseUpdatedAt) : null;

  let writtenUpdatedAt = new Date().toISOString();

  await prisma.$transaction(
    async (tx) => {
    // Lock sprint config row (or determine empty board) before overwrite.
    const locked = await tx.$queryRaw<Array<{ updatedAt: Date }>>`
      SELECT "updatedAt" FROM "SprintConfig" WHERE "squadId" = ${safe} FOR UPDATE
    `;
    const serverUpdatedAt = locked[0]?.updatedAt ?? null;
    if (serverUpdatedAt) {
      const serverMs = serverUpdatedAt.getTime();
      if (baseMs == null) {
        throw new StalePlannerWriteError(serverUpdatedAt.toISOString());
      }
      if (serverMs > baseMs) {
        throw new StalePlannerWriteError(serverUpdatedAt.toISOString());
      }
    }

    await tx.sprintConfig.upsert({
      where: { squadId: safe },
      create: {
        squadId: safe,
        sprintStartDate,
        planningSunday,
        hoursPerDay,
        sprintWorkingDays,
        theme,
        releaseStrategy,
        workdayStartHour,
        replanAsOf,
        timelineStartDate,
      },
      update: {
        sprintStartDate,
        planningSunday,
        hoursPerDay,
        sprintWorkingDays,
        theme,
        releaseStrategy,
        workdayStartHour,
        replanAsOf,
        timelineStartDate,
      },
    });

    const configAfter = await tx.sprintConfig.findUnique({
      where: { squadId: safe },
      select: { updatedAt: true },
    });
    if (configAfter?.updatedAt) {
      writtenUpdatedAt = configAfter.updatedAt.toISOString();
    }

    await tx.squadHoliday.deleteMany({ where: { squadId: safe } });
    if (holidays.length > 0) {
      await tx.squadHoliday.createMany({
        data: [...new Set(holidays)].map((date) => ({ squadId: safe, date })),
      });
    }

    await tx.plannerMeta.upsert({
      where: { squadId: safe },
      create: {
        squadId: safe,
        snapshot1TakenAt: typeof metaRaw.snapshot1TakenAt === "string" ? metaRaw.snapshot1TakenAt : null,
        estimatedBaselineCapturedAt:
          typeof metaRaw.estimatedBaselineCapturedAt === "string"
            ? metaRaw.estimatedBaselineCapturedAt
            : null,
        uatTrackingEnabled: Boolean(metaRaw.uatTrackingEnabled),
        curScheduleSnapshot:
          metaRaw.curScheduleSnapshot === undefined || metaRaw.curScheduleSnapshot === null
            ? Prisma.DbNull
            : asJson(metaRaw.curScheduleSnapshot),
        curScheduleTakenAt:
          typeof metaRaw.curScheduleTakenAt === "string" ? metaRaw.curScheduleTakenAt : null,
        rulesVersion:
          typeof metaRaw.rulesVersion === "number" && Number.isFinite(metaRaw.rulesVersion)
            ? metaRaw.rulesVersion
            : 2,
        replanAsOf: typeof metaRaw.replanAsOf === "string" ? metaRaw.replanAsOf : null,
      },
      update: {
        snapshot1TakenAt: typeof metaRaw.snapshot1TakenAt === "string" ? metaRaw.snapshot1TakenAt : null,
        estimatedBaselineCapturedAt:
          typeof metaRaw.estimatedBaselineCapturedAt === "string"
            ? metaRaw.estimatedBaselineCapturedAt
            : null,
        uatTrackingEnabled: Boolean(metaRaw.uatTrackingEnabled),
        curScheduleSnapshot:
          metaRaw.curScheduleSnapshot === undefined || metaRaw.curScheduleSnapshot === null
            ? Prisma.DbNull
            : asJson(metaRaw.curScheduleSnapshot),
        curScheduleTakenAt:
          typeof metaRaw.curScheduleTakenAt === "string" ? metaRaw.curScheduleTakenAt : null,
        rulesVersion:
          typeof metaRaw.rulesVersion === "number" && Number.isFinite(metaRaw.rulesVersion)
            ? metaRaw.rulesVersion
            : 2,
        replanAsOf: typeof metaRaw.replanAsOf === "string" ? metaRaw.replanAsOf : null,
      },
    });

    await tx.taskEstimatedBaseline.deleteMany({ where: { squadId: safe } });
    await tx.taskNeedRemark.deleteMany({ where: { squadId: safe } });
    await tx.dashboardTaskOrder.deleteMany({ where: { squadId: safe } });

    await tx.task.deleteMany({ where: { squadId: safe } });
    await tx.resource.deleteMany({ where: { squadId: safe } });

    const resourceRows = ensureDefaultMobileResources(
      resources
        .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
        .map((resource) => {
          const type: ResourceType =
            resource.type === "FE" ||
            resource.type === "BE" ||
            resource.type === "MO" ||
            resource.type === "QC" ||
            resource.type === "PM" ||
            resource.type === "OtherSquad"
              ? resource.type
              : "BE";
          const ownershipMode: OwnershipMode | null =
            resource.ownershipMode === "fullyMine" || resource.ownershipMode === "shared"
              ? resource.ownershipMode
              : null;
          return {
            name: typeof resource.name === "string" ? resource.name : "Unnamed",
            type,
            capacityHours:
              resource.capacityHours === undefined || resource.capacityHours === null
                ? undefined
                : Number(resource.capacityHours),
            ownershipMode: ownershipMode ?? undefined,
            ourSquadHours:
              resource.ourSquadHours === undefined || resource.ourSquadHours === null
                ? undefined
                : Number(resource.ourSquadHours),
            nickname: typeof resource.nickname === "string" ? resource.nickname : undefined,
          };
        }),
    ).map((resource) => ({
      squadId: safe,
      name: resource.name,
      type: resource.type,
      capacityHours: resource.capacityHours ?? null,
      ownershipMode: resource.ownershipMode ?? null,
      ourSquadHours: resource.ourSquadHours ?? null,
      nickname: resource.nickname ?? null,
    }));

    if (resourceRows.length > 0) {
      await tx.resource.createMany({ data: resourceRows });
    }

    const resourceIdByName = new Map(
      (
        await tx.resource.findMany({
          where: { squadId: safe },
          select: { id: true, name: true },
        })
      ).map((row) => [row.name, row.id] as const),
    );

    const normalizedTasks = tasks
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((task) => {
        const id = typeof task.id === "string" && task.id ? task.id : crypto.randomUUID();
        const flags = asRecord(task.integrationFlags);
        return { id, task, flags };
      });
    const taskIds = new Set(normalizedTasks.map((row) => row.id));

    if (normalizedTasks.length > 0) {
      await tx.task.createMany({
        data: normalizedTasks.map(({ id, task, flags }) => ({
          id,
          squadId: safe,
          storyName: typeof task.storyName === "string" ? task.storyName : "",
          storyLink: typeof task.storyLink === "string" ? task.storyLink : "",
          taskNotes: typeof task.taskNotes === "string" ? task.taskNotes : "",
          poPriority:
            task.poPriority === null || task.poPriority === undefined ? null : Number(task.poPriority) || null,
          status: typeof task.status === "string" ? task.status : "TODO",
          feHours: Number(task.feHours) || 0,
          beHours: Number(task.beHours) || 0,
          androidHours: Number(task.androidHours ?? task.moHours) || 0,
          iosHours: Number(task.iosHours) || 0,
          needsIos: Boolean(task.needsIos),
          mobileApp: (() => {
            const raw = typeof task.mobileApp === "string" ? task.mobileApp.trim().toLowerCase() : "none";
            return raw === "star" || raw === "hubs" ? raw : "none";
          })(),
          moStartDate: (() => {
            const raw = typeof task.moStartDate === "string" ? task.moStartDate.trim() : "";
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
            return new Date(`${raw}T00:00:00.000Z`);
          })(),
          integrationHours: Number(task.integrationHours) || 0,
          qcHours: Number(task.qcHours) || 0,
          bufferHours: Number(task.bufferHours) || 0,
          needsDevOps: Boolean(flags.needsDevOps),
          needsCdc: Boolean(flags.needsCdc),
          needsDbSync: Boolean(flags.needsDbSync),
          needsOtherSquad: Boolean(flags.needsOtherSquad),
          needsThirdParty: Boolean(flags.needsThirdParty),
          replanFromStep: toReplanStep(task.replanFromStep),
          carryToNextSprint: Boolean(task.carryToNextSprint),
          releaseGroup: typeof task.releaseGroup === "string" ? task.releaseGroup : null,
          issueType: typeof task.issueType === "string" && task.issueType.trim() ? task.issueType.trim() : null,
          isEmStory: Boolean(task.isEmStory),
        })),
      });
    }

    const assigneeRows: Array<{
      taskId: string;
      role: AssigneeRole;
      resourceName: string;
      resourceId: string | null;
    }> = [];
    const tagRows: Array<{ taskId: string; tag: string }> = [];
    const jiraLinks: Array<{
      taskId: string;
      parentIssueKey: string;
      lastPushedAt: Date | null;
      lastPulledAt: Date | null;
    }> = [];
    const jiraSubtasks: Array<{
      taskId: string;
      key: string;
      role: "fe" | "be" | "android" | "ios";
      assigneeName: string;
      hours: number;
    }> = [];

    for (const { id, task } of normalizedTasks) {
      const pushAssignees = (names: string[], role: AssigneeRole) => {
        for (const name of names) {
          const trimmed = name.trim();
          if (!trimmed) continue;
          assigneeRows.push({
            taskId: id,
            role,
            resourceName: trimmed,
            resourceId: resourceIdByName.get(trimmed) ?? null,
          });
        }
      };
      pushAssignees(asStringArray(task.feDevs), "FE");
      pushAssignees(asStringArray(task.beDevs), "BE");
      const androidNames =
        asStringArray(task.androidDevs).length > 0
          ? asStringArray(task.androidDevs)
          : asStringArray(task.moDevs);
      pushAssignees(androidNames, "ANDROID");
      pushAssignees(asStringArray(task.iosDevs), "IOS");
      pushAssignees(asStringArray(task.qcs), "QC");
      pushAssignees(asStringArray(task.productManagers), "PM");

      for (const tag of [...new Set(asStringArray(task.tags))]) {
        tagRows.push({ taskId: id, tag });
      }

      const jira = asRecord(task.jira);
      const parentIssueKey = typeof jira.parentIssueKey === "string" ? jira.parentIssueKey : "";
      if (parentIssueKey) {
        jiraLinks.push({
          taskId: id,
          parentIssueKey,
          lastPushedAt: parseDateTime(jira.lastPushedAt),
          lastPulledAt: parseDateTime(jira.lastPulledAt),
        });
        const subtasks = Array.isArray(jira.subtasks) ? jira.subtasks : [];
        for (const row of subtasks) {
          if (!row || typeof row !== "object") continue;
          const sub = row as Record<string, unknown>;
          const key = typeof sub.key === "string" ? sub.key : "";
          if (!key) continue;
          const role =
            sub.role === "be"
              ? "be"
              : sub.role === "ios"
                ? "ios"
                : sub.role === "android" || sub.role === "mo"
                  ? "android"
                  : "fe";
          jiraSubtasks.push({
            taskId: id,
            key,
            role,
            assigneeName: typeof sub.assigneeName === "string" ? sub.assigneeName : "",
            hours: Number(sub.hours) || 0,
          });
        }
      }
    }

    if (assigneeRows.length > 0) await tx.taskAssignee.createMany({ data: assigneeRows });
    if (tagRows.length > 0) await tx.taskTag.createMany({ data: tagRows });
    if (jiraLinks.length > 0) await tx.taskJiraLink.createMany({ data: jiraLinks });
    if (jiraSubtasks.length > 0) await tx.taskJiraSubtask.createMany({ data: jiraSubtasks });

    const baselineRows = Object.entries(snapshot1)
      .filter(([taskId, releaseAt]) => taskIds.has(taskId) && typeof releaseAt === "string")
      .map(([taskId, releaseAt]) => ({
        squadId: safe,
        taskId,
        releaseAt: releaseAt as string,
      }));
    if (baselineRows.length > 0) {
      await tx.taskEstimatedBaseline.createMany({ data: baselineRows });
    }

    const remarkRows = needRemark.filter((taskId) => taskIds.has(taskId)).map((taskId) => ({
      squadId: safe,
      taskId,
    }));
    if (remarkRows.length > 0) {
      await tx.taskNeedRemark.createMany({ data: remarkRows });
    }

    const orderRows = dashboardOrder
      .map((taskId, position) => ({ squadId: safe, taskId, position }))
      .filter((row) => taskIds.has(row.taskId));
    if (orderRows.length > 0) {
      await tx.dashboardTaskOrder.createMany({ data: orderRows });
    }
  },
    { maxWait: 20_000, timeout: 120_000 },
  );

  return { updatedAt: writtenUpdatedAt };
}

export async function deleteSquadPlannerState(squadId: string): Promise<void> {
  const safe = sanitizeSquadKey(squadId);
  if (!safe) return;
  await prisma.$transaction([
    prisma.task.deleteMany({ where: { squadId: safe } }),
    prisma.resource.deleteMany({ where: { squadId: safe } }),
    prisma.squadHoliday.deleteMany({ where: { squadId: safe } }),
    prisma.plannerMeta.deleteMany({ where: { squadId: safe } }),
    prisma.sprintConfig.deleteMany({ where: { squadId: safe } }),
  ]);
}
