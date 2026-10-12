import { NextResponse } from "next/server";
import { jiraRouteErrorResponse, requireReadAccess, requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { parseJiraIssueKey } from "@/lib/integrations/jira/issueKey";
import { addIssueComment, listIssueComments } from "@/lib/integrations/jira/comments";
import { jiraCommentWriteSchema } from "@/lib/validation/apiBodies";

type CommentsContext = { params: Promise<{ issueKey: string }> };

const invalidIssueKey = () => NextResponse.json({ error: "A valid Jira issue key is required." }, { status: 400 });

/**
 * Newest comments on a Jira story (read access), read with the signed-in user's Jira token.
 * Response: { comments: JiraIssueComment[], total: number }.
 */
export async function GET(request: Request, context: CommentsContext) {
  const authResult = await requireReadAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }
  const issueKey = parseJiraIssueKey((await context.params).issueKey);
  if (!issueKey) {
    return invalidIssueKey();
  }

  try {
    const credentials = await requireJiraApiCredentials(authResult.squadId, authResult.access.email);
    return NextResponse.json(await listIssueComments(credentials, issueKey, authResult.access.jiraAccountId));
  } catch (error) {
    return jiraRouteErrorResponse(error, "Failed to load Jira comments.");
  }
}

/**
 * Add a comment to a Jira story as the signed-in user (editors only).
 * Body: { text: string, mentions?: { accountId, displayName }[] }. Response: { comment }.
 */
export async function POST(request: Request, context: CommentsContext) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }
  const issueKey = parseJiraIssueKey((await context.params).issueKey);
  if (!issueKey) {
    return invalidIssueKey();
  }
  const parsed = jiraCommentWriteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Comment text is required (max 5000 characters).", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const credentials = await requireJiraApiCredentials(authResult.squadId, authResult.access.email);
    const comment = await addIssueComment(credentials, issueKey, parsed.data);
    return NextResponse.json({ comment }, { status: 201 });
  } catch (error) {
    return jiraRouteErrorResponse(error, "Failed to add the Jira comment.");
  }
}
