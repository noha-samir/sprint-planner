/**
 * Match a Jira transition that lands on the target status name.
 */

export type JiraTransitionOption = {
  id: string;
  name: string;
  toStatusName: string;
};

const normalize = (value: string) => value.trim().toLowerCase();

export const isSameJiraStatus = (currentStatusName: string, targetStatusName: string): boolean =>
  normalize(currentStatusName) === normalize(targetStatusName);

/**
 * Pick a transition that lands on the target Jira status name.
 * Prefers exact `to.status` match; falls back to transition name match.
 */
export const pickTransitionForTargetStatus = (
  transitions: JiraTransitionOption[],
  targetStatusName: string,
): JiraTransitionOption | null => {
  const target = normalize(targetStatusName);
  if (!target || transitions.length === 0) {
    return null;
  }

  const byToStatus = transitions.find((item) => normalize(item.toStatusName) === target);
  if (byToStatus) {
    return byToStatus;
  }

  return transitions.find((item) => normalize(item.name) === target) ?? null;
};
