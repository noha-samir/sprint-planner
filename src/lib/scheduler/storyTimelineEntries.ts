import { effectiveIosHours } from "./mobilePlatform";
import type { StoryPhase } from "./currentPhase";
import type { ScheduledTask } from "./types";

export type StoryTimelinePhase = "BE" | "FE" | "Android" | "IOS" | "Integration" | "QC" | "Buffer";

export interface StoryTimelineEntry {
  key: string;
  phase: StoryTimelinePhase;
  resourceName: string;
  start: Date | null;
  end: Date | null;
  /** Working hours for this slice (estimated / scheduled), not calendar span. */
  hours?: number;
  /** Past phase kept visible after status advanced past it (no remaining schedule). */
  completed?: boolean;
}

/** Planned hours/assignees from the source task — used to keep earlier steps on the flow. */
export type StoryPhasePlan = {
  beHours: number;
  feHours: number;
  androidHours: number;
  iosHours: number;
  integrationHours: number;
  qcHours: number;
  bufferHours: number;
  beDevs: string[];
  feDevs: string[];
  androidDevs: string[];
  iosDevs: string[];
  qcs: string[];
};

export const storyPhasePlanFromTask = (task: {
  beHours: number;
  feHours: number;
  androidHours?: number;
  iosHours?: number;
  needsIos?: boolean;
  integrationHours: number;
  qcHours: number;
  bufferHours?: number | null;
  beDevs: string[];
  feDevs: string[];
  androidDevs?: string[];
  iosDevs?: string[];
  qcs: string[];
}): StoryPhasePlan => ({
  beHours: task.beHours,
  feHours: task.feHours,
  androidHours: task.androidHours ?? 0,
  iosHours: effectiveIosHours({
    androidHours: task.androidHours ?? 0,
    iosHours: task.iosHours ?? 0,
    needsIos: Boolean(task.needsIos),
  }),
  integrationHours: task.integrationHours,
  qcHours: task.qcHours,
  bufferHours: task.bufferHours ?? 0,
  beDevs: task.beDevs,
  feDevs: task.feDevs,
  androidDevs: task.androidDevs ?? [],
  iosDevs: task.needsIos ? (task.iosDevs ?? []) : [],
  qcs: task.qcs,
});

const PHASE_FLOW_ORDER: StoryTimelinePhase[] = [
  "BE",
  "FE",
  "Android",
  "IOS",
  "Integration",
  "QC",
  "Buffer",
];

const asDate = (value: Date | string): Date => (value instanceof Date ? value : new Date(value));

const phaseRank = (phase: StoryPhase | null | undefined): number => {
  if (!phase || phase === "None") {
    return -1;
  }
  if (phase === "UAT" || phase === "Released") {
    return PHASE_FLOW_ORDER.indexOf("Buffer");
  }
  return PHASE_FLOW_ORDER.indexOf(phase as StoryTimelinePhase);
};

/**
 * Flatten scheduled blocks into a single chronological list for timeline UI.
 */
