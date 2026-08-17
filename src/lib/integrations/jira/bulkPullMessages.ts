import type { Task } from "@/lib/scheduler/types";
import type { TaskJiraMeta } from "./types";

export interface BulkPullTaskResult {
  taskId: string;
  storyName: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: string;
  patch?: Partial<Task>;
  jira?: TaskJiraMeta;
  warnings?: string[];
  error?: string;
}

export interface BulkPullFromJiraResult {
  results: BulkPullTaskResult[];
  synced: number;
  failed: number;
  skipped: number;
}

export const JIRA_BULK_PULL_SKIP_REASON = {
  NO_LINK: "No valid Jira story link",
  DISCOPED: "Discoped stories are not synced from Jira",
} as const;

const storyLabel = (row: BulkPullTaskResult): string => row.storyName.trim() || row.taskId;

const storyCountLabel = (count: number): string => (count === 1 ? "1 story" : `${count} stories`);

export const formatBulkPullConfirmMessage = (
  eligibleCount: number,
  visibleCount: number,
  discopedCount = 0,
  missingEmCount = 0,
): string => {
  const softLeftOut = Math.max(0, visibleCount - eligibleCount - discopedCount);
  const parts: string[] = [];
  if (eligibleCount > 0) {
    parts.push(`Pull ${storyCountLabel(eligibleCount)} from Jira?`);
  } else if (missingEmCount > 0) {
    parts.push(
      `Add ${storyCountLabel(missingEmCount)} from Jira under this EM that ${missingEmCount === 1 ? "is" : "are"} not on the dashboard?`,
    );
  } else {
    parts.push(`Pull ${storyCountLabel(0)} from Jira?`);
  }
  if (eligibleCount > 0 && missingEmCount > 0) {
    parts.push(
      `Also add ${storyCountLabel(missingEmCount)} under this EM that ${missingEmCount === 1 ? "is" : "are"} not on the dashboard.`,
    );
  }
  if (softLeftOut > 0) {
    parts.push(
      `${storyCountLabel(softLeftOut)} will be left out — no Jira link. ` +
        `Left out is not a failure; Jira is simply not called for those rows.`,
    );
  }
  if (discopedCount > 0) {
    parts.push(
      `${storyCountLabel(discopedCount)} Discoped — not pulled from Jira (reported as errors).`,
    );
  }
  return parts.join("\n\n");
};

export const formatBulkPullSummary = (result: BulkPullFromJiraResult): string => {
  const noLink = result.results.filter(
    (row) => row.skipped && row.skipReason === JIRA_BULK_PULL_SKIP_REASON.NO_LINK,
  );
  const failedRows = result.results.filter((row) => !row.ok && !row.skipped);
  const discopedRows = failedRows.filter((row) => row.error === JIRA_BULK_PULL_SKIP_REASON.DISCOPED);
  const jiraFailedRows = failedRows.filter((row) => row.error !== JIRA_BULK_PULL_SKIP_REASON.DISCOPED);
  const warningLines = result.results.flatMap((row) =>
    (row.warnings ?? []).map((warning) => `• ${storyLabel(row)}: ${warning}`),
  );

  const lines: string[] = [];
  if (result.synced > 0) {
    lines.push(`${storyCountLabel(result.synced)} pulled from Jira.`);
  } else {
    lines.push("No stories were pulled from Jira.");
  }

  if (noLink.length > 0) {
    lines.push(
      `${storyCountLabel(noLink.length)} not pulled — add a Jira link:\n${noLink.map((row) => `• ${storyLabel(row)}`).join("\n")}`,
    );
  }

  if (discopedRows.length > 0) {
    lines.push(
      `Errors — Discoped stories are not synced from Jira:\n${discopedRows.map((row) => `• ${storyLabel(row)}`).join("\n")}`,
    );
  }

  if (jiraFailedRows.length > 0) {
    lines.push(
      `${storyCountLabel(jiraFailedRows.length)} failed — Jira returned an error:\n${jiraFailedRows
        .map((row) => `• ${storyLabel(row)}: ${row.error ?? "Unknown error"}`)
        .join("\n")}`,
    );
  }

  if (warningLines.length > 0) {
    lines.push(`Warnings:\n${warningLines.join("\n")}`);
  }

  return lines.join("\n\n");
};
