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

const denyAllCapabilities = (): AccessCapabilities => ({
  canWrite: false,
  canManageSprintLifecycle: false,
  canManageUsers: false,
  canViewUserManagement: false,
  canAccessOpsTabs: false,
  canEditOpsTabs: false,
  canAccessSquad: () => false,
});

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
  const role = normalizeUserRole(access.role);
  // Missing/cleared role (expired or revoked session) must not fall back to Viewer.
  if (!role || !access.email.trim()) {
    return denyAllCapabilities();
  }
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

type SessionLike = {
  error?: string;
  user?: {
    email?: string | null;
    role?: string;
    squadId?: string | null;
    allowedSquads?: string[];
    squadRoles?: Record<string, SquadMembershipRole>;
    globalAdmin?: boolean;
  } | null;
} | null;

/**
 * Build AccessContext from a NextAuth session and the active squad in the planner store.
 * Returns null when the session is missing, revoked, or has no valid role (do not treat as Viewer).
 */
export function plannerAccessContext(
  session: SessionLike,
  activeSquadId: string | null | undefined,
): AccessContext | null {
  if (!session?.user?.email) return null;
  if (session.error === "SessionRevoked") return null;
  const role = normalizeUserRole(session.user.role);
  if (!role) return null;
  return {
    email: session.user.email,
    role,
    squadId: session.user.squadId ?? null,
    activeSquadId: activeSquadId ?? session.user.squadId ?? null,
    squadRoles: session.user.squadRoles,
    allowedSquads: session.user.allowedSquads,
    globalAdmin: Boolean(session.user.globalAdmin) || role === "super_admin",
  };
}

/** Capabilities for the current session, or null when unsigned / revoked / role cleared. */
export function sessionCapabilities(
  session: SessionLike,
  activeSquadId: string | null | undefined,
): AccessCapabilities | null {
  const ctx = plannerAccessContext(session, activeSquadId);
  return ctx ? getCapabilities(ctx) : null;
}
