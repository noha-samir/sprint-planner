import type { Task } from "@/lib/scheduler/types";
import {
  createJiraSubtask,
  JiraApiError,
  updateJiraParentIssue,
  updateJiraSubtask,
} from "./client";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import {
  listParentSubtasks,
  listParentSubtasksFromIssue,
  matchAllRoleSubtasksFromSummaries,
  mergeDiscoveredIntoJiraMeta,
} from "./discoverSubtasks";
import { isJiraStoryLink, parseJiraIssueKey, projectKeyFromIssueKey } from "./issueKey";
import { taskHasJiraDevWork } from "./syncEligibility";
import { buildJiraSyncedFields, listJiraPendingChanges } from "./syncedFields";
import { buildParentJiraFieldPayload } from "./parentFields";
import { pushPlannerStatusToJira } from "./syncIssueStatus";
import { resolveParentStatusFromChildren } from "./parentStatusFromChildren";
import {
  buildParentIssuePlan,
  buildSubtaskPlan,
  isPlannedSubtaskUnchanged,
  subtaskPlanAssigneeErrors,
  subtaskPlanWarnings,
  unmappedAssigneeNamesForSync,
} from "./subtaskPlan";
import { warningsForUnmappedPlannerNames } from "./userSearch";
import type { SquadJiraConfig, TaskJiraMeta } from "./types";
import { isDiscopedTaskStatus } from "@/lib/scheduler/taskStatus";
import {
  JIRA_BULK_SKIP_REASON,
  type BulkSyncTaskResult,
  type BulkSyncToJiraResult,
} from "./bulkSyncMessages";

export type { BulkSyncTaskResult, BulkSyncToJiraResult, JiraBulkSkipReason } from "./bulkSyncMessages";
export {
  JIRA_BULK_SKIP_REASON,
  formatBulkSyncConfirmMessage,
  formatBulkSyncSummary,
  formatBulkSyncSummaryModel,
  bulkSyncHasPartialWarnings,
  bulkSyncHasActionErrors,
} from "./bulkSyncMessages";

export interface SyncTaskToJiraResult {
  jira: TaskJiraMeta;
  warnings: string[];
  errors: string[];
  /** True when Jira parent status now matches the pushed status (already equal or transitioned). */
  statusSynced: boolean;
  /** Set when the subtasks were further along than the planner, so their status was pushed instead. */
  statusFromChildren?: { from: string; to: string };
}

export type PushSubtasksResult = SyncTaskToJiraResult;

export { isTaskEligibleForJiraSync } from "./syncEligibility";

/**
 * Sync FE/BE/Android/IOS subtasks (create, or update when assignee / hours / summary changed),
 * then update parent story custom fields and status.
 * Stories without dev work are parent-only: subtasks are not touched and a 0 Development estimate is not written
 * (Testing estimate, QC Engineer, PM, branch and status still push — including 0 Testing hours).
 * Subtasks further along move the pushed status forward only when the planner status was not edited since the last sync.
 * @param task - Planner story to push.
 * @param squadConfig - Squad Jira config.
 * @returns Updated Jira meta plus warnings / errors for the summary.
 */
