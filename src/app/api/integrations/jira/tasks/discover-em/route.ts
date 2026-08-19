import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { z } from "zod";
import { prisma } from "@/lib/db/prisma";
import { requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { readSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { JiraApiError } from "@/lib/integrations/jira/client";
import {
  discoverEmStoriesFromJira,
  discoverStandaloneTasksFromJira,
  existingIssueKeySet,
  resolveEmJiraAccountId,
  type DiscoveredEmStory,
} from "@/lib/integrations/jira/discoverEmStories";
import { resolveHoursForDiscoveredTask } from "@/lib/integrations/jira/pullFromJira";

const discoverEmStoriesSchema = z.object({
  existingIssueKeys: z.array(z.string().max(80)).max(500).optional(),
  existingStoryLinks: z.array(z.string().max(2000)).max(500).optional(),
  plannerResources: z
    .array(z.object({ name: z.string(), type: z.string() }))
    .max(200)
    .optional(),
});

export async function POST(request: Request) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body;
  try {
    body = discoverEmStoriesSchema.parse(await request.json().catch(() => ({})));
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid discover payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const squadConfig = await readSquadJiraConfig(authResult.squadId);
  const existingKeys = existingIssueKeySet([
    ...(body.existingStoryLinks ?? []),
    ...(body.existingIssueKeys ?? []),
  ]);

  try {
    const credentials = await requireJiraApiCredentials(authResult.squadId);
    const squad = await prisma.squad.findUnique({
      where: { id: authResult.squadId },
      select: { emEmail: true },
    });
    let emAccountId: string | null = null;
    if (squadConfig.engineeringManagerFieldId.trim()) {
      try {
        emAccountId = await resolveEmJiraAccountId(credentials, squad?.emEmail ?? "");
      } catch {
        emAccountId = null;
      }
    }

    const [storiesResult, standaloneTasks] = await Promise.all([
      discoverEmStoriesFromJira(credentials, squadConfig, existingKeys, emAccountId),
      discoverStandaloneTasksFromJira(credentials, squadConfig, existingKeys, emAccountId),
    ]);

    // Merge story and standalone task results, dedup by key (stories take precedence)
    const seenKeys = new Set(storiesResult.stories.map((s) => s.key));
    const mergedExtra: DiscoveredEmStory[] = standaloneTasks.filter((t) => !seenKeys.has(t.key));
    const allDiscovered = [...storiesResult.stories, ...mergedExtra];

    const plannerResources = body.plannerResources ?? [];

    return NextResponse.json({
      stories: allDiscovered.map((item) => {
        const isEmStory = emAccountId != null && item.assigneeAccountId === emAccountId;
        const hours = resolveHoursForDiscoveredTask(
          item.assigneeAccountId ?? null,
          item.estimateSeconds ?? null,
          squadConfig.assigneeMap,
          plannerResources,
        );
        return {
          key: item.key,
          summary: item.summary,
          storyLink: item.storyLink,
          issueType: item.issueType ?? null,
          isEmStory,
          ...hours,
        };
      }),
      truncated: storiesResult.truncated,
      warning: storiesResult.warning,
    });
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to search Jira for EM stories" }, { status: 500 });
  }
}
