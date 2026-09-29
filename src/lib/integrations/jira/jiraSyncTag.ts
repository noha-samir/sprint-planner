/** Tag applied to dashboard rows created by Pull from Jira (missing EM/squad stories). */
export const JIRA_SYNC_ADDED_TAG = "Jira sync";

/** Tag applied when pull changed the planner status from subtasks and Jira still needs a push. */
export const JIRA_NEEDS_PUSH_TAG = "Needs push";

/**
 * Add or remove the Needs push tag.
 * @param tags - Current task tags.
 * @param needsPush - True to add the tag, false to remove it.
 * @returns A new tag list, or the same array when nothing changed.
 */
export const withNeedsPushTag = (tags: string[] | undefined, needsPush: boolean): string[] => {
  const current = tags ?? [];
  const hasTag = current.includes(JIRA_NEEDS_PUSH_TAG);
  if (needsPush === hasTag) return current;
  return needsPush ? [...current, JIRA_NEEDS_PUSH_TAG] : current.filter((tag) => tag !== JIRA_NEEDS_PUSH_TAG);
};
