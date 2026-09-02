import type { Config } from "./types";

export const DEV_HOURS_PER_DAY = 6;
export const PREP_HOURS_PER_DAY = 2;

export const devHoursRatio = (hoursPerDay: number): number =>
  hoursPerDay > 0 ? DEV_HOURS_PER_DAY / hoursPerDay : 0.75;

export const prepHoursRatio = (hoursPerDay: number): number =>
  hoursPerDay > 0 ? PREP_HOURS_PER_DAY / hoursPerDay : 0.25;

export const devCapacityFromAssignedHours = (assignedOurSquadHours: number, hoursPerDay: number): number =>
  assignedOurSquadHours * devHoursRatio(hoursPerDay);

export const prepCapacityFromAssignedHours = (assignedOurSquadHours: number, hoursPerDay: number): number =>
  assignedOurSquadHours * prepHoursRatio(hoursPerDay);

export const sprintCapacityBreakdown = (config: Config, sprintWorkingDays: number, totalWorkingHours: number) => {
  const devHours = sprintWorkingDays * DEV_HOURS_PER_DAY;
  const prepHours = sprintWorkingDays * PREP_HOURS_PER_DAY;
  const devFromAssigned = (assigned: number) => devCapacityFromAssignedHours(assigned, config.hoursPerDay);
  const prepFromAssigned = (assigned: number) => prepCapacityFromAssignedHours(assigned, config.hoursPerDay);
  return {
    sprintWorkingDays,
    hoursPerDay: config.hoursPerDay,
    totalWorkingHours,
    devHours,
    prepHours,
    devFromAssigned,
    prepFromAssigned,
  };
};

export const capacityDayBreakdownCopy = (hoursPerDay: number): string =>
  `Each working day = ${hoursPerDay}h total: ${DEV_HOURS_PER_DAY}h dev (story work) + ${PREP_HOURS_PER_DAY}h preparations (meetings, planning, standups).`;
