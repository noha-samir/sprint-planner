import { technicalTaskDevOwners } from "@/lib/planner/resourceIdentity";
import { totalWorkingHoursForSprint } from "./calendar";
import { isUtilizationExcludedStatus, resolveUtilizationEffort } from "./utilizationEffort";
import type { Config, Resource, ScheduleResult, Task } from "./types";
import { SQUAD_CAPACITY_HOURS_MAX } from "./types";

export interface ResourceUtilization {
  name: string;
  type: Resource["type"];
  assignedOurSquadHours: number;
  takenHours: number;
  remainingHours: number;
  utilizationPct: number;
  overloaded: boolean;
}

export interface ResourceUtilizationByOrigin {
  name: string;
  type: Resource["type"];
  newSprintTakenHours: number;
  carryOverTakenHours: number;
}

export interface SquadUtilizationTotals {
  integrationHours: number;
  bufferHours: number;
  totalHours: number;
}

export interface SprintTaskUtilization {
  perMember: ResourceUtilization[];
  perMemberByOrigin: ResourceUtilizationByOrigin[];
  squadTotals: SquadUtilizationTotals;
}

const resourceKey = (type: Resource["type"], name: string) => `${type}::${name}`;

const defaultMemberCapacity = (config: Config) =>
  Math.min(SQUAD_CAPACITY_HOURS_MAX, totalWorkingHoursForSprint(config));

export const resolveOurSquadHours = (resource: Resource, totalWorkingHours: number): number => {
  if (resource.ownershipMode === "fullyMine") {
    return totalWorkingHours;
  }
  if (resource.ourSquadHours !== undefined) {
    return Math.max(0, Math.min(totalWorkingHours, resource.ourSquadHours));
  }
  if (resource.capacityHours !== undefined) {
    return Math.max(0, Math.min(totalWorkingHours, resource.capacityHours));
  }
  return totalWorkingHours;
};

export const resolveOtherSquadsHours = (totalWorkingHours: number, ourSquadHours: number): number =>
  Math.max(0, totalWorkingHours - ourSquadHours);

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

const addAllocatedHours = (
  allocatedMap: Map<string, number>,
  type: Resource["type"],
  name: string,
  hours: number,
) => {
  allocatedMap.set(resourceKey(type, name), (allocatedMap.get(resourceKey(type, name)) ?? 0) + hours);
};

const roleHoursForUtilization = (effort: ReturnType<typeof resolveUtilizationEffort>): number =>
  effort.feHours +
  effort.beHours +
  effort.androidHours +
  effort.iosHours +
  effort.qcHours +
  effort.integrationHours +
  effort.bufferHours;

export const computeUtilization = (
  resources: Resource[],
  scheduleResult: ScheduleResult,
  config: Config,
): ResourceUtilization[] => {
  const allocatedMap = new Map<string, number>();

  scheduleResult.tasks.forEach((task) => {
    task.feBlocks.forEach((block) => addAllocatedHours(allocatedMap, "FE", block.resourceName, block.hours));
    task.beBlocks.forEach((block) => addAllocatedHours(allocatedMap, "BE", block.resourceName, block.hours));
    (task.androidBlocks ?? []).forEach((block) =>
      addAllocatedHours(allocatedMap, "MO", block.resourceName, block.hours),
    );
    (task.iosBlocks ?? []).forEach((block) =>
      addAllocatedHours(allocatedMap, "MO", block.resourceName, block.hours),
    );
    task.qcBlocks.forEach((block) => addAllocatedHours(allocatedMap, "QC", block.resourceName, block.hours));
  });

  const fallbackCapacity = defaultMemberCapacity(config);
  return resources.map((resource) => {
    const takenHours = allocatedMap.get(resourceKey(resource.type, resource.name)) ?? 0;
    const assignedOurSquadHours = resolveOurSquadHours(resource, fallbackCapacity);
    const remainingHours = Math.max(0, assignedOurSquadHours - takenHours);
    const utilizationPct =
      assignedOurSquadHours > 0 ? Math.min(999, Math.round((takenHours / assignedOurSquadHours) * 100)) : 0;
    return {
      name: resource.name,
      type: resource.type,
      assignedOurSquadHours,
      takenHours,
      remainingHours,
      utilizationPct,
      overloaded: takenHours > assignedOurSquadHours,
    };
  });
};

