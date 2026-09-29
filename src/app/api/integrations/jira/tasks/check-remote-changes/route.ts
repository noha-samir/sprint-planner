import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { JiraApiError } from "@/lib/integrations/jira/client";
import { findRemoteJiraChanges } from "@/lib/integrations/jira/remoteChanges";
import { parseJiraRemoteChangesBody } from "@/lib/validation/apiBodies";

/**
 * Before push: report stories whose Jira parent or subtasks changed after our last pull/push.
 * Body: { tasks: [{ taskId, storyLink, lastPulledAt, lastPushedAt }] }
 * Returns: { changed: [{ taskId, keys, latestUpdatedAt, neverPulled }] } — read-only Jira search.
 */
export async function POST(request: Request) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body;
  try {
    body = parseJiraRemoteChangesBody(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid remote-change check payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const credentials = await requireJiraApiCredentials(authResult.squadId);
    const changed = await findRemoteJiraChanges(credentials, body.tasks);
    if (!changed) {
      return NextResponse.json({ error: "Could not check Jira for newer changes" }, { status: 502 });
    }
    return NextResponse.json({ changed });
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Could not check Jira for newer changes" }, { status: 500 });
  }
}
