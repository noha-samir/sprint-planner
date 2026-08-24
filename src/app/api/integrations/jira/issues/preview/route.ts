import { NextResponse } from "next/server";
import { requireReadAccess } from "@/lib/integrations/jira/apiAuth";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { JiraApiError } from "@/lib/integrations/jira/client";
import { parseJiraIssueKey } from "@/lib/integrations/jira/issueKey";
import { fetchJiraIssuePreview } from "@/lib/integrations/jira/issuePreview";

export async function GET(request: Request) {
  const authResult = await requireReadAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  const url = new URL(request.url);
  const issueKeyParam = url.searchParams.get("issueKey") ?? "";
  const storyLinkParam = url.searchParams.get("storyLink") ?? "";
  const issueKey = parseJiraIssueKey(issueKeyParam) ?? parseJiraIssueKey(storyLinkParam);
  if (!issueKey) {
    return NextResponse.json({ error: "A valid Jira issue key or story link is required." }, { status: 400 });
  }

  try {
    const credentials = await requireJiraApiCredentials(authResult.squadId);
    const preview = await fetchJiraIssuePreview(credentials, issueKey);
    return NextResponse.json(preview);
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to load Jira issue preview." }, { status: 500 });
  }
}
