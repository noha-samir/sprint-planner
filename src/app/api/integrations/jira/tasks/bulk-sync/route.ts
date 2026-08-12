import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Task } from "@/lib/scheduler/types";
import { requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { readSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { bulkSyncTasksToJira } from "@/lib/integrations/jira/pushSubtasks";
import { parseJiraTasksArrayBody } from "@/lib/validation/apiBodies";

export async function POST(request: Request) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body;
  try {
    body = parseJiraTasksArrayBody(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid bulk sync payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const squadConfig = await readSquadJiraConfig(authResult.squadId);
  const result = await bulkSyncTasksToJira(body.tasks as unknown as Task[], squadConfig);
  return NextResponse.json(result);
}
