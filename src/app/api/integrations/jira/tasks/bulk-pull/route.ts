import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Task } from "@/lib/scheduler/types";
import { requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { readSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { bulkPullTasksFromJira } from "@/lib/integrations/jira/pullFromJira";
import { resolveSquadEmAccountId } from "@/lib/integrations/jira/squadEmAccount";
import { z } from "zod";
import { jiraTasksArraySchema } from "@/lib/validation/apiBodies";

const bulkPullSchema = jiraTasksArraySchema.extend({
  plannerPeople: z
    .array(z.object({ name: z.string(), nickname: z.string().optional() }))
    .max(200)
    .optional(),
  plannerNames: z.array(z.string()).max(200).optional(),
});

export async function POST(request: Request) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body;
  try {
    body = bulkPullSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid bulk pull payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const squadConfig = await readSquadJiraConfig(authResult.squadId);
  const plannerPeople = body.plannerPeople ?? body.plannerNames ?? [];
  const emAccountId = await resolveSquadEmAccountId(authResult.squadId);

  const result = await bulkPullTasksFromJira(
    body.tasks as unknown as Task[],
    squadConfig,
    plannerPeople,
    emAccountId,
  );
  return NextResponse.json(result);
}