export const buildStoryTimelineEntries = (task: ScheduledTask): StoryTimelineEntry[] => {
  const entries: StoryTimelineEntry[] = [
    ...task.beBlocks.map<StoryTimelineEntry>((block) => ({
      key: `be-${task.id}-${block.resourceName}-${asDate(block.start).toISOString()}`,
      phase: "BE",
      resourceName: block.resourceName,
      start: asDate(block.start),
      end: asDate(block.end),
      hours: block.hours,
    })),
    ...task.feBlocks.map<StoryTimelineEntry>((block) => ({
      key: `fe-${task.id}-${block.resourceName}-${asDate(block.start).toISOString()}`,
      phase: "FE",
      resourceName: block.resourceName,
      start: asDate(block.start),
      end: asDate(block.end),
      hours: block.hours,
    })),
    ...(task.androidBlocks ?? []).map<StoryTimelineEntry>((block) => ({
      key: `android-${task.id}-${block.resourceName}-${asDate(block.start).toISOString()}`,
      phase: "Android",
      resourceName: block.resourceName,
      start: asDate(block.start),
      end: asDate(block.end),
      hours: block.hours,
    })),
    ...(task.iosBlocks ?? []).map<StoryTimelineEntry>((block) => ({
      key: `ios-${task.id}-${block.resourceName}-${asDate(block.start).toISOString()}`,
      phase: "IOS",
      resourceName: block.resourceName,
      start: asDate(block.start),
      end: asDate(block.end),
      hours: block.hours,
    })),
    ...(task.integrationStart && task.integrationEnd
      ? [
          {
            key: `integration-${task.id}-${asDate(task.integrationStart).toISOString()}`,
            phase: "Integration" as const,
            resourceName: "System",
            start: asDate(task.integrationStart),
            end: asDate(task.integrationEnd),
          },
        ]
      : []),
    ...task.qcBlocks.map<StoryTimelineEntry>((block) => ({
      key: `qc-${task.id}-${block.resourceName}-${asDate(block.start).toISOString()}`,
      phase: "QC",
      resourceName: block.resourceName,
      start: asDate(block.start),
      end: asDate(block.end),
      hours: block.hours,
    })),
    ...(task.bufferStart &&
    task.bufferEnd &&
    asDate(task.bufferEnd).getTime() > asDate(task.bufferStart).getTime()
      ? [
          {
            key: `buffer-${task.id}-${asDate(task.bufferStart).toISOString()}`,
            phase: "Buffer" as const,
            resourceName: "",
            start: asDate(task.bufferStart),
            end: asDate(task.bufferEnd),
          },
        ]
      : []),
  ];

  return entries.sort((a, b) => {
    const aTime = a.start?.getTime() ?? 0;
    const bTime = b.start?.getTime() ?? 0;
    return aTime - bTime;
  });
};

/**
 * Merge back-to-back slices of the same phase (e.g. QC across multiple days).
 */
