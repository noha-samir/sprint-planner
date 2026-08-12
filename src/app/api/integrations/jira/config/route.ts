import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireSuperAdminAccess } from "@/lib/integrations/jira/apiAuth";
import { readSquadJiraConfig, writeSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { defaultParentStoryFieldIds, type SquadJiraConfig } from "@/lib/integrations/jira/types";
import { parseSquadJiraConfigWriteBody } from "@/lib/validation/apiBodies";

export async function GET(request: Request) {
  const authResult = await requireSuperAdminAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  const config = await readSquadJiraConfig(authResult.squadId);
  return NextResponse.json(config);
}

export async function PUT(request: Request) {
  const authResult = await requireSuperAdminAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body;
  try {
    body = parseSquadJiraConfigWriteBody(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid Jira config payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const current = await readSquadJiraConfig(authResult.squadId);
  // Assignees are synced from Jira only — ignore client-supplied assigneeMap edits.
  const next: SquadJiraConfig = {
    ...current,
    ...body,
    siteUrl: typeof body.siteUrl === "string" ? body.siteUrl : current.siteUrl,
    parentStoryFields: {
      ...defaultParentStoryFieldIds(),
      ...current.parentStoryFields,
      ...body.parentStoryFields,
    },
    assigneeMap: current.assigneeMap,
    assigneesSyncedAt: current.assigneesSyncedAt,
  };
  await writeSquadJiraConfig(authResult.squadId, next);
  return NextResponse.json(await readSquadJiraConfig(authResult.squadId));
}
