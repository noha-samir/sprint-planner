import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Task } from "@/lib/scheduler/types";
import { requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { readSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { bulkPullTasksFromJira } from "@/lib/integrations/jira/pullFromJira";
import { resolveEmJiraAccountId } from "@/lib/integrations/jira/discoverEmStories";
import { prisma } from "@/lib/db/prisma";
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

  // Resolve EM account ID so isEmStory can be set accurately on each pulled task.
  let emAccountId: string | null = null;
  if (squadConfig.engineeringManagerFieldId.trim()) {
    try {
      const credentials = await requireJiraApiCredentials(authResult.squadId);
      const squad = await prisma.squad.findUnique({
        where: { id: authResult.squadId },
        select: { emEmail: true },
      });
      emAccountId = await resolveEmJiraAccountId(credentials, squad?.emEmail ?? "");
    } catch {
      emAccountId = null;
    }
  }

  const result = await bulkPullTasksFromJira(
    body.tasks as unknown as Task[],
    squadConfig,
    plannerPeople,
    emAccountId,
  );
  return NextResponse.json(result);
}
