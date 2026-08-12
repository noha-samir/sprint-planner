import {
  advanceByWorkingHours,
  getProductionReleaseDateFrom,
  getScheduleEpoch,
  getSprintWindowEnd,
  nextWorkingStart,
  parseCalendarDate,
  resolveUatReleaseDate,
} from "./calendar";
import { resolveRemainingEffort, type RemainingEffort } from "./remainingEffort";
import { effectiveIosHours } from "./mobilePlatform";
import { alignReleaseGroups, normalizeReleaseGroup } from "./releaseGroups";
import { isExcludedFromSchedule, isTodoTaskStatus } from "./taskStatus";
import { effectiveReplanFromStep } from "./statusReplan";

import type {
  Config,
  ReleaseStrategy,
  Resource,
  ScheduleResult,
  ScheduledBlock,
  ScheduledTask,
  Task,
  ThursdayReleaseScope,
} from "./types";

const resolveThursdayReleaseScope = (
  uatReleaseDate: Date | null,
  productionReleaseDate: Date | null,
): ThursdayReleaseScope => {
  const uatThu = uatReleaseDate != null && uatReleaseDate.getDay() === 4;
  const prodThu = productionReleaseDate != null && productionReleaseDate.getDay() === 4;
  if (uatThu && prodThu) return "both";
  if (uatThu) return "uat";
  if (prodThu) return "production";
  return "none";
};

const PRIMARY_RELEASE_EPS_MS = 60_000;

type ScheduleEstimate = {
  lastReleaseTime: number;
  releaseCurvePenalty: number;
};

const resolveReleaseStrategy = (config: Config): ReleaseStrategy =>
  config.releaseStrategy ?? "earliestStoriesFirst";

const computeReleaseCurvePenalty = (releaseTimesMs: number[]): number => {
  if (releaseTimesMs.length === 0) return 0;
  const sorted = [...releaseTimesMs].sort((a, b) => a - b);
  const k = sorted.length;
  let penalty = 0;
  for (let index = 0; index < k; index += 1) {
    penalty += (k - index) * sorted[index];
  }
  return penalty;
};

const compareScheduleEstimates = (next: ScheduleEstimate, best: ScheduleEstimate, strategy: ReleaseStrategy): number => {
  const primaryDiff = next.lastReleaseTime - best.lastReleaseTime;
  if (Math.abs(primaryDiff) > PRIMARY_RELEASE_EPS_MS) {
    return primaryDiff;
  }
  if (strategy === "latestReleaseOnly") {
    return 0;
  }
  return next.releaseCurvePenalty - best.releaseCurvePenalty;
};

const bufferHours = (task: Task) => task.bufferHours ?? 0;

const weightTask = (task: Task) =>
  Math.max(task.feHours, task.beHours, task.androidHours ?? 0, effectiveIosHours(task)) +
  task.integrationHours +
  task.qcHours +
  bufferHours(task);

const maxOfEnds = (epoch: Date, ...ends: Array<Date | null>): Date => {
  const valid = ends.filter((value): value is Date => value != null);
  if (valid.length === 0) return new Date(epoch);
  return valid.reduce((latest, current) => (current > latest ? current : latest));
};

const resolveMobileReadyAt = (task: Task, epoch: Date, config: Config): Date => {
  const raw = typeof task.moStartDate === "string" ? task.moStartDate.trim() : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(epoch);
  }
  return nextWorkingStart(parseCalendarDate(raw), config);
};
const hasPoPriority = (task: Task) => task.poPriority !== null;

const splitHours = (hours: number, assigneesCount: number): number[] => {
  if (assigneesCount <= 0) {
    return [];
  }
  const base = Math.floor((hours / assigneesCount) * 100) / 100;
  const chunks = Array(assigneesCount).fill(base);
  const total = chunks.reduce((sum, chunk) => sum + chunk, 0);
  chunks[chunks.length - 1] += Math.round((hours - total) * 100) / 100;
  return chunks;
};

