import { readAccessRegistry, resolveUserAccount, type UserAccount } from "@/lib/access/registry";
import { fetchIdentityEntitlements } from "./identityClient";
import { sanitizeSquadKey } from "./permissions";
import type { ResolvedEntitlements, SquadEntitlement, SquadMembershipRole } from "./types";

function accountToMembership(account: UserAccount): SquadEntitlement[] {
  if (account.role === "super_admin") return [];
  const role: SquadMembershipRole =
    account.role === "em" ? "em" : account.role === "editor" ? "editor" : "reviewer";
  if (!account.squadId) return [];
  return [{ squadId: account.squadId, role }];
}

async function entitlementsFromRegistry(email: string): Promise<ResolvedEntitlements> {
  const account = await resolveUserAccount(email);
  if (!account) {
    return { globalAdmin: false, memberships: [] };
  }
  const globalAdmin = account.role === "super_admin";
  if (globalAdmin) {
    const registry = await readAccessRegistry();
    const memberships: SquadEntitlement[] = registry.squads
      .filter((s) => !s.hidden)
      .map((s) => ({ squadId: s.id, name: s.name, role: "em" as const }));
    return { globalAdmin: true, memberships };
  }

  const registry = await readAccessRegistry();
  const known = new Set(registry.squads.map((s) => sanitizeSquadKey(s.id)).filter(Boolean) as string[]);
  const memberships = accountToMembership(account).filter((m) => known.has(sanitizeSquadKey(m.squadId) ?? ""));
  // Include all squadAccounts rows for this email (multi-squad).
  for (const row of registry.squadAccounts) {
    if (row.email !== email.trim().toLowerCase()) continue;
    const id = sanitizeSquadKey(row.squadId);
    if (!id || !known.has(id)) continue;
    if (memberships.some((m) => sanitizeSquadKey(m.squadId) === id)) continue;
    memberships.push({
      squadId: id,
      role: row.role === "em" ? "em" : row.role === "editor" ? "editor" : "reviewer",
    });
  }
  return { globalAdmin: false, memberships };
}

function intersectKnownSquads(
  memberships: SquadEntitlement[],
  knownSquadIds: Set<string>,
): SquadEntitlement[] {
  return memberships
    .map((m) => {
      const id = sanitizeSquadKey(m.squadId);
      if (!id || !knownSquadIds.has(id)) return null;
      return { ...m, squadId: id };
    })
    .filter((m): m is SquadEntitlement => m != null);
}

/**
 * Merge remote identity entitlements with local registry.
 * - Transport failure (remote null): fall back to registry.
 * - Successful empty memberships when identity is configured: deny (do not open-enroll).
 * - Local registry super_admin always wins (identity cannot demote a DB super_admin).
 * - remote globalAdmin only if the local registry also marks the user super_admin.
 */
function mergeIdentityWithRegistry(
  remote: ResolvedEntitlements | null,
  registryFallback: ResolvedEntitlements,
  knownSquadIds: Set<string>,
  identityConfigured: boolean,
): ResolvedEntitlements {
  if (!remote) {
    return {
      globalAdmin: registryFallback.globalAdmin,
      memberships: intersectKnownSquads(registryFallback.memberships, knownSquadIds),
    };
  }

  // Local super_admin is authoritative — never demote to identity squad roles.
  if (registryFallback.globalAdmin) {
    const remoteMemberships = intersectKnownSquads(remote.memberships, knownSquadIds);
    return {
      globalAdmin: true,
      memberships:
        remoteMemberships.length > 0
          ? remoteMemberships
          : intersectKnownSquads(registryFallback.memberships, knownSquadIds),
    };
  }

  if (identityConfigured && !remote.globalAdmin && remote.memberships.length === 0) {
    return { globalAdmin: false, memberships: [] };
  }

  const remoteMemberships = intersectKnownSquads(remote.memberships, knownSquadIds);

  if (remoteMemberships.length > 0) {
    return { globalAdmin: false, memberships: remoteMemberships };
  }

  return {
    globalAdmin: false,
    memberships: intersectKnownSquads(registryFallback.memberships, knownSquadIds),
  };
}

/**
 * Merge remote identity entitlements with the local access registry.
 * Local super_admin always wins; when identity is configured, empty remote memberships deny access.
 *
 * @param email - User email (normalized internally)
 * @returns globalAdmin flag + squad memberships for session building
 */
export async function resolveEntitlements(email: string): Promise<ResolvedEntitlements> {
  const normalized = email.trim().toLowerCase();
  const registry = await readAccessRegistry();
  const knownSquadIds = new Set(
    registry.squads.map((s) => sanitizeSquadKey(s.id)).filter((id): id is string => id != null),
  );
  const registryBased = await entitlementsFromRegistry(normalized);
  const identityConfigured = Boolean(process.env.IDENTITY_SERVICE_BASE_URL?.trim());
  const remote = await fetchIdentityEntitlements(normalized);
  return mergeIdentityWithRegistry(remote, registryBased, knownSquadIds, identityConfigured);
}
