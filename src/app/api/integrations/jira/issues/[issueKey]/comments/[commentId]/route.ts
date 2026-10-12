import { NextResponse } from "next/server";
import { jiraRouteErrorResponse, requireWriteAccess } from "@/lib/integrations/jira/apiAuth";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { parseJiraIssueKey } from "@/lib/integrations/jira/issueKey";
import { deleteIssueComment, updateIssueComment } from "@/lib/integrations/jira/comments";
import { jiraCommentIdSchema, jiraCommentWriteSchema } from "@/lib/validation/apiBodies";

type CommentContext = { params: Promise<{ issueKey: string; commentId: string }> };

/** Validated issue key + comment id from the path, or null when either is malformed. */
const readTarget = async (context: CommentContext): Promise<{ issueKey: string; commentId: string } | null> => {
  const params = await context.params;
  const issueKey = parseJiraIssueKey(params.issueKey);
  const commentId = jiraCommentIdSchema.safeParse(params.commentId);
  return issueKey && commentId.success ? { issueKey, commentId: commentId.data } : null;
};

const invalidTarget = () =>
  NextResponse.json({ error: "A valid Jira issue key and comment id are required." }, { status: 400 });

/**
 * Edit a Jira comment as the signed-in user (editors only; Jira rejects comments written by someone else).
 * Body: { text: string, mentions?: { accountId, displayName }[] }. Response: { comment }.
 */
export async function PUT(request: Request, context: CommentContext) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }
  const target = await readTarget(context);
  if (!target) {
    return invalidTarget();
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
    const comment = await updateIssueComment(credentials, target.issueKey, target.commentId, parsed.data);
    return NextResponse.json({ comment });
  } catch (error) {
    return jiraRouteErrorResponse(error, "Failed to update the Jira comment.");
  }
}

/** Delete a Jira comment as the signed-in user (editors only; Jira rejects comments written by someone else). */
export async function DELETE(request: Request, context: CommentContext) {
  const authResult = await requireWriteAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }
  const target = await readTarget(context);
  if (!target) {
    return invalidTarget();
  }

  try {
    const credentials = await requireJiraApiCredentials(authResult.squadId, authResult.access.email);
    await deleteIssueComment(credentials, target.issueKey, target.commentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jiraRouteErrorResponse(error, "Failed to delete the Jira comment.");
  }
}
