/** Maps a Jira issue type label to the corresponding CSS modifier class for the type badge chip. */
export function issueTypeChipClass(issueType: string): string {
  const t = issueType.toLowerCase().trim();
  if (t === "story") return "task-flag-chip-type-story";
  if (t === "bug") return "task-flag-chip-type-bug";
  if (t === "technical task") return "task-flag-chip-type-technical";
  if (t === "epic") return "task-flag-chip-type-epic";
  return "task-flag-chip-type-task";
}
