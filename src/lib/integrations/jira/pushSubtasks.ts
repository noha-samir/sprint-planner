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
  matchAllRoleSubtasksFromSummaries,
  mergeDiscoveredIntoJiraMeta,
} from "./discoverSubtasks";
import { isJiraStoryLink, parseJiraIssueKey, projectKeyFromIssueKey } from "./issueKey";
import { taskHasJiraSyncHours } from "./syncEligibility";
import { buildParentJiraFieldPayload } from "./parentFields";
import { pushPlannerStatusToJira } from "./syncIssueStatus";
import { buildParentIssuePlan, buildSubtaskPlan, subtaskPlanAssigneeErrors, subtaskPlanWarnings, unmappedAssigneeNamesForSync } from "./subtaskPlan";
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
  bulkSyncHasPartialWarnings,
} from "./bulkSyncMessages";

export interface SyncTaskToJiraResult {
  jira: TaskJiraMeta;
  warnings: string[];
  errors: string[];
}

export type PushSubtasksResult = SyncTaskToJiraResult;

export { isTaskEligibleForJiraSync, taskHasJiraSyncHours } from "./syncEligibility";

/**
 * Sync FE/BE/MO subtasks (create or update assignee + hours), then update parent story custom fields.
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

  if (plan.length === 0 && parentPlan.testingHours <= 0 && assigneeErrors.length === 0) {
    throw new JiraApiError(
      "No Jira updates to sync — add FE/BE/Android/IOS assignees or FE/BE/Android/IOS/QC hours first",
      400,
    );
  }

  const accountWarnings = await warningsForUnmappedPlannerNames(
    credentials,
    unmappedAssigneeNamesForSync(plan, parentPlan, squadConfig),
  );
  const warnings = [...subtaskPlanWarnings(plan, task), ...accountWarnings];
  const developmentEstimateFieldId = squadConfig.parentStoryFields.developmentEstimateHours;
  const syncErrors = [...assigneeErrors];

  const subtasks: TaskJiraMeta["subtasks"] = [];
  for (const row of plan) {
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

      subtasks.push({
        key,
        role: row.role,
        assigneeName: row.assigneeName,
        hours: row.hours,
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

  const parentFields = buildParentJiraFieldPayload(squadConfig, parentPlan);
  if (Object.keys(parentFields).length > 0) {
    try {
      await updateJiraParentIssue(credentials, parentIssueKey, parentFields);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to update parent story fields";
      syncErrors.push(`Parent story ${parentIssueKey}: ${message}`);
    }
  }

  try {
    const statusResult = await pushPlannerStatusToJira(credentials, parentIssueKey, task.status);
    if (statusResult.warning) {
      warnings.push(statusResult.warning);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to sync Jira status";
    warnings.push(`Status sync failed for ${parentIssueKey}: ${message}`);
  }

  return {
    jira: {
      parentIssueKey,
      lastPushedAt: new Date().toISOString(),
      subtasks,
    },
    warnings,
    errors: syncErrors,
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
    if (!taskHasJiraSyncHours(task)) {
      skipped += 1;
      results.push({
        taskId: task.id,
        storyName: task.storyName,
        ok: false,
        skipped: true,
        skipReason: JIRA_BULK_SKIP_REASON.NO_HOURS,
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
