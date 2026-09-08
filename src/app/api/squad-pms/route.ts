import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  canReadFromSession,
  forbidden,
  getSessionAccess,
  resolveRequestedSquadId,
} from "@/lib/access/server";
import { resolveSquadPmRosterNames } from "@/lib/integrations/jira/squadPmNames";
import { logger } from "@/lib/logging/logger";

const getSquadIdFromRequest = (request: Request): string | null => {
  const url = new URL(request.url);
  return (
    request.headers.get("x-squad-id") ??
    request.headers.get("X-Squad-Id") ??
    url.searchParams.get("squadId")
  );
};

/** Return squad PM emails and resolved roster names for the Owner PM filter. */
export async function GET(request: Request) {
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access) return forbidden();

  let squadId: string | null;
  try {
    squadId = await resolveRequestedSquadId(access, getSquadIdFromRequest(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve squad";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  if (!squadId || !canReadFromSession(access, squadId)) {
    return forbidden();
  }

  try {
    const result = await resolveSquadPmRosterNames(squadId);
    return NextResponse.json(result);
  } catch (error) {
    logger.error("squad_pms_get_failed", {
      squadId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to resolve squad PMs" },
      { status: 503 },
    );
  }
}
