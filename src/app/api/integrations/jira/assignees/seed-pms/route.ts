import { NextResponse } from "next/server";
import { requireSuperAdminAccess } from "@/lib/integrations/jira/apiAuth";
import { seedDefaultProductManagers } from "@/lib/integrations/jira/seedPmResources";
import { JiraApiError } from "@/lib/integrations/jira/client";

/**
 * Super-admin: idempotent seed of default Product Manager roster from Jira search.
 */
export async function POST(request: Request) {
  const authResult = await requireSuperAdminAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  try {
    const result = await seedDefaultProductManagers(authResult.squadId);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to seed Product Managers";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
