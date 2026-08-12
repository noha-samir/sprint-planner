import type { Session } from "next-auth";
import { NextResponse } from "next/server";
import { readAccessRegistry } from "@/lib/access/registry";
import { canReadSquad, canWriteSquad, sanitizeSquadKey } from "@/lib/authz/permissions";
import type { SquadMembershipRole } from "@/lib/authz/types";
import { normalizeUserRole, type UserRole } from "./control";

export interface SessionAccess {
  email: string;
  role: UserRole;
  squadId: string | null;
  globalAdmin: boolean;
  allowedSquads: string[];
  squadRoles: Record<string, SquadMembershipRole>;
}

export const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

function coerceSquadRoles(value: unknown): Record<string, SquadMembershipRole> {
  if (!value || typeof value !== "object") return {};
  const out: Record<string, SquadMembershipRole> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const id = sanitizeSquadKey(k);
    if (!id) continue;
    if (v === "em" || v === "editor" || v === "reviewer") out[id] = v;
  }
  return out;
}

/**
 * Derive server-side access from the NextAuth session.
 * Returns null when the session is missing or revoked.
 * Editors are forced to their primary squad only.
 */
export const getSessionAccess = (session: Session | null): SessionAccess | null => {
  if (session?.error === "SessionRevoked") {
    return null;
  }
  const email = session?.user?.email?.toLowerCase();
  const role = normalizeUserRole(session?.user?.role);
  if (!email || !role) {
    return null;
  }
  const globalAdmin = role === "super_admin" || Boolean(session?.user?.globalAdmin);
  const rawAllowed = session?.user?.allowedSquads;
  let allowedSquads = Array.isArray(rawAllowed)
    ? (rawAllowed.map((s) => sanitizeSquadKey(String(s))).filter(Boolean) as string[])
    : [];
  const primarySquad = sanitizeSquadKey(session?.user?.squadId ?? null);
  if (allowedSquads.length === 0 && primarySquad) {
    allowedSquads = [primarySquad];
  }
  let squadRoles = coerceSquadRoles(session?.user?.squadRoles);
  if (Object.keys(squadRoles).length === 0 && primarySquad) {
    squadRoles =
      role === "em"
        ? { [primarySquad]: "em" }
        : role === "editor"
          ? { [primarySquad]: "editor" }
          : role === "reviewer"
            ? { [primarySquad]: "reviewer" }
            : squadRoles;
  }

  // Editor is locked to their own squad only (primary), even if the token lists more.
  if (role === "editor") {
    allowedSquads = primarySquad ? [primarySquad] : [];
    squadRoles = primarySquad ? { [primarySquad]: "editor" } : {};
  }

  return {
    email,
    role,
    squadId: primarySquad,
    globalAdmin,
    allowedSquads,
    squadRoles,
  };
};

/**
 * Resolve which squad id an API call should use (request override vs session vs first allowed).
 */
export async function resolveRequestedSquadId(
  access: SessionAccess,
  squadIdFromRequest: string | null | undefined,
): Promise<string | null> {
  const requested = sanitizeSquadKey(squadIdFromRequest ?? null);
  const fallback = sanitizeSquadKey(access.squadId);
  if (access.globalAdmin || access.role === "super_admin") {
    const registry = await readAccessRegistry();
    const known = new Set(registry.squads.map((s) => sanitizeSquadKey(s.id)).filter(Boolean) as string[]);
    if (requested && known.has(requested)) return requested;
    if (fallback && known.has(fallback)) return fallback;
    const first =
      registry.squads.find((s) => !s.hidden)?.id ?? registry.squads[0]?.id ?? null;
    return sanitizeSquadKey(first);
  }
  if (requested && access.allowedSquads.includes(requested)) return requested;
  if (fallback && access.allowedSquads.includes(fallback)) return fallback;
  const firstAllowed = access.allowedSquads[0] ?? null;
  return sanitizeSquadKey(firstAllowed);
}

export const canReadFromSession = (access: SessionAccess | null, squadId: string | null): boolean => {
  if (!access) return false;
  return canReadSquad({
    globalAdmin: access.globalAdmin || access.role === "super_admin",
    allowedSquads: access.allowedSquads,
    squadId,
  });
};

/** Whether the session may mutate planner/Jira write APIs for the squad. */
export const canWriteFromSession = (access: SessionAccess | null, squadId: string | null): boolean => {
  if (!access) return false;
  return canWriteSquad({
    globalAdmin: access.globalAdmin || access.role === "super_admin",
    squadRoles: access.squadRoles,
    squadId,
  });
};
