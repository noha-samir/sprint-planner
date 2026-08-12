import { NextResponse } from "next/server";
import { requireSuperAdminAccess } from "@/lib/integrations/jira/apiAuth";
import { refreshMappedIdentitiesFromJira } from "@/lib/integrations/jira/createMappedResource";
import { JiraApiError } from "@/lib/integrations/jira/client";

/**
 * Super-admin: refresh roster names from Jira display names for mapped account IDs.
 */
export async function POST(request: Request) {
  const authResult = await requireSuperAdminAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  try {
    const result = await refreshMappedIdentitiesFromJira(authResult.squadId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[jira/assignees/refresh]", error);
    const message = error instanceof Error ? error.message : "Failed to refresh Jira identities";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
