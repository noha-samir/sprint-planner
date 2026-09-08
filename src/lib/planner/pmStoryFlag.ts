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
