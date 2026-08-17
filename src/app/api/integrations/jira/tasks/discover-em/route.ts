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
  existingIssueKeySet,
  resolveEmJiraAccountId,
} from "@/lib/integrations/jira/discoverEmStories";

const discoverEmStoriesSchema = z.object({
  existingIssueKeys: z.array(z.string().max(80)).max(500).optional(),
  existingStoryLinks: z.array(z.string().max(2000)).max(500).optional(),
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
    const result = await discoverEmStoriesFromJira(credentials, squadConfig, existingKeys, emAccountId);
    return NextResponse.json({
      stories: result.stories,
      truncated: result.truncated,
      warning: result.warning,
    });
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to search Jira for EM stories" }, { status: 500 });
  }
}
