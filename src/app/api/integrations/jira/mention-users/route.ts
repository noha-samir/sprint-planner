import { NextResponse } from "next/server";
import { z } from "zod";
import { jiraRouteErrorResponse, requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { readSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { suggestMentionUsers } from "@/lib/integrations/jira/mentionUsers";

const querySchema = z.object({
  q: z.string().trim().max(200),
});

/**
 * People to @mention in a Jira comment (editors only): squad roster first, then Jira user search.
 * Query: ?q=<text after @>. Response: { users: MentionSuggestion[] }.
 */
export async function GET(request: Request) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }
  const parsed = querySchema.safeParse({ q: new URL(request.url).searchParams.get("q") ?? "" });
  if (!parsed.success) {
    return NextResponse.json({ error: "Search text is too long." }, { status: 400 });
  }

  try {
    const [credentials, squadConfig] = await Promise.all([
      requireJiraApiCredentials(authResult.squadId, authResult.access.email),
      readSquadJiraConfig(authResult.squadId),
    ]);
    const users = await suggestMentionUsers(credentials, squadConfig, parsed.data.q);
    return NextResponse.json({ users });
  } catch (error) {
    return jiraRouteErrorResponse(error, "Failed to search people to mention.");
  }
}
