import { parseJiraIssueKey } from "@/lib/integrations/jira/issueKey";
import { normalizeReleaseGroup } from "@/lib/scheduler/releaseGroups";
import type { Task } from "@/lib/scheduler/types";

/**
 * Whether a story matches a board search for a release group name or a Jira story number.
 * An empty query matches every story. "80878" matches BR-80878. "MMT" matches the group MMT2.
 * @param task - Story link, Jira key, and release group.
 * @param query - Text from the search box.
 * @returns True when the row should stay visible.
 */
export const taskMatchesBoardSearch = (
  task: Pick<Task, "storyLink" | "releaseGroup" | "jira">,
  query: string,
): boolean => {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const group = normalizeReleaseGroup(task.releaseGroup);
  if (group?.toLowerCase().includes(needle)) return true;

  const keys = [parseJiraIssueKey(task.storyLink), task.jira?.parentIssueKey?.trim()]
    .filter((key): key is string => Boolean(key));
  return keys.some((key) => key.toLowerCase().includes(needle));
};
