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
import { discoverFeBeSubtasks, listParentSubtasks } from "./discoverSubtasks";
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

const toPlannerPeople = (
  peopleOrNames: PlannerPersonRef[] | string[] = [],
): PlannerPersonRef[] =>
  peopleOrNames.map((item) =>
    typeof item === "string" ? { name: item } : { name: item.name, nickname: item.nickname },
  );

/**
 * Pull parent status, QC/hours, and FE/BE/MO subtask assignees/hours into a planner patch.
 */
export const syncTaskFromJira = async (
  task: Task,
  squadConfig: SquadJiraConfig,
  plannerPeople: PlannerPersonRef[] | string[] = [],
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
  const parentFieldList = [
    "summary",
    "status",
    fieldIds.developmentEstimateHours,
    fieldIds.testingEstimateHours,
    fieldIds.qcEngineer,
    fieldIds.productManager,
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

  const discovered = await discoverFeBeSubtasks(
    credentials,
    parentIssueKey,
    task.storyName,
    task.jira,
  );
  const children = await listParentSubtasks(credentials, parentIssueKey);
  const developmentEstimateFieldId = fieldIds.developmentEstimateHours;

  const readRole = async (
    role: JiraSubtaskRole,
    key: string | undefined,
  ): Promise<JiraTaskSubtaskRef | null> => {
    if (!key) {
      return null;
    }
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
  };

  const feRef = await readRole("fe", discovered.feKey);
  const beRef = await readRole("be", discovered.beKey);
  const androidRef = await readRole("android", discovered.androidKey);
  const iosRef = await readRole("ios", discovered.iosKey);

  if (!feRef) {
    warnings.push("No [FE] subtask found under the Jira story");
  } else {
    patch.feHours = feRef.hours;
    if (feRef.assigneeName) {
      patch.feDevs = [feRef.assigneeName];
    }
  }

  if (!beRef) {
    warnings.push("No [BE] subtask found under the Jira story");
  } else {
    patch.beHours = beRef.hours;
    if (beRef.assigneeName) {
      patch.beDevs = [beRef.assigneeName];
    }
  }

  if (!androidRef) {
    // Mobile is optional — warn only when the dashboard already has an Android assignee.
    if ((task.androidDevs ?? []).some((name) => name.trim().length > 0)) {
      warnings.push("No [Android] (or legacy [MO]) subtask found under the Jira story");
    }
  } else {
    patch.androidHours = androidRef.hours;
    if (androidRef.assigneeName) {
      patch.androidDevs = [androidRef.assigneeName];
    }
  }

  if (!iosRef) {
    // Mobile is optional — warn only when the dashboard already has an IOS assignee.
    if ((task.iosDevs ?? []).some((name) => name.trim().length > 0)) {
      warnings.push("No [IOS] subtask found under the Jira story");
    }
  } else {
    patch.needsIos = true;
    patch.iosHours = iosRef.hours;
    if (iosRef.assigneeName) {
      patch.iosDevs = [iosRef.assigneeName];
    }
  }

  const parentDevHours = hoursFromJiraNumberField(
    parentFields[fieldIds.developmentEstimateHours.trim()],
  );
  if (parentDevHours != null && !feRef && !beRef && !androidRef && !iosRef) {
    warnings.push(
      `Parent development estimate is ${parentDevHours}h but no [FE]/[BE]/[Android]/[IOS] subtasks were found to apply it`,
    );
  }

  const unmatchedDev = children.filter((child) => {
    if (
      feRef?.key === child.key ||
      beRef?.key === child.key ||
      androidRef?.key === child.key ||
      iosRef?.key === child.key
    ) {
      return false;
    }
    return /^\[(FE|BE|Android|IOS|MO)\]/i.test(child.summary);
  });
  if (unmatchedDev.length > 0) {
    const extras = unmatchedDev
      .slice(0, 5)
      .map((child) => `${child.key} (${child.summary})`)
      .join(", ");
    warnings.push(
      `Extra [FE]/[BE]/[Android]/[IOS] subtasks were not applied (planner keeps one of each): ${extras}`,
    );
  }

  const subtasks = [feRef, beRef, androidRef, iosRef].filter(
    (item): item is JiraTaskSubtaskRef => item !== null,
  );
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
 */
export const bulkPullTasksFromJira = async (
  tasks: Task[],
  squadConfig: SquadJiraConfig,
  plannerPeople: PlannerPersonRef[] | string[] = [],
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
      const result = await syncTaskFromJira(task, squadConfig, plannerPeople);
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
