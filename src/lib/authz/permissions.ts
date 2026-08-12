import type { ResolvedEntitlements, SquadMembershipRole } from "./types";

const SAFE_SQUAD = /^[a-z0-9_-]{1,64}$/;

/**
 * Normalize a squad id for storage and comparison.
 * Maps empty/"default" → ventures; rejects unsafe characters.
 */
export function sanitizeSquadKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === "default") return "ventures";
  if (!SAFE_SQUAD.test(trimmed)) return null;
  return trimmed;
}

/** Unique sanitized squad ids from entitlement memberships. */
export function allowedSquadIdsFromEntitlements(ent: ResolvedEntitlements): string[] {
  const ids = new Set<string>();
  for (const m of ent.memberships) {
    const id = sanitizeSquadKey(m.squadId);
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Read access: global admin or squad in allowedSquads. */
export function canReadSquad(params: {
  globalAdmin: boolean;
  allowedSquads: string[];
  squadId: string | null;
}): boolean {
  const safe = sanitizeSquadKey(params.squadId);
  if (!safe) return false;
  if (params.globalAdmin) return true;
  return params.allowedSquads.includes(safe);
}

/** Write access: global admin, or squad membership role em/editor. */
export function canWriteSquad(params: {
  globalAdmin: boolean;
  squadRoles: Record<string, SquadMembershipRole>;
  squadId: string | null;
}): boolean {
  const safe = sanitizeSquadKey(params.squadId);
  if (!safe) return false;
  if (params.globalAdmin) return true;
  const role = params.squadRoles[safe];
  return role === "em" || role === "editor";
}
