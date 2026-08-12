const squadIcons = ["🧩", "🚀", "🛠️", "📦", "⚡", "🧠", "🌊", "🎯"];

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const normalizeSquadId = (squadId: string | null | undefined): string => (squadId ?? "").trim().toLowerCase();

const resolveIconIndex = (targetId: string, allSquadIds: string[]): number => {
  const normalizedIds = allSquadIds
    .map((id) => normalizeSquadId(id))
    .filter((id, index, source) => Boolean(id) && source.indexOf(id) === index)
    .sort();
  const used = new Set<number>();
  for (const id of normalizedIds) {
    const base = hashString(id) % squadIcons.length;
    let slot = base;
    let tries = 0;
    while (used.has(slot) && tries < squadIcons.length) {
      slot = (slot + 1) % squadIcons.length;
      tries += 1;
    }
    if (!used.has(slot)) used.add(slot);
    if (id === targetId) return slot;
  }
  return hashString(targetId) % squadIcons.length;
};

export const getSquadIcon = (
  squadId: string | null | undefined,
  allSquadIds: string[] = [],
): string => {
  const normalizedTarget = normalizeSquadId(squadId);
  if (!normalizedTarget) return "🧩";
  const ids = allSquadIds.length > 0 ? allSquadIds : [normalizedTarget];
  return squadIcons[resolveIconIndex(normalizedTarget, ids)];
};
