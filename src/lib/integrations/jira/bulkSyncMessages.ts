import type { TaskJiraMeta } from "./types";
import {
  formatGroupedStoryMessages,
  partitionMessages,
  storyCountLabel,
  type StoryMessage,
} from "./bulkNotificationFormat";

export interface BulkSyncTaskResult {
  taskId: string;
  storyName: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: string;
  jira?: TaskJiraMeta;
  warnings?: string[];
  errors?: string[];
  error?: string;
}

export interface BulkSyncToJiraResult {
  results: BulkSyncTaskResult[];
  synced: number;
  failed: number;
  skipped: number;
}

/** Internal skip reasons returned by bulk sync. */
export const JIRA_BULK_SKIP_REASON = {
  NO_LINK: "No valid Jira story link",
  NO_HOURS: "No FE/BE assignees or FE/BE/QC hours to sync",
  DISCOPED: "Discoped stories are not synced to Jira",
} as const;

export type JiraBulkSkipReason = (typeof JIRA_BULK_SKIP_REASON)[keyof typeof JIRA_BULK_SKIP_REASON];

const storyLabel = (row: Pick<BulkSyncTaskResult, "storyName" | "taskId">): string =>
  row.storyName.trim() || row.taskId;

/**
 * Confirm dialog before bulk sync — explains what will sync vs be left out.
 */
export const formatBulkSyncConfirmMessage = (
  eligibleCount: number,
  visibleCount: number,
  discopedCount = 0,
): string => {
  const softLeftOut = Math.max(0, visibleCount - eligibleCount - discopedCount);
  const syncLabel = storyCountLabel(eligibleCount);
  const parts: string[] = [`Sync ${syncLabel} to Jira?`];

  if (softLeftOut > 0) {
    parts.push(
      `${storyCountLabel(softLeftOut)} will be left out — no Jira link or no FE/BE assignee/hours. ` +
        `Left out is not a failure; Jira is simply not called for those rows.`,
    );
  }

  if (discopedCount > 0) {
    parts.push(
      `${storyCountLabel(discopedCount)} Discoped — not synced to Jira (reported as errors).`,
    );
  }

  return parts.join("\n\n");
};

const collectWarningMessages = (result: BulkSyncToJiraResult): StoryMessage[] =>
  result.results.flatMap((row) =>
    (row.warnings ?? []).map((message) => ({ story: storyLabel(row), message })),
  );

const collectErrorMessages = (result: BulkSyncToJiraResult): StoryMessage[] =>
  result.results.flatMap((row) =>
    (row.errors ?? []).map((message) => ({ story: storyLabel(row), message })),
  );

/** True when push left intended updates unfinished (subtasks, assignees, status, etc.). */
export const bulkSyncHasActionErrors = (result: BulkSyncToJiraResult): boolean => {
  if (result.failed > 0) return true;
  if (result.results.some((row) => (row.errors?.length ?? 0) > 0)) return true;
  return partitionMessages(collectWarningMessages(result)).actionFailures.length > 0;
};

/**
 * User-friendly bulk sync result summary — groups identical issues under one message.
 */
export const formatBulkSyncSummary = (result: BulkSyncToJiraResult): string => {
  const noLink = result.results.filter(
    (row) => row.skipped && row.skipReason === JIRA_BULK_SKIP_REASON.NO_LINK,
  );
  const noHours = result.results.filter(
    (row) => row.skipped && row.skipReason === JIRA_BULK_SKIP_REASON.NO_HOURS,
  );
  const failedRows = result.results.filter((row) => !row.ok && !row.skipped);
  const discopedRows = failedRows.filter((row) => row.error === JIRA_BULK_SKIP_REASON.DISCOPED);
  const jiraFailedRows = failedRows.filter((row) => row.error !== JIRA_BULK_SKIP_REASON.DISCOPED);
  const rowErrors = collectErrorMessages(result);
  const { actionFailures, softWarnings } = partitionMessages(collectWarningMessages(result));
  const allActionFailures = [...rowErrors, ...actionFailures];

  const lines: string[] = [];

  if (result.synced > 0) {
    lines.push(`${storyCountLabel(result.synced)} synced to Jira.`);
  } else {
    lines.push("No stories were synced to Jira.");
  }

  if (noLink.length > 0) {
    lines.push(
      `${storyCountLabel(noLink.length)} not synced — add a Jira link:\n${noLink
        .map((row) => `• ${storyLabel(row)}`)
        .join("\n")}`,
    );
  }

  if (noHours.length > 0) {
    lines.push(
      `${storyCountLabel(noHours.length)} not synced — add an FE/BE assignee or FE/BE/QC hours:\n${noHours
        .map((row) => `• ${storyLabel(row)}`)
        .join("\n")}`,
    );
  }

  if (discopedRows.length > 0) {
    lines.push(
      `Errors — Discoped (not synced):\n${discopedRows.map((row) => `• ${storyLabel(row)}`).join("\n")}`,
    );
  }

  if (jiraFailedRows.length > 0) {
    const grouped = formatGroupedStoryMessages(
      jiraFailedRows.map((row) => ({
        story: storyLabel(row),
        message: row.error ?? "Unknown error",
      })),
    );
    lines.push(
      `Errors — Jira returned an error (${storyCountLabel(jiraFailedRows.length)}):\n${grouped}`,
    );
  }

  if (allActionFailures.length > 0) {
    lines.push(
      `Errors — some updates did not apply:\n${formatGroupedStoryMessages(allActionFailures)}`,
    );
  }

  if (softWarnings.length > 0) {
    lines.push(`Warnings:\n${formatGroupedStoryMessages(softWarnings)}`);
  }

  if (
    result.synced > 0 &&
    noLink.length === 0 &&
    noHours.length === 0 &&
    failedRows.length === 0 &&
    allActionFailures.length === 0 &&
    softWarnings.length === 0
  ) {
    lines.push("Every visible story with a link and hours is up to date.");
  }

  return lines.join("\n\n");
};

/** @deprecated Prefer bulkSyncHasActionErrors — kept for call sites that mean partial issues. */
export const bulkSyncHasPartialWarnings = (result: BulkSyncToJiraResult): boolean =>
  bulkSyncHasActionErrors(result) ||
  result.results.some((row) => row.ok && (row.warnings?.length ?? 0) > 0);
