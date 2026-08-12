import type { SessionAccess } from "@/lib/access/server";
import {
  canReadFromSession,
  canWriteFromSession,
  forbidden,
  getSessionAccess,
  resolveRequestedSquadId,
} from "@/lib/access/server";
import { NextResponse } from "next/server";

type SquadAuthSuccess = { access: SessionAccess; squadId: string };
type SquadAuthError = { error: NextResponse };

export const getSquadIdFromRequest = (request: Request): string | null => {
  const url = new URL(request.url);
  return (
    request.headers.get("x-squad-id") ??
    request.headers.get("X-Squad-Id") ??
    url.searchParams.get("squadId")
  );
};

const requireSessionAccess = async (
  request: Request,
): Promise<{ access: SessionAccess; squadId: string | null } | SquadAuthError> => {
  const { auth } = await import("@/auth");
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access) {
    return { error: forbidden() };
  }
  const squadId = await resolveRequestedSquadId(access, getSquadIdFromRequest(request));
  return { access, squadId };
};

export const requireWriteAccess = async (request: Request): Promise<SquadAuthSuccess | SquadAuthError> => {
  const result = await requireSessionAccess(request);
  if ("error" in result) {
    return result;
  }
  const squadId = result.squadId;
  if (!squadId || !canWriteFromSession(result.access, squadId)) {
    return { error: forbidden() };
  }
  return { access: result.access, squadId };
};

/** Super admin only — Jira product configuration and account sync. */
export const requireSuperAdminAccess = async (
  request: Request,
): Promise<SquadAuthSuccess | SquadAuthError> => {
  const result = await requireSessionAccess(request);
  if ("error" in result) {
    return result;
  }
  if (result.access.role !== "super_admin" && !result.access.globalAdmin) {
    return { error: forbidden() };
  }
  const squadId = result.squadId;
  if (!squadId) {
    return { error: forbidden() };
  }
  return { access: result.access, squadId };
};

export const requireReadAccess = async (request: Request): Promise<SquadAuthSuccess | SquadAuthError> => {
  const result = await requireSessionAccess(request);
  if ("error" in result) {
    return result;
  }
  const squadId = result.squadId;
  if (!squadId || !canReadFromSession(result.access, squadId)) {
    return { error: forbidden() };
  }
  return { access: result.access, squadId };
};
