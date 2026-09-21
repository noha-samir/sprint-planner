import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { z } from "zod";
import { auth } from "@/auth";
import {
  canReadFromSession,
  forbidden,
  getSessionAccess,
  resolveRequestedSquadId,
} from "@/lib/access/server";
import { resolvePmStoryFlagsByIssueKeys } from "@/lib/integrations/jira/squadPmNames";
import { logger } from "@/lib/logging/logger";

const refreshBodySchema = z.object({
  issueKeys: z.array(z.string().trim().max(80)).max(500),
});

const getSquadIdFromRequest = (request: Request): string | null => {
  const url = new URL(request.url);
  return (
    request.headers.get("x-squad-id") ??
    request.headers.get("X-Squad-Id") ??
    url.searchParams.get("squadId")
  );
};

/** Mark which dashboard Jira keys are currently assigned to a squad PM. */
export async function POST(request: Request) {
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

  let body: z.infer<typeof refreshBodySchema>;
  try {
    body = refreshBodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid refresh payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const flags = await resolvePmStoryFlagsByIssueKeys(squadId, body.issueKeys);
    return NextResponse.json({ flags });
  } catch (error) {
    logger.error("squad_pms_refresh_failed", {
      squadId,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh PM story flags" },
      { status: 503 },
    );
  }
}