export const mergeAdjacentTimelineEntries = (entries: StoryTimelineEntry[]): StoryTimelineEntry[] => {
  if (entries.length <= 1) {
    return entries;
  }

  const merged: StoryTimelineEntry[] = [{ ...entries[0] }];

  for (let index = 1; index < entries.length; index += 1) {
    const current = entries[index];
    const previous = merged[merged.length - 1];

    if (
      previous.phase === current.phase &&
      previous.resourceName === current.resourceName &&
      previous.start &&
      previous.end &&
      current.start &&
      current.end
    ) {
      previous.end = previous.end.getTime() >= current.end.getTime() ? previous.end : current.end;
      if (current.start.getTime() < previous.start.getTime()) {
        previous.start = current.start;
      }
      previous.hours = (previous.hours ?? 0) + (current.hours ?? 0);
      previous.key = `${previous.key}__${current.key}`;
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
};

/**
 * Chronological timeline entries with adjacent same-phase slices collapsed.
 */
export const buildMergedStoryTimelineEntries = (task: ScheduledTask): StoryTimelineEntry[] =>
  mergeAdjacentTimelineEntries(buildStoryTimelineEntries(task));

const planHoursForPhase = (plan: StoryPhasePlan, phase: StoryTimelinePhase): number => {
  switch (phase) {
    case "BE":
      return plan.beHours;
    case "FE":
      return plan.feHours;
    case "Android":
      return plan.androidHours ?? 0;
    case "IOS":
      return plan.iosHours ?? 0;
    case "Integration":
      return plan.integrationHours;
    case "QC":
      return plan.qcHours;
    case "Buffer":
      return plan.bufferHours;
    default:
      return 0;
  }
};

const planAssigneesForPhase = (plan: StoryPhasePlan, phase: StoryTimelinePhase): string => {
  switch (phase) {
    case "BE":
      return plan.beDevs.join(", ");
    case "FE":
      return plan.feDevs.join(", ");
    case "Android":
      return (plan.androidDevs ?? []).join(", ");
    case "IOS":
      return (plan.iosDevs ?? []).join(", ");
    case "Integration":
      return "System";
    case "QC":
      return plan.qcs.join(", ");
    case "Buffer":
      return "";
    default:
      return "";
  }
};

/**
 * Collapse every scheduled slice for one phase into a single flow box.
 * Preemption can split BE/FE across gaps with another phase between them in
 * chronological order; the story flow still shows one step per discipline.
 */
const collapsePhaseSchedule = (
  phase: StoryTimelinePhase,
  scheduled: StoryTimelineEntry[],
  plan: StoryPhasePlan,
  taskId: string,
): StoryTimelineEntry | null => {
  if (scheduled.length === 0) {
    return null;
  }

  const planHours = planHoursForPhase(plan, phase);
  const scheduledHours = scheduled.reduce((sum, entry) => sum + (entry.hours ?? 0), 0);
  const resources = [
    ...new Set(
      scheduled
        .map((entry) => entry.resourceName.trim())
        .filter(Boolean)
        .flatMap((name) => name.split(",").map((part) => part.trim()).filter(Boolean)),
    ),
  ];
  const dated = scheduled.filter((entry) => entry.start && entry.end);
  const start =
    dated.length > 0
      ? dated.reduce(
          (min, entry) => (entry.start!.getTime() < min.getTime() ? entry.start! : min),
          dated[0].start!,
        )
      : null;
  const end =
    dated.length > 0
      ? dated.reduce(
          (max, entry) => (entry.end!.getTime() > max.getTime() ? entry.end! : max),
          dated[0].end!,
        )
      : null;

  return {
    key: `flow-${phase}-${taskId}`,
    phase,
    resourceName: resources.length > 0 ? resources.join(", ") : planAssigneesForPhase(plan, phase),
    start,
    end,
    // Prefer the story estimate so preempted slices (8h + 16h) never look like 24h of two steps.
    hours: planHours > 0 ? planHours : scheduledHours,
  };
};

/**
 * Timeline flow entries that keep earlier planned phases visible when status
 * advances (e.g. Ready for Testing → QC) so the current step can be bordered
 * without deleting prior steps.
 */
export const buildStoryPhaseFlowEntries = (
  task: ScheduledTask,
  plan: StoryPhasePlan,
  currentPhase: StoryPhase | null = null,
): StoryTimelineEntry[] => {
  const scheduledByPhase = new Map<StoryTimelinePhase, StoryTimelineEntry[]>();
  buildMergedStoryTimelineEntries(task).forEach((entry) => {
    const list = scheduledByPhase.get(entry.phase) ?? [];
    list.push(entry);
    scheduledByPhase.set(entry.phase, list);
  });

  const currentRank = phaseRank(currentPhase);
  const entries: StoryTimelineEntry[] = [];

  PHASE_FLOW_ORDER.forEach((phase) => {
    const hours = planHoursForPhase(plan, phase);
    const scheduled = scheduledByPhase.get(phase) ?? [];
    const phaseIndex = PHASE_FLOW_ORDER.indexOf(phase);
    const isPast = currentRank >= 0 && phaseIndex < currentRank;
    const collapsed = collapsePhaseSchedule(phase, scheduled, plan, task.id);

    if (collapsed) {
      entries.push({
        ...collapsed,
        completed: isPast ? true : collapsed.completed,
      });
      return;
    }

    // Keep planned boxes for past/current/future — never drop earlier steps when
    // the schedule starts mid-flow; only the current phase is bordered in the UI.
    if (hours <= 0) {
      return;
    }

    entries.push({
      key: `planned-${phase}-${task.id}`,
      phase,
      resourceName: planAssigneesForPhase(plan, phase),
      start: null,
      end: null,
      hours,
      completed: isPast,
    });
  });

  return entries;
};