const resolveAssignees = (assignees: string[] | undefined, fallback: string): string[] =>
  assignees && assignees.length > 0 ? assignees : [fallback];

type DisciplineWorkItem = {
  taskId: string;
  assignee: string;
  remainingHours: number;
  readyAt: Date;
  poPriority: number | null;
  orderIndex: number;
};

const PREEMPTION_QUANTUM_HOURS = 1;

const compareWorkItems = (left: DisciplineWorkItem, right: DisciplineWorkItem): number => {
  const leftRank = left.poPriority ?? Number.MAX_SAFE_INTEGER;
  const rightRank = right.poPriority ?? Number.MAX_SAFE_INTEGER;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if (left.orderIndex !== right.orderIndex) return left.orderIndex - right.orderIndex;
  return left.taskId.localeCompare(right.taskId);
};

const scheduleWorkItems = (
  workItems: DisciplineWorkItem[],
  availability: Map<string, Date>,
  config: Config,
): Map<string, ScheduledBlock[]> => {
  const blocksByTaskId = new Map<string, ScheduledBlock[]>();
  if (workItems.length === 0) return blocksByTaskId;

  const grouped = new Map<string, DisciplineWorkItem[]>();
  workItems.forEach((item) => {
    const existing = grouped.get(item.assignee) ?? [];
    existing.push({ ...item });
    grouped.set(item.assignee, existing);
  });

  grouped.forEach((items, assignee) => {
    let cursor = availability.get(assignee) ?? getScheduleEpoch(config);
    while (items.some((item) => item.remainingHours > 0)) {
      const normalizedCursor = nextWorkingStart(cursor, config);
      const eligible = items
        .filter((item) => item.remainingHours > 0 && item.readyAt.getTime() <= normalizedCursor.getTime())
        .sort(compareWorkItems);

      if (eligible.length === 0) {
        const pending = items.filter((item) => item.remainingHours > 0);
        const [firstPending, ...restPending] = pending;
        const nextReady = restPending.reduce(
          (minimum, item) => (item.readyAt.getTime() < minimum.getTime() ? item.readyAt : minimum),
          firstPending.readyAt,
        );
        cursor = nextWorkingStart(nextReady, config);
        continue;
      }

      const chosen = eligible[0];
      const slice = Math.min(PREEMPTION_QUANTUM_HOURS, chosen.remainingHours);
      const start = normalizedCursor;
      const end = advanceByWorkingHours(start, slice, config);
      chosen.remainingHours = Math.max(0, chosen.remainingHours - slice);
      cursor = end;

      const list = blocksByTaskId.get(chosen.taskId) ?? [];
      const last = list[list.length - 1];
      if (
        last &&
        last.resourceName === assignee &&
        last.end.getTime() === start.getTime()
      ) {
        last.end = end;
        last.hours += slice;
      } else {
        list.push({ resourceName: assignee, start, end, hours: slice });
      }
      blocksByTaskId.set(chosen.taskId, list);
    }
    availability.set(assignee, cursor);
  });

  return blocksByTaskId;
};

const scheduleDiscipline = (
  assignees: string[],
  totalHours: number,
  availability: Map<string, Date>,
  config: Config,
): ScheduledBlock[] => {
  if (totalHours <= 0 || assignees.length === 0) {
    return [];
  }
  const chunks = splitHours(totalHours, assignees.length);

  return assignees.map((name, index) => {
    const start = availability.get(name) ?? getScheduleEpoch(config);
    const normalizedStart = nextWorkingStart(start, config);
    const end = advanceByWorkingHours(normalizedStart, chunks[index], config);
    availability.set(name, end);
    return { resourceName: name, start: normalizedStart, end, hours: chunks[index] };
  });
};

const maxEnd = (blocks: ScheduledBlock[]): Date | null => {
  if (!blocks.length) {
    return null;
  }
  return blocks.reduce((max, item) => (item.end > max ? item.end : max), blocks[0].end);
};

