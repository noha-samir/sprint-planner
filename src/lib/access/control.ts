import { sanitizeSquadKey } from "@/lib/authz/permissions";
import type { SquadMembershipRole } from "@/lib/authz/types";

export type UserRole = "reviewer" | "editor" | "em" | "super_admin";

export interface AccessContext {
  email: string;
  role: UserRole | "viewer";
  squadId: string | null;
  activeSquadId?: string | null;
  squadRoles?: Record<string, SquadMembershipRole>;
  allowedSquads?: string[];
  globalAdmin?: boolean;
}

export interface AccessCapabilities {
  /** Edit Dashboard / Timeline / History planner data for the active squad. */
  canWrite: boolean;
  /**
   * EM / super-admin sprint controls on the dashboard:
   * move next/current sprint, buffer hours, mark progress, start new sprint.
   * Editors with canWrite still cannot use these.
   */
  canManageSprintLifecycle: boolean;
  /** Write User Management (create/update/delete users & squads). */
  canManageUsers: boolean;
  /** Open User Management read-only (or with write if canManageUsers). */
  canViewUserManagement: boolean;
  /** Open People & Jira + Sprint Settings (view). */
  canAccessOpsTabs: boolean;
  /** Edit People & Jira + Sprint Settings (super admin only). */
  canEditOpsTabs: boolean;
  canAccessSquad: (squadId: string) => boolean;
}

/**
 * Normalize a raw role string from session/registry into a known UserRole.
 * Legacy alias: viewer → reviewer.
 */
export const normalizeUserRole = (role: string | undefined): UserRole | null => {
  if (role === "super_admin" || role === "em" || role === "editor" || role === "reviewer") return role;
  if (role === "viewer") return "reviewer";
  return null;
};

/**
 * Role matrix:
 * - super_admin: see + edit everything
 * - reviewer: see everything, edit nothing
 * - editor: see + edit Dashboard / Timeline / History for own squad only
 *           (except sprint lifecycle: move sprint, buffer, mark progress, new sprint);
 *           see People / Sprint Settings / User Management with no edit
 * - em: see + edit Dashboard / Timeline / History for own squad (full dashboard controls);
 *       see People / Sprint Settings / User Management with no edit
 *
 * @param access - Session-derived access context (role, squad, membership map)
 * @returns Capability flags used by UI and write gates
 */
export const getCapabilities = (access: AccessContext): AccessCapabilities => {
  const role = normalizeUserRole(access.role) ?? "reviewer";
  const globalAdmin = role === "super_admin" || Boolean(access.globalAdmin);
  const active = sanitizeSquadKey(access.activeSquadId ?? access.squadId ?? null);
  const primary = sanitizeSquadKey(access.squadId ?? null);
  const map = access.squadRoles ?? {};

  let canWrite = globalAdmin;
  if (!canWrite && active) {
    if (role === "editor") {
      // Editor: write only on their own (primary) squad.
      canWrite = primary != null && active === primary && (map[active] === "editor" || Object.keys(map).length === 0);
    } else if (map[active] === "em" || map[active] === "editor") {
      canWrite = true;
    } else if (Object.keys(map).length === 0 && role === "em" && primary === active) {
      canWrite = true;
    }
  }

  const canManageSprintLifecycle = canWrite && (globalAdmin || role === "em");
  const canManageUsers = globalAdmin;
  const canEditOpsTabs = globalAdmin;
  const canAccessOpsTabs = globalAdmin || role === "em" || role === "editor" || role === "reviewer";
  const canViewUserManagement = globalAdmin || role === "em" || role === "editor" || role === "reviewer";

  const allowedList = access.allowedSquads
    ?.map((s) => sanitizeSquadKey(String(s)))
    .filter((s): s is string => s != null);
  const canAccessSquad = (squadId: string) => {
    const sid = sanitizeSquadKey(squadId);
    if (!sid) return false;
    if (globalAdmin) return true;
    if (role === "editor") {
      return primary != null && primary === sid;
    }
    if (allowedList && allowedList.length > 0) {
      return allowedList.includes(sid);
    }
    return primary != null && primary === sid;
  };

  return {
    canWrite,
    canManageSprintLifecycle,
    canManageUsers,
    canViewUserManagement,
    canAccessOpsTabs,
    canEditOpsTabs,
    canAccessSquad,
  };
};

/**
 * Build AccessContext from a NextAuth session and the active squad in the planner store.
 */
export function plannerAccessContext(
  session: {
    user?: {
      email?: string | null;
      role?: string;
      squadId?: string | null;
      allowedSquads?: string[];
      squadRoles?: Record<string, SquadMembershipRole>;
      globalAdmin?: boolean;
    } | null;
  } | null,
  activeSquadId: string | null | undefined,
): AccessContext {
  const roleRaw = session?.user?.role ?? "reviewer";
  const role = normalizeUserRole(roleRaw) ?? "reviewer";
  return {
    email: session?.user?.email ?? "",
    role,
    squadId: session?.user?.squadId ?? null,
    activeSquadId: activeSquadId ?? session?.user?.squadId ?? null,
    squadRoles: session?.user?.squadRoles,
    allowedSquads: session?.user?.allowedSquads,
    globalAdmin: Boolean(session?.user?.globalAdmin) || role === "super_admin",
  };
}
