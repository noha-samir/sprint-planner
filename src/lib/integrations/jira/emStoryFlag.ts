/** True when Jira assignee or Engineering Manager field matches the squad EM account. */
export function resolveIsEmStory(
  emAccountId: string | null | undefined,
  assigneeAccountId: string | null | undefined,
  emFieldAccountId: string | null | undefined,
): boolean {
  const emId = emAccountId?.trim();
  if (!emId) return false;
  if (assigneeAccountId?.trim() === emId) return true;
  if (emFieldAccountId?.trim() === emId) return true;
  return false;
}
