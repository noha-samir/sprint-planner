import type { Resource, ResourceType } from "@/lib/scheduler/types";

export type PlannerPersonRef = {
  name: string;
  nickname?: string | null;
  type?: ResourceType | string | null;
};

const normalize = (value: string) => value.trim().toLowerCase();

/**
 * Product owners / POs who must never land in FE/BE/MO/QC assignee slots,
 * even if their roster type was set incorrectly.
 */
export const BLOCKED_ENGINEERING_ASSIGNEE_NAMES = ["Ali Rekaby"] as const;

const aliasesFor = (person: PlannerPersonRef): string[] => {
  const aliases = [person.name, person.nickname ?? ""]
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(aliases)];
};

/** Roster name (same as Jira display name after sync). */
export const resourceDisplayName = (resource: Pick<Resource, "name" | "nickname">): string =>
  resource.name;

/**
 * Match a free-text label (Jira display name or orphan assignee) onto one roster person.
 * Prefers exact name/nickname, then unique whole-word / containment matches.
 */
export const matchPlannerPerson = (
  label: string,
  people: PlannerPersonRef[],
): PlannerPersonRef | null => {
  const trimmed = label.trim();
  if (!trimmed || people.length === 0) {
    return null;
  }
  const lower = normalize(trimmed);

  const exact = people.find((person) =>
    aliasesFor(person).some((alias) => normalize(alias) === lower),
  );
  if (exact) {
    return exact;
  }

  const words = lower.split(/\s+/).filter(Boolean);
  const wordHits = people.filter((person) =>
    aliasesFor(person).some((alias) => {
      const aliasLower = normalize(alias);
      return words.includes(aliasLower);
    }),
  );
  if (wordHits.length === 1) {
    return wordHits[0];
  }

  const contained = people.filter((person) =>
    aliasesFor(person).some((alias) => {
      const aliasLower = normalize(alias);
      if (aliasLower.length < 3) {
        return false;
      }
      return lower.includes(aliasLower) || aliasLower.includes(lower);
    }),
  );
  if (contained.length === 1) {
    return contained[0];
  }

  return null;
};

export const matchResourceByAssigneeLabel = (
  label: string,
  resources: Resource[],
): Resource | null => {
  const matched = matchPlannerPerson(
    label,
    resources.map((resource) => ({ name: resource.name, nickname: resource.nickname })),
  );
  if (!matched) {
    return null;
  }
  return resources.find((resource) => resource.name === matched.name) ?? null;
};

/** True when this person must not be treated as an engineer assignee (FE/BE/MO/QC). */
export const isBlockedEngineeringAssignee = (
  name: string,
  people: PlannerPersonRef[] = [],
): boolean => {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const lower = normalize(trimmed);
  if (BLOCKED_ENGINEERING_ASSIGNEE_NAMES.some((blocked) => normalize(blocked) === lower)) {
    return true;
  }
  const person = matchPlannerPerson(trimmed, people);
  return person?.type === "PM";
};

/** Remap assignee labels onto roster canonical names when a unique match exists. */
export const coerceAssigneeNamesToRoster = (names: string[], resources: Resource[]): string[] => {
  if (!Array.isArray(names) || names.length === 0 || resources.length === 0) {
    return Array.isArray(names) ? names : [];
  }
  return names.map((name) => {
    const trimmed = name.trim();
    if (!trimmed) {
      return name;
    }
    return matchResourceByAssigneeLabel(trimmed, resources)?.name ?? trimmed;
  });
};

/**
 * Coerce to roster names, then keep only people allowed for this role slot.
 * Drops PMs and known product owners from engineering slots (FE/BE/MO/QC).
 */
export const coerceAssigneesForRole = (
  names: string[],
  resources: Resource[],
  allowedTypes: readonly ResourceType[],
): string[] => {
  const coerced = coerceAssigneeNamesToRoster(names, resources);
  const allowed = new Set(allowedTypes);
  const engineeringSlot = [...allowed].some((type) =>
    type === "FE" || type === "BE" || type === "MO" || type === "QC",
  );
  return coerced.filter((name) => {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (engineeringSlot && isBlockedEngineeringAssignee(trimmed, resources)) {
      return false;
    }
    const resource = matchResourceByAssigneeLabel(trimmed, resources);
    if (!resource) {
      return true;
    }
    return allowed.has(resource.type);
  });
};

export const peopleFromResources = (resources: Resource[]): PlannerPersonRef[] =>
  resources.map((resource) => ({
    name: resource.name,
    nickname: resource.nickname,
    type: resource.type,
  }));