export const syncTaskToJira = async (
  task: Task,
  squadConfig: SquadJiraConfig,
): Promise<SyncTaskToJiraResult> => {
  if (isDiscopedTaskStatus(task.status)) {
    throw new JiraApiError("Discoped stories are not synced to Jira", 400);
  }

  const parentIssueKey = parseJiraIssueKey(task.storyLink);
  if (!parentIssueKey) {
    throw new JiraApiError("Story link is not a valid Jira issue URL or key", 400);
  }

  const projectKey = squadConfig.projectKey.trim() || projectKeyFromIssueKey(parentIssueKey);
  if (!projectKey) {
    throw new JiraApiError("Configure a Jira project key in squad settings", 400);
  }

  const credentials = await requireJiraApiCredentials();
  const children = await listParentSubtasks(credentials, parentIssueKey);
  const discovered = matchAllRoleSubtasksFromSummaries(children);
  const jiraMeta = mergeDiscoveredIntoJiraMeta(parentIssueKey, task, task.jira, discovered);

  const plan = buildSubtaskPlan(task, squadConfig, jiraMeta);
  const developmentHours =
    Math.max(0, task.feHours) +
    Math.max(0, task.beHours) +
    Math.max(0, task.androidHours ?? 0) +
    (task.needsIos ? Math.max(0, task.iosHours ?? 0) : 0);
  const parentPlan = buildParentIssuePlan(task, squadConfig, developmentHours);
  const assigneeErrors = subtaskPlanAssigneeErrors(task);
  const parentOnly = !taskHasJiraDevWork(task);

  const accountWarnings = await warningsForUnmappedPlannerNames(
    credentials,
    unmappedAssigneeNamesForSync(plan, parentPlan, squadConfig),
  );
  const warnings = [...subtaskPlanWarnings(plan, task), ...accountWarnings];
  const developmentEstimateFieldId = squadConfig.parentStoryFields.developmentEstimateHours;
  const syncErrors = [...assigneeErrors];

  const childStatusByKey = new Map(children.map((child) => [child.key, child.status]));
  const childSummaryByKey = new Map(children.map((child) => [child.key, child.summary]));
  const lastSyncedByKey = new Map(
    (task.jira?.parentIssueKey === parentIssueKey ? task.jira.subtasks : []).map((row) => [row.key, row]),
  );
  const subtasks: TaskJiraMeta["subtasks"] = [];
  for (const row of plan) {
    const existingKey = row.existingKey;
    if (
      existingKey &&
      isPlannedSubtaskUnchanged(row, lastSyncedByKey.get(existingKey), childSummaryByKey.get(existingKey))
    ) {
      const status = childStatusByKey.get(existingKey);
      subtasks.push({
        key: existingKey,
        role: row.role,
        assigneeName: row.assigneeName,
        hours: row.hours,
        ...(status ? { status } : {}),
      });
      continue;
    }


    const createPayload = {
      projectKey,
      parentIssueKey,
      issueTypeName: squadConfig.issueTypeSubTask || "Sub-task",
      summary: row.summary,
      jiraAccountId: row.jiraAccountId,
      hours: row.hours,
      squadFieldId: squadConfig.subtaskSquadFieldId,
      squadOptionId: squadConfig.subtaskSquadOptionId,
      developmentEstimateFieldId,
    };

    try {
      let key = row.existingKey;
      if (key) {
        try {
          await updateJiraSubtask(credentials, key, {
            summary: row.summary,
            jiraAccountId: row.jiraAccountId,
            hours: row.hours,
            developmentEstimateFieldId,
          });
        } catch (error) {
          if (error instanceof JiraApiError && (error.status === 404 || error.status === 403)) {
            warnings.push(`Subtask ${key} is missing or inaccessible — created a new one.`);
            key = await createJiraSubtask(credentials, createPayload);
          } else {
            throw error;
          }
        }
      } else {
        key = await createJiraSubtask(credentials, createPayload);
      }

      const status = childStatusByKey.get(key);
      subtasks.push({
        key,
        role: row.role,
        assigneeName: row.assigneeName,
        hours: row.hours,
        ...(status ? { status } : {}),
      });
    } catch (error) {
      const message =
        error instanceof JiraApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Failed to create/update subtask";
      syncErrors.push(
        `${ROLE_SUMMARY_LABEL_SAFE(row.role)} subtask "${row.summary}" for ${row.assigneeName}: ${message}`,
      );
    }
  }

  // Subtasks created in this push were not in the first listing, so read their statuses once more.
  const knownChildKeys = new Set(children.map((child) => child.key));
  const createdKeys = subtasks.map((row) => row.key).filter((key) => !knownChildKeys.has(key));
  const createdStatusByKey = new Map<string, string | undefined>();
  if (createdKeys.length > 0) {
    try {
      const refreshed = await listParentSubtasksFromIssue(credentials, parentIssueKey);
      for (const child of refreshed) createdStatusByKey.set(child.key, child.status);
    } catch {
      warnings.push(`Could not read the status of new subtasks on ${parentIssueKey} — pull from Jira to refresh.`);
    }
    for (const row of subtasks) {
      const status = createdStatusByKey.get(row.key);
      if (!row.status && status) row.status = status;
    }
  }

  const parentFields = buildParentJiraFieldPayload(squadConfig, parentPlan, { omitZeroDevelopmentEstimate: parentOnly });
  if (Object.keys(parentFields).length > 0) {
    try {
      await updateJiraParentIssue(credentials, parentIssueKey, parentFields);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update parent story fields";
      syncErrors.push(`Parent story ${parentIssueKey}: ${message}`);
    }
  }

  // A new subtask whose status could not be read blocks the subtask rule (conservative).
  const childStatuses = [
    ...children.map((child) => child.status),
    ...createdKeys.map((key) => createdStatusByKey.get(key)),
  ];
  // A status changed by hand in the planner wins; subtasks only move a status nobody edited since the last sync.
  const statusEditedInPlanner = listJiraPendingChanges(task).some((change) => change.field === "status");
  const childDrivenStatus = statusEditedInPlanner
    ? undefined
    : resolveParentStatusFromChildren(task.status, childStatuses).status;
  const statusToPush = childDrivenStatus ?? task.status;

  let statusSynced = false;
  let jiraStatusAfterPush: string | null = null;
  try {
    const statusResult = await pushPlannerStatusToJira(credentials, parentIssueKey, statusToPush);
    if (statusResult.warning) {
      warnings.push(statusResult.warning);
      jiraStatusAfterPush = statusResult.toStatus || statusResult.fromStatus || null;
    } else {
      statusSynced = true;
      jiraStatusAfterPush = statusToPush;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Jira status";
    syncErrors.push(`Status sync failed for ${parentIssueKey}: ${message}`);
  }

  // Parent-only push leaves Jira subtasks alone, so keep the ones we already know (with fresh statuses).
  const resultSubtasks = parentOnly
    ? jiraMeta.subtasks
        .filter((row) => knownChildKeys.has(row.key))
        .map((row) => {
          const status = childStatusByKey.get(row.key);
          return status ? { ...row, status } : row;
        })
    : subtasks;

  // A failed Jira call keeps the previous baseline so the story still shows "Needs push";
  // planner-side assignee errors (syncErrors seeded with them) repeat on every push and do not count.
  const previousSynced = task.jira?.syncedFields;
  const jiraCallFailed = syncErrors.length > assigneeErrors.length;
  const syncedFields =
    jiraCallFailed
      ? previousSynced
      : buildJiraSyncedFields(task, jiraStatusAfterPush ?? previousSynced?.status ?? statusToPush);

  return {
    jira: {
      parentIssueKey,
      lastPushedAt: new Date().toISOString(),
      lastPulledAt: task.jira?.lastPulledAt ?? null,
      subtasks: resultSubtasks,
      ...(syncedFields ? { syncedFields } : {}),
    },
    warnings,
    errors: syncErrors,
    statusSynced,
    ...(childDrivenStatus ? { statusFromChildren: { from: task.status, to: childDrivenStatus } } : {}),
  };
};

const ROLE_SUMMARY_LABEL_SAFE = (role: string): string => {
  if (role === "fe") return "FE";
  if (role === "be") return "BE";
  if (role === "android") return "Android";
  if (role === "ios") return "IOS";
  return role.toUpperCase();
};

/**
 * Sync multiple tasks sequentially (visible dashboard rows).
 */
export const bulkSyncTasksToJira = async (
  tasks: Task[],
  squadConfig: SquadJiraConfig,
): Promise<BulkSyncToJiraResult> => {
  const results: BulkSyncTaskResult[] = [];
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
        error: JIRA_BULK_SKIP_REASON.DISCOPED,
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
        skipReason: JIRA_BULK_SKIP_REASON.NO_LINK,
      });
      continue;
    }
    try {
      const result = await syncTaskToJira(task, squadConfig);
      synced += 1;
      results.push({
        taskId: task.id,
        storyName: task.storyName,
        ok: true,
        jira: result.jira,
        warnings: result.warnings,
        errors: result.errors,
        statusFromChildren: result.statusFromChildren,
      });
    } catch (error) {
      failed += 1;
      results.push({
        taskId: task.id,
        storyName: task.storyName,
        ok: false,
        error: error instanceof Error ? error.message : "Sync failed",
      });
    }
  }

  return { results, synced, failed, skipped };
};
