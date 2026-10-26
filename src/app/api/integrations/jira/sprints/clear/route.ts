import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { JiraApiError } from "@/lib/integrations/jira/client";
import { partitionJiraSprintClear } from "@/lib/integrations/jira/jiraSprint";
import { moveJiraIssueToBacklog } from "@/lib/integrations/jira/jiraSprintRemote";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";

const clearSprintSchema = z.object({
  tasks: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(128),
        storyName: z.string().max(500).optional(),
        storyLink: z.string().max(2000).optional(),
        jiraSprintState: z.enum(["active", "future", "closed", "none"]).nullable().optional(),
      }),
    )
    .min(1)
    .max(500),
});

export async function POST(request: Request) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body: z.infer<typeof clearSprintSchema>;
  try {
    body = clearSprintSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid Jira sprint payload.", details: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { eligible, skipped } = partitionJiraSprintClear(
    body.tasks.map((task) => ({
      id: task.id,
      storyName: task.storyName ?? "",
      storyLink: task.storyLink ?? "",
      jiraSprintState: task.jiraSprintState ?? null,
    })),
  );

  const cleared: Array<{ taskId: string; storyName: string }> = [];
  const failed: Array<{ taskId: string; storyName: string; reason: string }> = [];
  if (eligible.length === 0) {
    return NextResponse.json({ cleared, skipped });
  }

  let credentials;
  try {
    credentials = await requireJiraApiCredentials(authResult.squadId, authResult.access.email);
  } catch (error) {
    const message = error instanceof JiraApiError ? error.message : "Jira is not available for this squad.";
    const status = error instanceof JiraApiError ? error.status : 503;
    return NextResponse.json({ error: message }, { status });
  }

  for (const row of eligible) {
    try {
      await moveJiraIssueToBacklog(credentials, row.issueKey);
      cleared.push({ taskId: row.taskId, storyName: row.storyName });
    } catch (error) {
      const reason = error instanceof JiraApiError ? error.message : "Could not remove the Jira sprint";
      failed.push({ taskId: row.taskId, storyName: row.storyName, reason });
    }
  }

  return NextResponse.json({
    cleared,
    skipped: [...skipped, ...failed],
  });
}
