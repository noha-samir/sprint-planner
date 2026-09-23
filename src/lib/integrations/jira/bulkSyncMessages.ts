import type { TaskJiraMeta } from "./types";
import {
  buildBulkSummaryResult,
  emphasizeMessage,
  groupStoryMessages,
  partitionMessages,
  storyCountLabel,
  type BulkNotificationSummary,
  type BulkSummaryResult,
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
 * Structured + plain-text bulk sync result summary — groups identical issues under one message.
 */
export const formatBulkSyncSummaryModel = (result: BulkSyncToJiraResult): BulkSummaryResult => {
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

  const headline =
    result.synced > 0
      ? `${storyCountLabel(result.synced)} synced to Jira.`
      : "No stories were synced to Jira.";

  const model: BulkNotificationSummary = { headline, groups: [] };

  if (noLink.length > 0) {
    model.groups.push({
      severity: "info",
      segments: emphasizeMessage(`${storyCountLabel(noLink.length)} not synced — add a Jira link`),
      stories: noLink.map(storyLabel),
    });
  }

  if (noHours.length > 0) {
    model.groups.push({
      severity: "info",
      segments: emphasizeMessage(
        `${storyCountLabel(noHours.length)} not synced — add an FE/BE assignee or FE/BE/QC hours`,
      ),
      stories: noHours.map(storyLabel),
    });
  }

  if (discopedRows.length > 0) {
    model.groups.push({
      severity: "error",
      segments: emphasizeMessage("Discoped — not synced"),
      stories: discopedRows.map(storyLabel),
    });
  }

  model.groups.push(
    ...groupStoryMessages(
      jiraFailedRows.map((row) => ({
        story: storyLabel(row),
        message: row.error ?? "Unknown error",
      })),
      "error",
    ),
    ...groupStoryMessages(allActionFailures, "error"),
    ...groupStoryMessages(softWarnings, "warning"),
  );

  if (
    result.synced > 0 &&
    noLink.length === 0 &&
    noHours.length === 0 &&
    failedRows.length === 0 &&
    allActionFailures.length === 0 &&
    softWarnings.length === 0
  ) {
    model.groups.push({
      severity: "info",
      segments: [{ text: "Every visible story with a link and hours is up to date." }],
      stories: [],
    });
  }

  return buildBulkSummaryResult(model);
};

/** Plain-text sync summary (tests / legacy). */
export const formatBulkSyncSummary = (result: BulkSyncToJiraResult): string =>
  formatBulkSyncSummaryModel(result).text;

/** @deprecated Prefer bulkSyncHasActionErrors — kept for call sites that mean partial issues. */
export const bulkSyncHasPartialWarnings = (result: BulkSyncToJiraResult): boolean =>
  bulkSyncHasActionErrors(result) ||
  result.results.some((row) => row.ok && (row.warnings?.length ?? 0) > 0);