/**
 * Per-person Taken hours for the current sprint from remaining task effort (next-sprint and UAT/shipped stories skipped).
 * Hours split evenly across each role's assignees; a Technical Task's Dev hours split evenly across its Jira
 * developers (FE/BE subtask assignees, else the issue assignee).
 * @returns Taken / remaining per roster person, the same split by new vs carried stories, and squad buffer/integration totals.
 */
export const computeSprintUtilizationFromTasks = (
  tasks: Task[],
  resources: Resource[],
  config: Config,
): SprintTaskUtilization => {
  const allocatedMap = new Map<string, number>();
  const newSprintMap = new Map<string, number>();
  const carryOverMap = new Map<string, number>();
  let integrationHours = 0;
  let bufferHours = 0;

  const allocateTaskHours = (
    map: Map<string, number>,
    type: Resource["type"],
    assignees: string[],
    hours: number,
  ) => {
    splitHours(hours, assignees.length).forEach((chunk, index) => {
      addAllocatedHours(map, type, assignees[index], chunk);
    });
  };

  tasks
    .filter((task) => !task.carryToNextSprint && !isUtilizationExcludedStatus(task.status))
    .forEach((task) => {
      const remaining = resolveUtilizationEffort(task);
      const androidAssignees = resolveAssignees(task.androidDevs, "Unassigned-MO");
      const iosAssignees = resolveAssignees(task.iosDevs, "Unassigned-MO");
      const qcAssignees = resolveAssignees(task.qcs, "Unassigned-QC");
      const originMap = task.carriedFromPreviousSprint ? carryOverMap : newSprintMap;
      const technicalOwners = technicalTaskDevOwners(task, resources);
      const technicalDevChunks = splitHours(remaining.feHours + remaining.beHours, technicalOwners.length);

      for (const map of [originMap, allocatedMap]) {
        if (technicalOwners.length > 0) {
          technicalOwners.forEach((owner, index) =>
            addAllocatedHours(map, owner.type, owner.name, technicalDevChunks[index]),
          );
        } else {
          allocateTaskHours(map, "FE", resolveAssignees(task.feDevs, "Unassigned-FE"), remaining.feHours);
          allocateTaskHours(map, "BE", resolveAssignees(task.beDevs, "Unassigned-BE"), remaining.beHours);
        }
        allocateTaskHours(map, "MO", androidAssignees, remaining.androidHours);
        allocateTaskHours(map, "MO", iosAssignees, remaining.iosHours);
        allocateTaskHours(map, "QC", qcAssignees, remaining.qcHours);
      }

      integrationHours += remaining.integrationHours;
      bufferHours += remaining.bufferHours;
    });

  const fallbackCapacity = defaultMemberCapacity(config);
  const perMember = resources.map((resource) => {
    const key = resourceKey(resource.type, resource.name);
    const takenHours = allocatedMap.get(key) ?? 0;
    const assignedOurSquadHours = resolveOurSquadHours(resource, fallbackCapacity);
    const remainingHours = Math.max(0, assignedOurSquadHours - takenHours);
    const utilizationPct =
      assignedOurSquadHours > 0 ? Math.min(999, Math.round((takenHours / assignedOurSquadHours) * 100)) : 0;
    return {
      name: resource.name,
      type: resource.type,
      assignedOurSquadHours,
      takenHours,
      remainingHours,
      utilizationPct,
      overloaded: takenHours > assignedOurSquadHours,
    };
  });

  const perMemberByOrigin = resources.map((resource) => {
    const key = resourceKey(resource.type, resource.name);
    return {
      name: resource.name,
      type: resource.type,
      newSprintTakenHours: newSprintMap.get(key) ?? 0,
      carryOverTakenHours: carryOverMap.get(key) ?? 0,
    };
  });

  return {
    perMember,
    perMemberByOrigin,
    squadTotals: {
      integrationHours,
      bufferHours,
      totalHours: integrationHours + bufferHours,
    },
  };
};

export const sumPersonUtilizationRoleHours = (effort: ReturnType<typeof resolveUtilizationEffort>): number =>
  roleHoursForUtilization(effort);
