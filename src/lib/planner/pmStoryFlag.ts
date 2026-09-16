/**
 * True when Jira assignee matches any squad PM account id (from User Management pmEmails).
 */
export function resolveIsPmStory(
  pmAccountIds: string[] | null | undefined,
  assigneeAccountId: string | null | undefined,
): boolean {
  const assignee = assigneeAccountId?.trim();
  if (!assignee || !pmAccountIds?.length) return false;
  return pmAccountIds.some((id) => id.trim() === assignee);
}

/**
 * True when the story lists at least one squad PM (roster name match, case-insensitive).
 */
export function isSquadPmStory(
  productManagers: string[] | null | undefined,
  squadPmNames: string[] | null | undefined,
): boolean {
  if (!productManagers?.length || !squadPmNames?.length) return false;
  const pmSet = new Set(squadPmNames.map((name) => name.trim().toLowerCase()).filter(Boolean));
  if (pmSet.size === 0) return false;
  return productManagers.some((name) => pmSet.has(name.trim().toLowerCase()));
}

/**
 * Owner PM filter: Jira assignee marked as squad PM, or Product Managers column matches.
 */
export function isOwnerPmStory(
  task: { isPmStory?: boolean; productManagers?: string[] | null },
  squadPmNames: string[] | null | undefined,
): boolean {
  if (task.isPmStory) return true;
  return isSquadPmStory(task.productManagers, squadPmNames);
}
