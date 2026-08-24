import type { Task } from "@/lib/scheduler/types";
import { isDiscopedTaskStatus, normalizeTaskStatus } from "@/lib/scheduler/taskStatus";
import {
  matchPlannerPerson,
  type PlannerPersonRef,
} from "@/lib/planner/resourceIdentity";
import {
  JiraApiError,
} from "./client";
import { publicJiraErrorMessage } from "./jiraErrors";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { buildJiraBasicAuthHeader, jiraRestApiBase, type JiraApiCredentials } from "./credentials";
import { listParentSubtasks, matchAllRoleSubtasksFromSummaries } from "./discoverSubtasks";
import {
  hoursFromJiraNumberField,
  hoursFromJiraTimetracking,
} from "./hours";
import { isJiraStoryLink, parseJiraIssueKey } from "./issueKey";
import type { JiraSubtaskRole, JiraTaskSubtaskRef, SquadJiraConfig, TaskJiraMeta } from "./types";
import {
  JIRA_BULK_PULL_SKIP_REASON,
  type BulkPullFromJiraResult,
  type BulkPullTaskResult,
} from "./bulkPullMessages";
import { resolveIsEmStory } from "./emStoryFlag";

export type { BulkPullTaskResult, BulkPullFromJiraResult } from "./bulkPullMessages";
export {
  JIRA_BULK_PULL_SKIP_REASON,
  formatBulkPullConfirmMessage,
  formatBulkPullSummary,
} from "./bulkPullMessages";

export interface SyncTaskFromJiraResult {
  patch: Partial<Task>;
  jira: TaskJiraMeta;
  warnings: string[];
}

type JiraUserField = {
  accountId?: string;
  displayName?: string;
};

type JiraIssueFields = {
  summary?: string;
  status?: { name?: string };
  assignee?: JiraUserField | null;
  timetracking?: {
    originalEstimateSeconds?: number | null;
    originalEstimate?: string | null;
  } | null;
  [customField: string]: unknown;
};

const jiraFetch = async (credentials: JiraApiCredentials, path: string): Promise<Response> =>
  fetch(`${jiraRestApiBase(credentials.siteUrl)}${path}`, {
    headers: {
      Authorization: buildJiraBasicAuthHeader(credentials),
      Accept: "application/json",
    },
    cache: "no-store",
  });

const reverseAssigneeMap = (assigneeMap: Record<string, string>): Map<string, string> => {
  const reversed = new Map<string, string>();
  for (const [plannerName, accountId] of Object.entries(assigneeMap)) {
    const id = accountId.trim();
    const name = plannerName.trim();
    if (id && name && !reversed.has(id)) {
      reversed.set(id, name);
    }
  }
  return reversed;
};

type ResourceRef = { name: string; type: string };

/**
 * Hours (and empty assignee arrays) for a discovered Jira story/task/bug before Pull.
 * Uses the issue estimate only — never auto-assigns FE/BE/QC/MO from the Jira assignee.
 * Role assignees come later from Pull ([FE]/[BE]/QC fields) or manual edit.
 */
export const resolveHoursForDiscoveredTask = (
  _assigneeAccountId: string | null,
  estimateSeconds: number | null,
  _assigneeMap: Record<string, string>,
  _resources: ResourceRef[],
): {
  feHours: number; beHours: number; qcHours: number; androidHours: number; iosHours: number;
  feDevs: string[]; beDevs: string[]; qcs: string[]; androidDevs: string[]; iosDevs: string[];
} => {
  const hours = estimateSeconds != null && estimateSeconds > 0
    ? Math.round((estimateSeconds / 3600) * 10) / 10
    : 0;

  return {
    feHours: hours,
    beHours: 0,
    qcHours: 0,
    androidHours: 0,
    iosHours: 0,
    feDevs: [],
    beDevs: [],
    qcs: [],
    androidDevs: [],
    iosDevs: [],
  };
};

/**
 * Map a Jira user onto a planner resource canonical name.
 * Order: assigneeMap → roster name/nickname fuzzy match. Never stores unmapped Jira display names.
 */
export const resolvePlannerNameFromJiraUser = (
  user: JiraUserField | null | undefined,
  assigneeMap: Record<string, string>,
  people: PlannerPersonRef[],
): { name: string; warning?: string } | null => {
  if (!user) {
    return null;
  }
  const accountId = user.accountId?.trim() ?? "";
  const displayName = user.displayName?.trim() ?? "";
  if (!accountId && !displayName) {
    return null;
  }

  const byAccount = accountId ? reverseAssigneeMap(assigneeMap).get(accountId) : undefined;
  if (byAccount) {
    const mappedPerson = matchPlannerPerson(byAccount, people);
    return { name: mappedPerson?.name ?? byAccount };
  }

  if (displayName) {
    const matched = matchPlannerPerson(displayName, people);
    if (matched) {
      return { name: matched.name };
    }
    return null;
  }

  return null;
};

