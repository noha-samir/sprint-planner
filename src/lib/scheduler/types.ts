export type ResourceType = "FE" | "BE" | "MO" | "QC" | "PM" | "OtherSquad";
export type ResourceOwnershipMode = "fullyMine" | "shared";

/** Jira workflow status name (e.g. "To Do", "In Progress", "Testing"). */
export type TaskWorkflowStatus = string;

export type TaskReplanStep = "Start" | "FE" | "Integration" | "QC" | "Buffer";

/** Product flag appended to Android/IOS Jira subtask summaries. */
export type MobileAppFlag = "none" | "star" | "hubs";

export interface Task {
  id: string;
  storyName: string;
  storyLink: string;
  tags?: string[];
  taskNotes?: string;
  poPriority: number | null;
  feDevs: string[];
  feHours: number;
  beDevs: string[];
  beHours: number;
  androidDevs: string[];
  androidHours: number;
  iosDevs: string[];
  iosHours: number;
  /** When false, iOS hours/assignees are ignored for schedule and Jira. */
  needsIos: boolean;
  /** Star / Hubs app marker for mobile Jira subtask titles. */
  mobileApp?: MobileAppFlag;
  /** Optional calendar date (yyyy-MM-dd) when Mobile may start; null = sprint epoch like FE/BE. */
  moStartDate?: string | null;
  integrationHours: number;
  integrationFlags?: {
    needsDevOps: boolean;
    needsCdc: boolean;
    needsDbSync: boolean;
    needsOtherSquad: boolean;
    needsThirdParty: boolean;
  };
  qcs: string[];
  qcHours: number;
  /** Product managers assigned to this story (roster type PM). */
  productManagers?: string[];
  /** Slack after QC before release (working hours, calendar-aware). */
  bufferHours?: number;
  /** Optional checkpoint used by Mark Progress Now to keep only remaining phases. */
  replanFromStep?: TaskReplanStep | null;
  carryToNextSprint?: boolean;
  /** Stories with the same group name release together (latest date in the group). */
  releaseGroup?: string | null;
  status: TaskWorkflowStatus;
  /** Jira issue type label e.g. "Story", "Bug", "Task", "Technical Task". */
  issueType?: string;
  /** True when the Jira story assignee is the squad's Engineering Manager. */
  isEmStory?: boolean;
  /** Sync metadata after pushing subtasks to Jira. */
  jira?: {
    parentIssueKey: string;
    lastPushedAt: string | null;
    lastPulledAt?: string | null;
    subtasks: Array<{
      key: string;
      role: "fe" | "be" | "android" | "ios";
      assigneeName: string;
      hours: number;
    }>;
  };
}

/** Maximum per-resource squad capacity (hours); minimum allowed is 0. */
export const SQUAD_CAPACITY_HOURS_MAX = 80;

export interface Resource {
  name: string;
  /** Short label shown on the dashboard; `name` stays the canonical identity. */
  nickname?: string;
  type: ResourceType;
  /** Ownership mode for sprint allocation between this squad and other squads. */
  ownershipMode?: ResourceOwnershipMode;
  /** Explicit hours assigned to this squad when shared; ignored when fullyMine. */
  ourSquadHours?: number;
  /** Sprint capacity for this member (hours), 0…SQUAD_CAPACITY_HOURS_MAX. Falls back to nominal sprint hours when unset. */
  capacityHours?: number;
}

export type ReleaseStrategy = "earliestStoriesFirst" | "latestReleaseOnly";

/** Which milestone lands on a Thursday (UAT and production can differ after the prod cutoff rule). */
export type ThursdayReleaseScope = "none" | "uat" | "production" | "both";

export function thursdayReleaseChipLabel(scope: ThursdayReleaseScope): string | null {
  switch (scope) {
    case "uat":
      return "Thursday · UAT";
    case "production":
      return "Thursday · Production";
    case "both":
      return "Thursday · UAT & Prod";
    default:
      return null;
  }
}

export function thursdayReleaseSpreadsheetValue(scope: ThursdayReleaseScope): string {
  switch (scope) {
    case "uat":
      return "UAT";
    case "production":
      return "Production";
    case "both":
      return "UAT & Prod";
    default:
      return "";
  }
}

export interface Config {
  sprintStartDate: string;
  /** Anchor date for planning; that day and every 14th day after it are non-working (biweekly planning). */
  planningSunday: string;
  extraHolidays: string[];
  hoursPerDay: number;
  sprintWorkingDays: number;
  theme: "ocean" | "sunset" | "forest";
  /** First productive hour of the workday (local), e.g. 11 after meetings. */
  workdayStartHour?: number;
  /** When set, scheduling uses this instant (ISO) as the availability epoch. */
  replanAsOf?: string | null;
  /**
   * Ordering objective for stories without explicit PO priority.
   * earliestStoriesFirst: minimize last release time, then front-load releases when tied.
   * latestReleaseOnly: legacy behavior — only minimize last release time.
   */
  releaseStrategy?: ReleaseStrategy;
}

export interface ScheduledBlock {
  resourceName: string;
  start: Date;
  end: Date;
  hours: number;
}

export interface ScheduledTask {
  id: string;
  storyName: string;
  storyLink: string;
  poPriority: number | null;
  status: TaskWorkflowStatus;
  feBlocks: ScheduledBlock[];
  beBlocks: ScheduledBlock[];
  androidBlocks: ScheduledBlock[];
  iosBlocks: ScheduledBlock[];
  feStart: Date | null;
  feEnd: Date | null;
  beStart: Date | null;
  beEnd: Date | null;
  androidStart: Date | null;
  androidEnd: Date | null;
  iosStart: Date | null;
  iosEnd: Date | null;
  devEnd: Date | null;
  integrationStart: Date | null;
  integrationEnd: Date | null;
  qcBlocks: ScheduledBlock[];
  qcStart: Date | null;
  qcEnd: Date | null;
  bufferStart: Date | null;
  bufferEnd: Date | null;
  uatReleaseDate: Date | null;
  productionReleaseDate: Date | null;
  releaseDate: Date | null;
  /** True if either UAT or production (or both) is scheduled on a Thursday. */
  isThursdayRelease: boolean;
  thursdayReleaseScope: ThursdayReleaseScope;
  isOverflow: boolean;
  releaseGroup: string | null;
}

export interface ScheduleResult {
  tasks: ScheduledTask[];
  sprintEndDate: Date;
}