const minStart = (blocks: ScheduledBlock[]): Date | null => {
  if (!blocks.length) {
    return null;
  }
  return blocks.reduce((min, item) => (item.start < min ? item.start : min), blocks[0].start);
};

/** Buffer runs after QC when present; otherwise from replan epoch (e.g. Mark Progress from Buffer step). */
const resolveBufferWindow = (
  qcEnd: Date | null,
  bufferHoursRemaining: number,
  config: Config,
): { bufferStart: Date | null; bufferEnd: Date | null } => {
  if (bufferHoursRemaining <= 0) {
    return { bufferStart: qcEnd, bufferEnd: qcEnd };
  }
  const bufferStart = qcEnd ?? nextWorkingStart(getScheduleEpoch(config), config);
  return {
    bufferStart,
    bufferEnd: advanceByWorkingHours(bufferStart, bufferHoursRemaining, config),
  };
};

const estimateScheduleMetrics = (orderedTasks: Task[], resources: Resource[], config: Config): ScheduleEstimate => {
  const feAvailability = new Map<string, Date>();
  const beAvailability = new Map<string, Date>();
  const androidAvailability = new Map<string, Date>();
  const iosAvailability = new Map<string, Date>();
  const qcAvailability = new Map<string, Date>();

  const epoch = getScheduleEpoch(config);
  resources.forEach((resource) => {
    if (resource.type === "FE") feAvailability.set(resource.name, new Date(epoch));
    if (resource.type === "BE") beAvailability.set(resource.name, new Date(epoch));
    if (resource.type === "MO") {
      androidAvailability.set(resource.name, new Date(epoch));
      iosAvailability.set(resource.name, new Date(epoch));
    }
    if (resource.type === "QC") qcAvailability.set(resource.name, new Date(epoch));
  });

  let lastReleaseTime = epoch.getTime();
  const releaseTimesMs: number[] = [];

  orderedTasks.forEach((task) => {
    if (isExcludedFromSchedule(task.status)) {
      return;
    }
    const remaining = resolveRemainingEffort(task);

    const feAssignees = resolveAssignees(task.feDevs, "Unassigned-FE");
    const beAssignees = resolveAssignees(task.beDevs, "Unassigned-BE");
    const androidAssignees = resolveAssignees(task.androidDevs, "Unassigned-MO");
    const iosAssignees = resolveAssignees(task.iosDevs, "Unassigned-MO");
    const qcAssignees = resolveAssignees(task.qcs, "Unassigned-QC");

    const feBlocks = scheduleDiscipline(feAssignees, remaining.feHours, feAvailability, config);
    const beBlocks = scheduleDiscipline(beAssignees, remaining.beHours, beAvailability, config);
    // Estimator ignores moStartDate gating for speed (same as non-preemptive approx).
    const androidBlocks = scheduleDiscipline(
      androidAssignees,
      remaining.androidHours,
      androidAvailability,
      config,
    );
    const iosBlocks = scheduleDiscipline(iosAssignees, remaining.iosHours, iosAvailability, config);
    const feEnd = maxEnd(feBlocks);
    const beEnd = maxEnd(beBlocks);
    const androidEnd = maxEnd(androidBlocks);
    const iosEnd = maxEnd(iosBlocks);
    const devEnd = maxOfEnds(epoch, feEnd, beEnd, androidEnd, iosEnd);
    const integrationStart = remaining.integrationHours > 0 ? devEnd : null;
    const integrationEnd = integrationStart ? advanceByWorkingHours(integrationStart, remaining.integrationHours, config) : devEnd;

    qcAssignees.forEach((name) => {
      const existing = qcAvailability.get(name) ?? new Date(epoch);
      if (existing < integrationEnd) {
        qcAvailability.set(name, integrationEnd);
      }
    });

    const qcBlocks = scheduleDiscipline(qcAssignees, remaining.qcHours, qcAvailability, config);
    const qcEnd = maxEnd(qcBlocks);
    const { bufferEnd: bufferedEnd } = resolveBufferWindow(qcEnd, remaining.bufferHours, config);
    const uatReleaseDate = bufferedEnd ? resolveUatReleaseDate(bufferedEnd, config) : null;
    if (uatReleaseDate) {
      const releaseMs = uatReleaseDate.getTime();
      lastReleaseTime = Math.max(lastReleaseTime, releaseMs);
      releaseTimesMs.push(releaseMs);
    }
  });

  return {
    lastReleaseTime,
    releaseCurvePenalty: computeReleaseCurvePenalty(releaseTimesMs),
  };
};

