import type { Task } from "@/lib/scheduler/types";
import { effectiveIosHours, effectiveMobileHours, mobileAppLabel } from "@/lib/scheduler/mobilePlatform";
import { splitHoursAcrossAssignees } from "./hours";
import type { JiraSubtaskRole, PlannedJiraSubtask, PlannedJiraParentUpdate, SquadJiraConfig, TaskJiraMeta } from "./types";
import { buildBranchName } from "./parentFields";

export type { PlannedJiraParentUpdate } from "./types";

const ROLE_SUMMARY_LABEL: Record<JiraSubtaskRole, string> = {
  fe: "FE",
  be: "BE",
  android: "Android",
  ios: "IOS",
};

const resolveAccountId = (config: SquadJiraConfig, assigneeName: string): string | null => {
  const mapped = config.assigneeMap[assigneeName]?.trim();
  return mapped || null;
};

const namedAssignees = (assignees: string[] | undefined): string[] => {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of assignees ?? []) {
    const name = raw.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
};

const primaryAssignee = (assignees: string[] | undefined): string | null =>
  namedAssignees(assignees)[0] ?? null;

const storyTitle = (task: Task): string => task.storyName.trim() || "Story";

const findExistingSubtaskKey = (
  jiraMeta: TaskJiraMeta | undefined,
  role: JiraSubtaskRole,
  assigneeName: string,
  usedKeys: Set<string>,
): string | undefined => {
  const rows = jiraMeta?.subtasks.filter((item) => item.role === role) ?? [];
  const byAssignee = rows.find(
    (item) => item.assigneeName.trim() === assigneeName && item.key && !usedKeys.has(item.key),
  );
  if (byAssignee?.key) {
    return byAssignee.key;
  }
  return rows.find((item) => item.key && !usedKeys.has(item.key))?.key;
};

const roleLabel = (role: JiraSubtaskRole) => ROLE_SUMMARY_LABEL[role];

const roleSummary = (role: JiraSubtaskRole, task: Task, assigneeName: string, assigneeCount: number): string => {
  const title = storyTitle(task);
  const app = role === "android" || role === "ios" ? mobileAppLabel(task.mobileApp) : "";
  const withApp = app ? `[${roleLabel(role)}] [${app}] ${title}` : `[${roleLabel(role)}] ${title}`;
  if (assigneeCount <= 1) {
    return withApp;
  }
  return `${withApp} — ${assigneeName}`;
};

const pushDevSubtasks = (
  rows: PlannedJiraSubtask[],
  task: Task,
  config: SquadJiraConfig,
  jiraMeta: TaskJiraMeta | undefined,
  role: JiraSubtaskRole,
  assignees: string[],
  hours: number,
) => {
  const names = namedAssignees(assignees);
  if (names.length === 0) {
    return;
  }
  const hourChunks = splitHoursAcrossAssignees(Math.max(0, hours), names.length);
  const usedKeys = new Set<string>();
  names.forEach((assigneeName, index) => {
    const existingKey = findExistingSubtaskKey(jiraMeta, role, assigneeName, usedKeys);
    if (existingKey) {
      usedKeys.add(existingKey);
    }
    rows.push({
      role,
      assigneeName,
      jiraAccountId: resolveAccountId(config, assigneeName),
      hours: hourChunks[index] ?? 0,
      summary: roleSummary(role, task, assigneeName, names.length),
      existingKey,
    });
  });
};

/**
 * Build FE/BE/Android/IOS Jira subtasks named after the main story.
 * Creates a row when an assignee is present (including 0 hours).
 * iOS only when needsIos is true.
 */
export const buildSubtaskPlan = (
  task: Task,
  config: SquadJiraConfig,
  jiraMeta?: TaskJiraMeta,
): PlannedJiraSubtask[] => {
  const rows: PlannedJiraSubtask[] = [];
  pushDevSubtasks(rows, task, config, jiraMeta, "fe", task.feDevs, task.feHours);
  pushDevSubtasks(rows, task, config, jiraMeta, "be", task.beDevs, task.beHours);
  pushDevSubtasks(rows, task, config, jiraMeta, "android", task.androidDevs ?? [], task.androidHours ?? 0);
  if (task.needsIos) {
    pushDevSubtasks(rows, task, config, jiraMeta, "ios", task.iosDevs ?? [], task.iosHours ?? 0);
  }
  return rows;
};

/** Warnings for assignee present with zero hours (subtask still created). */
export const subtaskPlanWarnings = (plan: PlannedJiraSubtask[], task: Task): string[] => {
  const story = storyTitle(task);
  return plan
    .filter((row) => row.hours <= 0)
    .map(
      (row) =>
        `${roleLabel(row.role)} subtask for "${row.assigneeName}" on "${story}" has 0 hours — created/updated with 0h`,
    );
};

/** Errors when a role has hours but no assignee (reported after sync). */
export const subtaskPlanAssigneeErrors = (task: Task): string[] => {
  const story = storyTitle(task);
  const errors: string[] = [];
  if (task.feHours > 0 && !primaryAssignee(task.feDevs)) {
    errors.push(`FE has ${task.feHours}h on "${story}" but no assignee`);
  }
  if (task.beHours > 0 && !primaryAssignee(task.beDevs)) {
    errors.push(`BE has ${task.beHours}h on "${story}" but no assignee`);
  }
  if ((task.androidHours ?? 0) > 0 && !primaryAssignee(task.androidDevs)) {
    errors.push(`Android has ${task.androidHours}h on "${story}" but no assignee`);
  }
  if (effectiveIosHours(task) > 0 && !primaryAssignee(task.iosDevs)) {
    errors.push(`IOS has ${task.iosHours}h on "${story}" but no assignee`);
  }
  return errors;
};

/**
 * Parent story custom fields: dev estimate = FE+BE+Android+(optional IOS) hours, testing = QC hours.
 */
export const buildParentIssuePlan = (
  task: Task,
  config: SquadJiraConfig,
  developmentHours: number,
): PlannedJiraParentUpdate => {
  const qcEngineerName = primaryAssignee(task.qcs) ?? "";
  const productManagerName = primaryAssignee(task.productManagers ?? []) ?? "";
  const productManagerJiraAccountId = productManagerName
    ? resolveAccountId(config, productManagerName)
    : null;

  return {
    qcEngineerName,
    qcJiraAccountId: qcEngineerName ? resolveAccountId(config, qcEngineerName) : null,
    developmentHours,
    testingHours: task.qcHours,
    productManagerName,
    productManagerJiraAccountId,
    branchName: buildBranchName(task),
  };
};

/** Names that need a Jira accountId for this sync but are not mapped yet. */
export const unmappedAssigneeNamesForSync = (
  plan: PlannedJiraSubtask[],
  parentPlan: PlannedJiraParentUpdate,
  config: SquadJiraConfig,
): string[] => {
  const names: string[] = [];
  plan.forEach((row) => {
    if (!row.jiraAccountId) {
      names.push(row.assigneeName);
    }
  });
  if (config.qcEngineerFieldIsUser && parentPlan.qcEngineerName && !parentPlan.qcJiraAccountId) {
    names.push(parentPlan.qcEngineerName);
  }
  if (
    config.productManagerFieldIsUser &&
    parentPlan.productManagerName &&
    !parentPlan.productManagerJiraAccountId
  ) {
    names.push(parentPlan.productManagerName);
  }
  return names;
};

export const parentDevelopmentHoursFromTask = (task: Task): number =>
  Math.max(0, task.feHours) + Math.max(0, task.beHours) + effectiveMobileHours(task);
