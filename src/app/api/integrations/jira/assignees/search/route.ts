import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { requireSuperAdminAccess } from "@/lib/integrations/jira/apiAuth";
import { requireJiraApiCredentials } from "@/lib/authz/sessionJiraCredentials";
import { JiraApiError } from "@/lib/integrations/jira/client";
import { searchJiraUsers } from "@/lib/integrations/jira/userSearch";

const querySchema = z.object({
  q: z.string().trim().min(1).max(200),
});

/**
 * Super-admin: search Jira users with the signed-in connection (for exact assignee picks).
 */
export async function GET(request: Request) {
  const authResult = await requireSuperAdminAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  const url = new URL(request.url);
  let query: z.infer<typeof querySchema>;
  try {
    query = querySchema.parse({ q: url.searchParams.get("q") ?? "" });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Provide a non-empty q search term.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid search query." }, { status: 400 });
  }

  try {
    const credentials = await requireJiraApiCredentials(authResult.squadId);
    const users = await searchJiraUsers(credentials, query.q);
    return NextResponse.json({ users });
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to search Jira users" }, { status: 500 });
  }
}
