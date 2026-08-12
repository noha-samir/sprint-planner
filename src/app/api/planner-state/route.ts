import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/auth";
import {
  canReadFromSession,
  canWriteFromSession,
  forbidden,
  getSessionAccess,
  resolveRequestedSquadId,
} from "@/lib/access/server";
import {
  readSquadPlannerState,
  StalePlannerWriteError,
  writeSquadPlannerState,
} from "@/lib/authz/squadStorage";
import { logger } from "@/lib/logging/logger";
import { parsePlannerStateWriteBody } from "@/lib/validation/apiBodies";

const getSquadIdFromRequest = (request: Request): string | null => {
  const url = new URL(request.url);
  return (
    request.headers.get("x-squad-id") ??
    request.headers.get("X-Squad-Id") ??
    url.searchParams.get("squadId")
  );
};

export async function GET(request: Request) {
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access) return forbidden();
  try {
    const requestedSquadId = await resolveRequestedSquadId(access, getSquadIdFromRequest(request));
    if (!requestedSquadId || !canReadFromSession(access, requestedSquadId)) {
      return forbidden();
    }
    const data = await readSquadPlannerState(requestedSquadId);
    return NextResponse.json(data);
  } catch (error) {
    logger.error("planner_state_get_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    const message = error instanceof Error ? error.message : "Failed to load planner state";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access) return forbidden();

  let requestedSquadId: string | null;
  try {
    requestedSquadId = await resolveRequestedSquadId(access, getSquadIdFromRequest(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to resolve squad";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  if (!requestedSquadId) {
    return NextResponse.json({ error: "Squad is required" }, { status: 400 });
  }
  if (!canWriteFromSession(access, requestedSquadId)) {
    return forbidden();
  }

  let parsed;
  try {
    parsed = parsePlannerStateWriteBody(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid planner state payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const baseUpdatedAt = typeof parsed.baseUpdatedAt === "string" ? parsed.baseUpdatedAt : null;
  const rest = { ...parsed };
  delete rest.baseUpdatedAt;
  const payload = {
    ...rest,
    updatedAt: new Date().toISOString(),
  };

  try {
    const saved = await writeSquadPlannerState(requestedSquadId, payload, { baseUpdatedAt });
    logger.info("planner_state_saved", {
      squadId: requestedSquadId,
      taskCount: Array.isArray(parsed.tasks) ? parsed.tasks.length : 0,
    });
    return NextResponse.json({
      ok: true,
      updatedAt: saved.updatedAt,
    });
  } catch (error) {
    if (error instanceof StalePlannerWriteError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "STALE_WRITE",
          serverUpdatedAt: error.serverUpdatedAt,
        },
        { status: 409 },
      );
    }
    logger.error("planner_state_save_failed", {
      squadId: requestedSquadId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    const message = error instanceof Error ? error.message : "Failed to save planner state";
    const status = message.includes("Too many") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