const mergeNonPoOrder = (nonPo: Task[], chosenTodoPrefix: Task[], tailTodosSorted: Task[]): Task[] => {
  const queue = [...chosenTodoPrefix, ...tailTodosSorted];
  return nonPo.map((task) => (isTodoTaskStatus(task.status) ? (queue.shift() as Task) : task));
};

const buildPlannedOrder = (tasks: Task[], resources: Resource[], config: Config): Task[] => {
  const strategy = resolveReleaseStrategy(config);
  const replannedFront = tasks.filter(
    (task) =>
      effectiveReplanFromStep(task) !== "Start" &&
      !isExcludedFromSchedule(task.status),
  );
  const replannedFrontIds = new Set(replannedFront.map((task) => task.id));
  const remainingTasks = tasks.filter((task) => !replannedFrontIds.has(task.id));
  const prioritized = tasks
    .filter((task) => !replannedFrontIds.has(task.id) && hasPoPriority(task))
    .sort((a, b) => {
      const rankDelta = (a.poPriority ?? 0) - (b.poPriority ?? 0);
      if (rankDelta !== 0) return rankDelta;
      return weightTask(a) - weightTask(b);
    });

  const nonPo = remainingTasks.filter((task) => !hasPoPriority(task));
  const orderedPrefix = [...replannedFront, ...prioritized];

  if (strategy === "latestReleaseOnly") {
    const orderedOut = [...orderedPrefix];
    let remaining = [...nonPo];
    while (remaining.length > 0) {
      let bestIndex = 0;
      let bestMetrics = estimateScheduleMetrics(
        [
          ...orderedOut,
          remaining[0],
          ...remaining.slice(1).sort((a, b) => weightTask(a) - weightTask(b)),
        ],
        resources,
        config,
      );
      remaining.forEach((candidate, index) => {
        const tail = remaining
          .filter((_, idx) => idx !== index)
          .sort((a, b) => weightTask(a) - weightTask(b));
        const metrics = estimateScheduleMetrics([...orderedOut, candidate, ...tail], resources, config);
        if (compareScheduleEstimates(metrics, bestMetrics, "latestReleaseOnly") < 0) {
          bestMetrics = metrics;
          bestIndex = index;
        }
      });
      orderedOut.push(remaining[bestIndex]);
      remaining = remaining.filter((_, index) => index !== bestIndex);
    }
    return orderedOut;
  }

  const todoReorderable = nonPo.filter((task) => isTodoTaskStatus(task.status));
  const chosenTodoSequence: Task[] = [];
  let remainingTodos = [...todoReorderable];

  while (remainingTodos.length > 0) {
    let bestIndex = 0;
    let bestMetrics = estimateScheduleMetrics(
      [
        ...orderedPrefix,
        ...mergeNonPoOrder(
          nonPo,
          [...chosenTodoSequence, remainingTodos[0]],
          remainingTodos.slice(1).sort((a, b) => weightTask(a) - weightTask(b)),
        ),
      ],
      resources,
      config,
    );
    remainingTodos.forEach((candidate, index) => {
      const tail = remainingTodos
        .filter((_, idx) => idx !== index)
        .sort((a, b) => weightTask(a) - weightTask(b));
      const merged = mergeNonPoOrder(nonPo, [...chosenTodoSequence, candidate], tail);
      const metrics = estimateScheduleMetrics([...orderedPrefix, ...merged], resources, config);
      if (compareScheduleEstimates(metrics, bestMetrics, strategy) < 0) {
        bestMetrics = metrics;
        bestIndex = index;
      }
    });
    chosenTodoSequence.push(remainingTodos[bestIndex]);
    remainingTodos = remainingTodos.filter((_, index) => index !== bestIndex);
  }

  return [...orderedPrefix, ...mergeNonPoOrder(nonPo, chosenTodoSequence, [])];
};

