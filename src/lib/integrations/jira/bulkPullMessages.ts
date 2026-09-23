import type { Task } from "@/lib/scheduler/types";
import type { TaskJiraMeta } from "./types";
import {
  appendSummaryGroups,
  buildBulkSummaryResult,
  emphasizeMessage,
  groupStoryMessages,
  partitionMessages,
  storyCountLabel,
  type BulkNotificationSummary,
  type BulkSummaryResult,
  type StoryMessage,
} from "./bulkNotificationFormat";

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

const collectRowMessages = (result: BulkPullFromJiraResult): StoryMessage[] =>
  result.results.flatMap((row) =>
    (row.warnings ?? []).map((message) => ({ story: storyLabel(row), message })),
  );

/** True when pull left intended updates unfinished (assignees, subtasks, etc.). */
export const bulkPullHasActionErrors = (result: BulkPullFromJiraResult): boolean => {
  if (result.failed > 0) return true;
  return partitionMessages(collectRowMessages(result)).actionFailures.length > 0;
};

/**
 * Structured + plain-text bulk pull result summary — groups identical issues under one message.
 */
export const formatBulkPullSummaryModel = (result: BulkPullFromJiraResult): BulkSummaryResult => {
  const noLink = result.results.filter(
    (row) => row.skipped && row.skipReason === JIRA_BULK_PULL_SKIP_REASON.NO_LINK,
  );
  const failedRows = result.results.filter((row) => !row.ok && !row.skipped);
  const discopedRows = failedRows.filter((row) => row.error === JIRA_BULK_PULL_SKIP_REASON.DISCOPED);
  const jiraFailedRows = failedRows.filter((row) => row.error !== JIRA_BULK_PULL_SKIP_REASON.DISCOPED);
  const { actionFailures, softWarnings } = partitionMessages(collectRowMessages(result));

  const headline =
    result.synced > 0
      ? `${storyCountLabel(result.synced)} pulled from Jira.`
      : "No stories were pulled from Jira.";

  const model: BulkNotificationSummary = { headline, groups: [] };

  if (noLink.length > 0) {
    model.groups.push({
      severity: "info",
      segments: emphasizeMessage(
        `${storyCountLabel(noLink.length)} not pulled — add a Jira link`,
      ),
      stories: noLink.map(storyLabel),
    });
  }

  if (discopedRows.length > 0) {
    model.groups.push({
      severity: "error",
      segments: emphasizeMessage("Discoped — not pulled"),
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
    ...groupStoryMessages(actionFailures, "error"),
    ...groupStoryMessages(softWarnings, "warning"),
  );

  return buildBulkSummaryResult(model);
};

/** Plain-text pull summary (tests / legacy). */
export const formatBulkPullSummary = (result: BulkPullFromJiraResult): string =>
  formatBulkPullSummaryModel(result).text;

export const withDiscoverWarning = (
  summary: BulkSummaryResult,
  discoverWarning: string | null | undefined,
  importedLine?: string,
): BulkSummaryResult => {
  let model = summary.model;
  if (importedLine?.trim()) {
    model = { ...model, headline: [importedLine.trim(), model.headline].filter(Boolean).join(" ") };
  }
  if (discoverWarning?.trim()) {
    model = appendSummaryGroups(model, [
      {
        severity: "warning",
        segments: emphasizeMessage(discoverWarning.trim()),
        stories: [],
      },
    ]);
  }
  return buildBulkSummaryResult(model);
};
