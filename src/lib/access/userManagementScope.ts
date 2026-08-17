import { sanitizeSquadKey } from "@/lib/authz/permissions";
import type { AccessRegistry, UserAccount } from "./registry";

export type UserSquadFilter = "all" | (string & {});

export const isUnrestrictedUserManagement = (access: {
  globalAdmin?: boolean;
  role?: string;
}): boolean => Boolean(access.globalAdmin) || access.role === "super_admin";

/**
 * Squad ids a viewer may see on User Management.
 * Super admin: null (all squads). Others: allowed / primary squads only.
 */
export const allowedSquadIdsForUserManagement = (access: {
  globalAdmin?: boolean;
  role?: string;
  squadId?: string | null;
  allowedSquads?: string[];
}): string[] | null => {
  if (isUnrestrictedUserManagement(access)) {
    return null;
  }
  const ids = new Set<string>();
  for (const raw of access.allowedSquads ?? []) {
    const id = sanitizeSquadKey(raw);
    if (id) ids.add(id);
  }
  const primary = sanitizeSquadKey(access.squadId ?? null);
  if (primary) ids.add(primary);
  return [...ids];
};

export const emailsOnSquad = (registry: Pick<AccessRegistry, "users" | "squadAccounts">, squadId: string): Set<string> => {
  const emails = new Set<string>();
  for (const user of registry.users) {
    if (user.squadId === squadId) {
      emails.add(user.email.trim().toLowerCase());
    }
  }
  for (const row of registry.squadAccounts) {
    if (row.squadId === squadId) {
      emails.add(row.email.trim().toLowerCase());
    }
  }
  return emails;
};

/**
 * Whether a user row belongs to the selected squad (primary squadId or extra membership).
 * Unsaved empty emails stay visible so a new row is not hidden by the filter.
 */
export const userMatchesSquadFilter = (
  user: Pick<UserAccount, "email" | "squadId"> & { savedEmail?: string | null },
  squadFilter: UserSquadFilter,
  registry: Pick<AccessRegistry, "squadAccounts">,
): boolean => {
  if (squadFilter === "all") {
    return true;
  }
  if (!user.email.trim() && !user.savedEmail) {
    return true;
  }
  if (user.squadId === squadFilter) {
    return true;
  }
  const email = user.email.trim().toLowerCase() || user.savedEmail?.trim().toLowerCase() || "";
  if (!email) {
    return true;
  }
  return registry.squadAccounts.some(
    (row) => row.squadId === squadFilter && row.email.trim().toLowerCase() === email,
  );
};

/**
 * Strip squads / users the viewer is not entitled to see.
 */
export const scopeAccessRegistry = (
  registry: AccessRegistry,
  allowedSquadIds: string[] | null,
): AccessRegistry => {
  if (allowedSquadIds == null) {
    return registry;
  }
  const allowed = new Set(allowedSquadIds);
  const emails = new Set<string>();
  for (const squadId of allowed) {
    for (const email of emailsOnSquad(registry, squadId)) {
      emails.add(email);
    }
  }
  return {
    squads: registry.squads.filter((squad) => allowed.has(squad.id)),
    users: registry.users.filter(
      (user) => emails.has(user.email.trim().toLowerCase()) || Boolean(user.squadId && allowed.has(user.squadId)),
    ),
    squadAccounts: registry.squadAccounts.filter((row) => Boolean(row.squadId && allowed.has(row.squadId))),
  };
};