export const extractJiraUserField = (value: unknown): JiraUserField | null => {
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && value.trim()) {
      return { displayName: value.trim() };
    }
    return null;
  }
  const record = value as JiraUserField;
  if (!record.accountId?.trim() && !record.displayName?.trim()) {
    return null;
  }
  return {
    accountId: record.accountId?.trim(),
    displayName: record.displayName?.trim(),
  };
};

const fetchIssueFields = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  fieldIds: string[],
): Promise<JiraIssueFields> => {
  const unique = [...new Set(fieldIds.map((id) => id.trim()).filter(Boolean))];
  const response = await jiraFetch(
    credentials,
    `/issue/${encodeURIComponent(issueKey)}?fields=${encodeURIComponent(unique.join(","))}`,
  );
  if (!response.ok) {
    await response.text().catch(() => "");
    throw new JiraApiError(
      publicJiraErrorMessage(response.status, `Failed to load Jira issue ${issueKey}`),
      response.status,
    );
  }
  const body = (await response.json()) as { fields?: JiraIssueFields };
  return body.fields ?? {};
};

const readSubtaskDetails = async (
  credentials: JiraApiCredentials,
  issueKey: string,
  developmentEstimateFieldId: string,
): Promise<{ assignee: JiraUserField | null; hours: number }> => {
  const fields = ["assignee", "timetracking"];
  if (developmentEstimateFieldId.trim()) {
    fields.push(developmentEstimateFieldId.trim());
  }
  const issueFields = await fetchIssueFields(credentials, issueKey, fields);
  const fromCustom = hoursFromJiraNumberField(issueFields[developmentEstimateFieldId.trim()]);
  const fromTime = hoursFromJiraTimetracking(issueFields.timetracking);
  return {
    assignee: extractJiraUserField(issueFields.assignee),
    hours: fromCustom ?? fromTime ?? 0,
  };
};

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> => {
  if (items.length === 0) {
    return [];
  }
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
};

const uniqueAssigneeNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const name of names) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
};

const toPlannerPeople = (
  peopleOrNames: PlannerPersonRef[] | string[] = [],
): PlannerPersonRef[] =>
  peopleOrNames.map((item) =>
    typeof item === "string" ? { name: item } : { name: item.name, nickname: item.nickname },
  );

/**
 * Pull parent status, QC/hours, and FE/BE/MO subtask assignees/hours into a planner patch.
 * emAccountId: resolved EM Jira account ID used to set isEmStory on the task.
 */
