import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { JiraApiError } from "@/lib/integrations/jira/client";
import { projectKeyFromIssueKey } from "@/lib/integrations/jira/issueKey";
import { partitionJiraSprintAdd, type OpenJiraSprint } from "@/lib/integrations/jira/jiraSprint";
import { listOpenJiraSprints, moveJiraIssueToSprint } from "@/lib/integrations/jira/jiraSprintRemote";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";

const addSprintSchema = z.object({
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
  sprintIdByProject: z.record(z.string().trim().min(1).max(32), z.number().int().positive()).optional(),
});

export async function POST(request: Request) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body: z.infer<typeof addSprintSchema>;
  try {
    body = addSprintSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ error: "Invalid Jira sprint payload.", details: error.flatten() }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { eligible, skipped } = partitionJiraSprintAdd(
    body.tasks.map((task) => ({
      id: task.id,
      storyName: task.storyName ?? "",
      storyLink: task.storyLink ?? "",
      jiraSprintState: task.jiraSprintState ?? null,
    })),
  );

  const added: Array<{ taskId: string; storyName: string; jiraSprintId: number; jiraSprintName: string }> = [];
  const failed: Array<{ taskId: string; storyName: string; reason: string }> = [];
  const choices: Array<{ projectKey: string; storyCount: number; sprints: OpenJiraSprint[] }> = [];
  if (eligible.length === 0) {
    return NextResponse.json({ added, skipped });
  }

  let credentials;
  try {
    credentials = await requireJiraApiCredentials(authResult.squadId, authResult.access.email);
  } catch (error) {
    const message = error instanceof JiraApiError ? error.message : "Jira is not available for this squad.";
    const status = error instanceof JiraApiError ? error.status : 503;
    return NextResponse.json({ error: message }, { status });
  }

  const byProject = new Map<string, typeof eligible>();
  for (const row of eligible) {
    const projectKey = projectKeyFromIssueKey(row.issueKey);
    if (!projectKey) {
      failed.push({ taskId: row.taskId, storyName: row.storyName, reason: "No Jira project on the issue key" });
      continue;
    }
    const group = byProject.get(projectKey) ?? [];
    group.push(row);
    byProject.set(projectKey, group);
  }

  for (const [projectKey, rows] of byProject) {
    let openSprints: OpenJiraSprint[];
    try {
      openSprints = await listOpenJiraSprints(credentials, projectKey);
    } catch (error) {
      const reason = error instanceof JiraApiError ? error.message : "Could not read the open Jira sprint";
      for (const row of rows) failed.push({ taskId: row.taskId, storyName: row.storyName, reason });
      continue;
    }
    if (openSprints.length === 0) {
      for (const row of rows) {
        failed.push({ taskId: row.taskId, storyName: row.storyName, reason: "Jira has no open sprint for this project." });
      }
      continue;
    }
    const requestedId = body.sprintIdByProject?.[projectKey];
    const sprint = requestedId
      ? openSprints.find((item) => item.jiraSprintId === requestedId)
      : openSprints.length === 1
        ? openSprints[0]
        : undefined;
    if (!sprint) {
      if (requestedId) {
        for (const row of rows) {
          failed.push({ taskId: row.taskId, storyName: row.storyName, reason: "That sprint is not open in Jira." });
        }
      } else {
        choices.push({ projectKey, storyCount: rows.length, sprints: openSprints });
      }
      continue;
    }

    for (const row of rows) {
      try {
        await moveJiraIssueToSprint(credentials, sprint.jiraSprintId, row.issueKey);
        added.push({
          taskId: row.taskId,
          storyName: row.storyName,
          jiraSprintId: sprint.jiraSprintId,
          jiraSprintName: sprint.jiraSprintName,
        });
      } catch (error) {
        const reason = error instanceof JiraApiError ? error.message : "Could not add the Jira sprint";
        failed.push({ taskId: row.taskId, storyName: row.storyName, reason });
      }
    }
  }

  return NextResponse.json({
    added,
    skipped: [...skipped, ...failed],
    ...(choices.length > 0 ? { choices } : {}),
  });
}
