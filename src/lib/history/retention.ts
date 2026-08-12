import type { SprintHistoryEntry } from "./types";

export const keepNewestPerSquad = (
  entries: SprintHistoryEntry[],
  squadId: string,
  limit: number,
): SprintHistoryEntry[] => {
  let keptForSquad = 0;
  const normalizedTarget =
    squadId.toLowerCase() === "default" ||
    squadId.toLowerCase() === "ventures"
      ? "ventures"
      : squadId.toLowerCase();
  return entries.filter((entry) => {
    const rawEntrySquadId = entry.squadId ?? "ventures";
    const entrySquadId =
      rawEntrySquadId.toLowerCase() === "default" ||
      rawEntrySquadId.toLowerCase() === "ventures"
        ? "ventures"
        : rawEntrySquadId.toLowerCase();
    if (entrySquadId !== normalizedTarget) return true;
    if (keptForSquad >= limit) return false;
    keptForSquad += 1;
    return true;
  });
};
