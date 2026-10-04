/** Tag applied to dashboard rows created by Pull from Jira (missing EM/squad stories). */
export const JIRA_SYNC_ADDED_TAG = "Jira sync";

/** Legacy tag that once flagged a pending push; "Needs push" is now derived from `jira.syncedFields`. */
export const JIRA_NEEDS_PUSH_TAG = "Needs push";

/**
 * Remove the legacy Needs push tag left on stories by older pulls.
 * @param tags - Current task tags.
 * @returns The tags without the legacy tag, or the same reference when it was not present.
 */
export const withoutLegacyNeedsPushTag = (tags: string[] | undefined): string[] | undefined =>
  tags?.includes(JIRA_NEEDS_PUSH_TAG) ? tags.filter((tag) => tag !== JIRA_NEEDS_PUSH_TAG) : tags;