export const syncTaskFromJira = async (
  task: Task,
  squadConfig: SquadJiraConfig,
  plannerPeople: PlannerPersonRef[] | string[] = [],
  emAccountId?: string | null,
): Promise<SyncTaskFromJiraResult> => {
  if (isDiscopedTaskStatus(task.status)) {
    throw new JiraApiError("Discoped stories are not synced from Jira", 400);
  }

  const people = toPlannerPeople(plannerPeople);
  const parentIssueKey = parseJiraIssueKey(task.storyLink);
  if (!parentIssueKey) {
    throw new JiraApiError("Story link is not a valid Jira issue URL or key", 400);
  }

  const credentials = await requireJiraApiCredentials();
  const fieldIds = squadConfig.parentStoryFields;
  const emFieldId = squadConfig.engineeringManagerFieldId.trim();
  const parentFieldList = [
    "summary",
    "status",
    "issuetype",
    "assignee",
    "parent",
    fieldIds.developmentEstimateHours,
    fieldIds.testingEstimateHours,
    fieldIds.qcEngineer,
    fieldIds.productManager,
    ...(emFieldId ? [emFieldId] : []),
  ].filter(Boolean);

  const parentFields = await fetchIssueFields(credentials, parentIssueKey, parentFieldList);
  const warnings: string[] = [];

  const statusName = parentFields.status?.name?.trim();
  const status = statusName ? normalizeTaskStatus(statusName) : undefined;
  if (statusName && isDiscopedTaskStatus(statusName)) {
    warnings.push(`Jira status is "${statusName}" — planner status was updated; Discoped still blocks future sync.`);
  }

  const patch: Partial<Task> = {};
  if (status) {
    patch.status = status;
  }

  const issueTypeName = (parentFields.issuetype as { name?: string } | null | undefined)?.name?.trim();
  if (issueTypeName) {
    patch.issueType = issueTypeName;
  }

  const assigneeAccountId = (parentFields.assignee as { accountId?: string } | null | undefined)?.accountId?.trim();
  const emFieldUser = emFieldId ? extractJiraUserField(parentFields[emFieldId]) : null;
  patch.isEmStory = resolveIsEmStory(emAccountId, assigneeAccountId, emFieldUser?.accountId);

  const qcHours = hoursFromJiraNumberField(parentFields[fieldIds.testingEstimateHours.trim()]);
  if (qcHours != null) {
    patch.qcHours = qcHours;
  }

  const qcUser = extractJiraUserField(parentFields[fieldIds.qcEngineer.trim()]);
  if (qcUser) {
    const resolved = resolvePlannerNameFromJiraUser(qcUser, squadConfig.assigneeMap, people);
    if (resolved) {
      patch.qcs = [resolved.name];
      if (resolved.warning) {
        warnings.push(resolved.warning);
      }
    } else {
      const label = qcUser.displayName?.trim() || qcUser.accountId?.trim() || "unknown";
      warnings.push(
        `QC Engineer "${label}" from Jira is not on the Resources roster (or assignee map) — QC assignee was not updated`,
      );
    }
  }

  const pmUser = extractJiraUserField(parentFields[fieldIds.productManager.trim()]);
  if (pmUser) {
    const resolved = resolvePlannerNameFromJiraUser(pmUser, squadConfig.assigneeMap, people);
    if (resolved) {
      patch.productManagers = [resolved.name];
      if (resolved.warning) {
        warnings.push(resolved.warning);
      }
    } else {
      const label = pmUser.displayName?.trim() || pmUser.accountId?.trim() || "unknown";
      warnings.push(
        `Product Manager "${label}" from Jira is not on the Resources roster (or assignee map) — PM assignee was not updated`,
      );
    }
  } else if (
    !squadConfig.productManagerFieldIsUser &&
    fieldIds.productManager.trim() &&
    typeof parentFields[fieldIds.productManager.trim()] === "string"
  ) {
    const pmText = (parentFields[fieldIds.productManager.trim()] as string).trim();
    if (pmText) {
      const matched = people.find(
        (person) => person.name.trim().toLowerCase() === pmText.toLowerCase(),
      );
      if (matched) {
        patch.productManagers = [matched.name];
      } else {
        warnings.push(
          `Product Manager "${pmText}" from Jira is not on the Resources roster — PM assignee was not updated`,
        );
      }
    }
  }

  const children = await listParentSubtasks(credentials, parentIssueKey);
  const developmentEstimateFieldId = fieldIds.developmentEstimateHours;
  const roleKeys = matchAllRoleSubtasksFromSummaries(children);

  const readRole = async (
    role: JiraSubtaskRole,
    key: string,
  ): Promise<JiraTaskSubtaskRef | null> => {
    try {
      const details = await readSubtaskDetails(credentials, key, developmentEstimateFieldId);
      const resolved = resolvePlannerNameFromJiraUser(
        details.assignee,
        squadConfig.assigneeMap,
        people,
      );
      if (resolved?.warning) {
        warnings.push(`${role.toUpperCase()} subtask ${key}: ${resolved.warning}`);
      }
      if (!details.assignee) {
        warnings.push(`${role.toUpperCase()} subtask ${key} has no assignee in Jira`);
      } else if (!resolved) {
        const label = details.assignee.displayName?.trim() || details.assignee.accountId?.trim() || "unknown";
        warnings.push(
          `${role.toUpperCase()} subtask ${key}: Jira assignee "${label}" is not on the Resources roster (or assignee map)`,
        );
      }
      return {
        key,
        role,
        assigneeName: resolved?.name ?? "",
        hours: details.hours,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : `Failed to load Jira subtask ${key}`;
      warnings.push(`${role.toUpperCase()} subtask ${key}: ${message}`);
      return null;
    }
  };

  const applyRoleRefs = (
    role: JiraSubtaskRole,
    refs: JiraTaskSubtaskRef[],
    hoursKey: "feHours" | "beHours" | "androidHours" | "iosHours",
    assigneesKey: "feDevs" | "beDevs" | "androidDevs" | "iosDevs",
    missingWarning: string | null,
  ) => {
    if (refs.length === 0) {
      if (missingWarning) {
        warnings.push(missingWarning);
      }
      return;
    }
    patch[hoursKey] = refs.reduce((sum, ref) => sum + ref.hours, 0);
    const names = uniqueAssigneeNames(refs.map((ref) => ref.assigneeName));
    if (names.length > 0) {
      patch[assigneesKey] = names;
    }
    if (role === "ios") {
      patch.needsIos = true;
    }
  };

  const feRefs = (await mapWithConcurrency(roleKeys.fe, 4, (key) => readRole("fe", key))).filter(
    (item): item is JiraTaskSubtaskRef => item !== null,
  );
  const beRefs = (await mapWithConcurrency(roleKeys.be, 4, (key) => readRole("be", key))).filter(
    (item): item is JiraTaskSubtaskRef => item !== null,
  );
  const androidRefs = (await mapWithConcurrency(roleKeys.android, 4, (key) => readRole("android", key))).filter(
    (item): item is JiraTaskSubtaskRef => item !== null,
  );
  const iosRefs = (await mapWithConcurrency(roleKeys.ios, 4, (key) => readRole("ios", key))).filter(
    (item): item is JiraTaskSubtaskRef => item !== null,
  );

  applyRoleRefs("fe", feRefs, "feHours", "feDevs", "No [FE] subtask found under the Jira story");
  applyRoleRefs("be", beRefs, "beHours", "beDevs", "No [BE] subtask found under the Jira story");
  applyRoleRefs(
    "android",
    androidRefs,
    "androidHours",
    "androidDevs",
    (task.androidDevs ?? []).some((name) => name.trim().length > 0)
      ? "No [Android] (or legacy [MO]) subtask found under the Jira story"
      : null,
  );
  applyRoleRefs(
    "ios",
    iosRefs,
    "iosHours",
    "iosDevs",
    (task.iosDevs ?? []).some((name) => name.trim().length > 0)
      ? "No [IOS] subtask found under the Jira story"
      : null,
  );

  const parentDevHours = hoursFromJiraNumberField(
    parentFields[fieldIds.developmentEstimateHours.trim()],
  );
  if (
    parentDevHours != null &&
    feRefs.length === 0 &&
    beRefs.length === 0 &&
    androidRefs.length === 0 &&
    iosRefs.length === 0
  ) {
    warnings.push(
      `Parent development estimate is ${parentDevHours}h but no [FE]/[BE]/[Android]/[IOS] subtasks were found to apply it`,
    );
  }

  const subtasks = [...feRefs, ...beRefs, ...androidRefs, ...iosRefs];
  const jira: TaskJiraMeta = {
    parentIssueKey,
    lastPushedAt: task.jira?.lastPushedAt ?? null,
    lastPulledAt: new Date().toISOString(),
    subtasks,
  };
  patch.jira = jira;

  return { patch, jira, warnings };
};

/**
 * Pull many stories from Jira sequentially.
 * emAccountId: if provided, sets isEmStory on each task based on Jira assignee comparison.
 */
export const bulkPullTasksFromJira = async (
  tasks: Task[],
  squadConfig: SquadJiraConfig,
  plannerPeople: PlannerPersonRef[] | string[] = [],
  emAccountId?: string | null,
): Promise<BulkPullFromJiraResult> => {
  const results: BulkPullTaskResult[] = [];
  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (const task of tasks) {
    if (isDiscopedTaskStatus(task.status)) {
      failed += 1;
      results.push({
        taskId: task.id,
        storyName: task.storyName,
        ok: false,
        error: JIRA_BULK_PULL_SKIP_REASON.DISCOPED,
      });
      continue;
    }
    if (!isJiraStoryLink(task.storyLink)) {
      skipped += 1;
      results.push({
        taskId: task.id,
        storyName: task.storyName,
        ok: false,
        skipped: true,
        skipReason: JIRA_BULK_PULL_SKIP_REASON.NO_LINK,
      });
      continue;
    }

    try {
      const result = await syncTaskFromJira(task, squadConfig, plannerPeople, emAccountId);
      synced += 1;
      results.push({
        taskId: task.id,
        storyName: task.storyName,
        ok: true,
        patch: result.patch,
        jira: result.jira,
        warnings: result.warnings,
      });
    } catch (error) {
      failed += 1;
      results.push({
        taskId: task.id,
        storyName: task.storyName,
        ok: false,
        error: error instanceof Error ? error.message : "Pull failed",
      });
    }
  }

  return { results, synced, failed, skipped };
};
