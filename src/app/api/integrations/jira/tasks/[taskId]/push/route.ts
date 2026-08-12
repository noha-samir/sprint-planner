import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { Task } from "@/lib/scheduler/types";
import { requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { readSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { JiraApiError } from "@/lib/integrations/jira/client";
import { syncTaskToJira } from "@/lib/integrations/jira/pushSubtasks";
import { parseJiraSingleTaskBody } from "@/lib/validation/apiBodies";

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  const { taskId } = await context.params;
  let body;
  try {
    body = parseJiraSingleTaskBody(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid push payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const task = body.task as unknown as Task;
  if (!task || task.id !== taskId) {
    return NextResponse.json({ error: "Task payload is required and must match the URL id" }, { status: 400 });
  }

  const squadConfig = await readSquadJiraConfig(authResult.squadId);

  try {
    const result = await syncTaskToJira(task, squadConfig);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to push subtasks to Jira" }, { status: 500 });
  }
}
