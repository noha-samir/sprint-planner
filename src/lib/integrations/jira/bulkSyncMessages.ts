import type { TaskJiraMeta } from "./types";

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

const storyCountLabel = (count: number): string => (count === 1 ? "1 story" : `${count} stories`);

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

/**
 * User-friendly bulk sync result summary for the UI.
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
  const warningLines = result.results.flatMap((row) =>
    (row.warnings ?? []).map((warning) => `• ${storyLabel(row)}: ${warning}`),
  );
  const assigneeErrorLines = result.results.flatMap((row) =>
    (row.errors ?? []).map((error) => `• ${error}`),
  );

  const lines: string[] = [];

  if (result.synced > 0) {
    lines.push(`${storyCountLabel(result.synced)} synced to Jira.`);
  } else {
    lines.push("No stories were synced to Jira.");
  }

  if (noLink.length > 0) {
    lines.push(
      `${storyCountLabel(noLink.length)} not synced — add a Jira link:\n${noLink.map((row) => `• ${storyLabel(row)}`).join("\n")}`,
    );
  }

  if (noHours.length > 0) {
    lines.push(
      `${storyCountLabel(noHours.length)} not synced — add an FE/BE assignee or FE/BE/QC hours:\n${noHours.map((row) => `• ${storyLabel(row)}`).join("\n")}`,
    );
  }

  if (discopedRows.length > 0) {
    lines.push(
      `Errors — Discoped stories are not synced to Jira:\n${discopedRows.map((row) => `• ${storyLabel(row)}`).join("\n")}`,
    );
  }

  if (jiraFailedRows.length > 0) {
    lines.push(
      `${storyCountLabel(jiraFailedRows.length)} failed — Jira returned an error:\n${jiraFailedRows.map((row) => `• ${storyLabel(row)}: ${row.error ?? "Unknown error"}`).join("\n")}`,
    );
  }

  if (warningLines.length > 0) {
    lines.push(`Warnings:\n${warningLines.join("\n")}`);
  }

  if (assigneeErrorLines.length > 0) {
    lines.push(
      `Warnings — some subtasks were not created/updated (fix assignees or Jira errors and sync again):\n${assigneeErrorLines.join("\n")}`,
    );
  }

  if (
    result.synced > 0 &&
    noLink.length === 0 &&
    noHours.length === 0 &&
    failedRows.length === 0 &&
    warningLines.length === 0 &&
    assigneeErrorLines.length === 0
  ) {
    lines.push("Every visible story with a link and hours is up to date.");
  }

  return lines.join("\n\n");
};

/** True when push partially succeeded but some subtasks/assignees failed. */
export const bulkSyncHasPartialWarnings = (result: BulkSyncToJiraResult): boolean =>
  result.results.some(
    (row) =>
      (row.ok && ((row.errors?.length ?? 0) > 0 || (row.warnings?.length ?? 0) > 0)) ||
      false,
  );