export const schedule = (tasks: Task[], resources: Resource[], config: Config): ScheduleResult => {
  const feAvailability = new Map<string, Date>();
  const beAvailability = new Map<string, Date>();
  const androidAvailability = new Map<string, Date>();
  const iosAvailability = new Map<string, Date>();
  const qcAvailability = new Map<string, Date>();
  const epoch = getScheduleEpoch(config);

  resources.forEach((resource) => {
    if (resource.type === "FE") feAvailability.set(resource.name, new Date(epoch));
    if (resource.type === "BE") beAvailability.set(resource.name, new Date(epoch));
    if (resource.type === "MO") {
      androidAvailability.set(resource.name, new Date(epoch));
      iosAvailability.set(resource.name, new Date(epoch));
    }
    if (resource.type === "QC") qcAvailability.set(resource.name, new Date(epoch));
  });

  const sprintEndDate = getSprintWindowEnd(config);
  const sorted = buildPlannedOrder(tasks, resources, config);
  const taskMetaById = new Map(sorted.map((task) => [task.id, task]));
  const taskOrderIndex = new Map<string, number>(sorted.map((task, index) => [task.id, index]));
  const remainingById = new Map<string, RemainingEffort>();
  const feAssigneesById = new Map<string, string[]>();
  const beAssigneesById = new Map<string, string[]>();
  const androidAssigneesById = new Map<string, string[]>();
  const iosAssigneesById = new Map<string, string[]>();
  const qcAssigneesById = new Map<string, string[]>();

  sorted.forEach((task) => {
    if (isExcludedFromSchedule(task.status)) return;
    remainingById.set(task.id, resolveRemainingEffort(task));
    feAssigneesById.set(task.id, resolveAssignees(task.feDevs, "Unassigned-FE"));
    beAssigneesById.set(task.id, resolveAssignees(task.beDevs, "Unassigned-BE"));
    androidAssigneesById.set(task.id, resolveAssignees(task.androidDevs, "Unassigned-MO"));
    iosAssigneesById.set(task.id, resolveAssignees(task.iosDevs, "Unassigned-MO"));
    qcAssigneesById.set(task.id, resolveAssignees(task.qcs, "Unassigned-QC"));
  });

  const feWorkItems: DisciplineWorkItem[] = [];
  const beWorkItems: DisciplineWorkItem[] = [];
  const androidWorkItems: DisciplineWorkItem[] = [];
  const iosWorkItems: DisciplineWorkItem[] = [];
  sorted.forEach((task) => {
    const remaining = remainingById.get(task.id);
    if (!remaining) return;
    const orderIndex = taskOrderIndex.get(task.id) ?? Number.MAX_SAFE_INTEGER;
    const feAssignees = feAssigneesById.get(task.id) ?? [];
    const feChunks = splitHours(remaining.feHours, feAssignees.length);
    feAssignees.forEach((assignee, index) => {
      if (feChunks[index] <= 0) return;
      feWorkItems.push({
        taskId: task.id,
        assignee,
        remainingHours: feChunks[index],
        readyAt: new Date(epoch),
        poPriority: task.poPriority,
        orderIndex,
      });
    });

    const beAssignees = beAssigneesById.get(task.id) ?? [];
    const beChunks = splitHours(remaining.beHours, beAssignees.length);
    beAssignees.forEach((assignee, index) => {
      if (beChunks[index] <= 0) return;
      beWorkItems.push({
        taskId: task.id,
        assignee,
        remainingHours: beChunks[index],
        readyAt: new Date(epoch),
        poPriority: task.poPriority,
        orderIndex,
      });
    });

    const mobileReadyAt = resolveMobileReadyAt(task, epoch, config);
    const androidAssignees = androidAssigneesById.get(task.id) ?? [];
    const androidChunks = splitHours(remaining.androidHours, androidAssignees.length);
    androidAssignees.forEach((assignee, index) => {
      if (androidChunks[index] <= 0) return;
      androidWorkItems.push({
        taskId: task.id,
        assignee,
        remainingHours: androidChunks[index],
        readyAt: mobileReadyAt,
        poPriority: task.poPriority,
        orderIndex,
      });
    });

    const iosAssignees = iosAssigneesById.get(task.id) ?? [];
    const iosChunks = splitHours(remaining.iosHours, iosAssignees.length);
    iosAssignees.forEach((assignee, index) => {
      if (iosChunks[index] <= 0) return;
      iosWorkItems.push({
        taskId: task.id,
        assignee,
        remainingHours: iosChunks[index],
        readyAt: mobileReadyAt,
        poPriority: task.poPriority,
        orderIndex,
      });
    });
  });

  const feBlocksByTaskId = scheduleWorkItems(feWorkItems, feAvailability, config);
  const beBlocksByTaskId = scheduleWorkItems(beWorkItems, beAvailability, config);
  const androidBlocksByTaskId = scheduleWorkItems(androidWorkItems, androidAvailability, config);
  const iosBlocksByTaskId = scheduleWorkItems(iosWorkItems, iosAvailability, config);

  const integrationByTaskId = new Map<
    string,
    {
      feBlocks: ScheduledBlock[];
      beBlocks: ScheduledBlock[];
      androidBlocks: ScheduledBlock[];
      iosBlocks: ScheduledBlock[];
      feEnd: Date | null;
      beEnd: Date | null;
      androidEnd: Date | null;
      iosEnd: Date | null;
      devEnd: Date;
      integrationStart: Date | null;
      integrationEnd: Date;
    }
  >();

  sorted.forEach((task) => {
    const remaining = remainingById.get(task.id);
    if (!remaining) return;
    const feBlocks = feBlocksByTaskId.get(task.id) ?? [];
    const beBlocks = beBlocksByTaskId.get(task.id) ?? [];
    const androidBlocks = androidBlocksByTaskId.get(task.id) ?? [];
    const iosBlocks = iosBlocksByTaskId.get(task.id) ?? [];
    const feEnd = maxEnd(feBlocks);
    const beEnd = maxEnd(beBlocks);
    const androidEnd = maxEnd(androidBlocks);
    const iosEnd = maxEnd(iosBlocks);
    const devEnd = maxOfEnds(epoch, feEnd, beEnd, androidEnd, iosEnd);
    const integrationStart = remaining.integrationHours > 0 ? devEnd : null;
    const integrationEnd = integrationStart
      ? advanceByWorkingHours(integrationStart, remaining.integrationHours, config)
      : devEnd;
    integrationByTaskId.set(task.id, {
      feBlocks,
      beBlocks,
      androidBlocks,
      iosBlocks,
      feEnd,
      beEnd,
      androidEnd,
      iosEnd,
      devEnd,
      integrationStart,
      integrationEnd,
    });
  });

  const qcWorkItems: DisciplineWorkItem[] = [];
  sorted.forEach((task) => {
    const remaining = remainingById.get(task.id);
    const integration = integrationByTaskId.get(task.id);
    if (!remaining || !integration) return;
    const orderIndex = taskOrderIndex.get(task.id) ?? Number.MAX_SAFE_INTEGER;
    const qcAssignees = qcAssigneesById.get(task.id) ?? [];
    const qcChunks = splitHours(remaining.qcHours, qcAssignees.length);
    qcAssignees.forEach((assignee, index) => {
      if (qcChunks[index] <= 0) return;
      qcWorkItems.push({
        taskId: task.id,
        assignee,
        remainingHours: qcChunks[index],
        readyAt: integration.integrationEnd,
        poPriority: task.poPriority,
        orderIndex,
      });
    });
  });

  const qcBlocksByTaskId = scheduleWorkItems(qcWorkItems, qcAvailability, config);
  const scheduledTasks: ScheduledTask[] = [];

  sorted.forEach((task) => {
    if (isExcludedFromSchedule(task.status)) {
      scheduledTasks.push({
        id: task.id,
        storyName: task.storyName,
        storyLink: task.storyLink,
        poPriority: task.poPriority,
        status: task.status,
        feBlocks: [],
        beBlocks: [],
        androidBlocks: [],
        iosBlocks: [],
        feStart: null,
        feEnd: null,
        beStart: null,
        beEnd: null,
        androidStart: null,
        androidEnd: null,
        iosStart: null,
        iosEnd: null,
        devEnd: null,
        integrationStart: null,
        integrationEnd: null,
        qcBlocks: [],
        qcStart: null,
        qcEnd: null,
        bufferStart: null,
        bufferEnd: null,
        uatReleaseDate: null,
        productionReleaseDate: null,
        releaseDate: null,
        isThursdayRelease: false,
        thursdayReleaseScope: "none",
        isOverflow: false,
        releaseGroup: normalizeReleaseGroup(taskMetaById.get(task.id)?.releaseGroup),
      });
      return;
    }

    const remaining = remainingById.get(task.id) ?? {
      feHours: 0,
      beHours: 0,
      androidHours: 0,
      iosHours: 0,
      integrationHours: 0,
      qcHours: 0,
      bufferHours: 0,
    };
    const integration = integrationByTaskId.get(task.id);
    const feBlocks = integration?.feBlocks ?? [];
    const beBlocks = integration?.beBlocks ?? [];
    const androidBlocks = integration?.androidBlocks ?? [];
    const iosBlocks = integration?.iosBlocks ?? [];
    const feEnd = integration?.feEnd ?? null;
    const beEnd = integration?.beEnd ?? null;
    const androidEnd = integration?.androidEnd ?? null;
    const iosEnd = integration?.iosEnd ?? null;
    const devEnd = integration?.devEnd ?? new Date(epoch);
    const integrationStart = integration?.integrationStart ?? null;
    const integrationEnd = integrationStart ? integration?.integrationEnd ?? null : null;
    const qcBlocks = qcBlocksByTaskId.get(task.id) ?? [];
    const qcEnd = maxEnd(qcBlocks);
    const { bufferStart, bufferEnd } = resolveBufferWindow(qcEnd, remaining.bufferHours, config);
    const uatReleaseDate = bufferEnd != null ? resolveUatReleaseDate(bufferEnd, config) : null;
    const productionReleaseDate = uatReleaseDate ? getProductionReleaseDateFrom(uatReleaseDate, config) : null;
    const thursdayReleaseScope = resolveThursdayReleaseScope(uatReleaseDate, productionReleaseDate);

    scheduledTasks.push({
      id: task.id,
      storyName: task.storyName,
      storyLink: task.storyLink,
      poPriority: task.poPriority,
      status: task.status,
      feBlocks,
      beBlocks,
      androidBlocks,
      iosBlocks,
      feStart: minStart(feBlocks),
      feEnd,
      beStart: minStart(beBlocks),
      beEnd,
      androidStart: minStart(androidBlocks),
      androidEnd,
      iosStart: minStart(iosBlocks),
      iosEnd,
      devEnd,
      integrationStart,
      integrationEnd,
      qcBlocks,
      qcStart: minStart(qcBlocks),
      qcEnd,
      bufferStart,
      bufferEnd,
      uatReleaseDate,
      productionReleaseDate,
      releaseDate: uatReleaseDate,
      isThursdayRelease: thursdayReleaseScope !== "none",
      thursdayReleaseScope,
      isOverflow: uatReleaseDate ? uatReleaseDate > sprintEndDate : false,
      releaseGroup: normalizeReleaseGroup(taskMetaById.get(task.id)?.releaseGroup),
    });
  });

  return {
    tasks: alignReleaseGroups(tasks, scheduledTasks, config, sprintEndDate),
    sprintEndDate,
  };
};
