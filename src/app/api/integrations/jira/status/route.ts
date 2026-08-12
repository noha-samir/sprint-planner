import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSessionAccess, resolveRequestedSquadId } from "@/lib/access/server";
import { verifyJiraConnection } from "@/lib/integrations/jira/client";
import { isJiraSiteConfigured, normalizeJiraSiteUrl } from "@/lib/integrations/jira/credentials";
import { resolveJiraSiteUrl } from "@/lib/integrations/jira/configStore";
import { getSessionJiraCredentials } from "@/lib/authz/sessionJiraCredentials";
import { getSquadIdFromRequest } from "@/lib/integrations/jira/apiAuth";

export async function GET(request: Request) {
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const squadId = await resolveRequestedSquadId(access, getSquadIdFromRequest(request));
  const siteUrl = normalizeJiraSiteUrl(await resolveJiraSiteUrl(squadId));
  const siteConfigured = Boolean(siteUrl) || (await isJiraSiteConfigured());
  const credentials = await getSessionJiraCredentials(squadId);
  const verified = credentials ? await verifyJiraConnection(credentials) : null;

  return NextResponse.json({
    configured: siteConfigured,
    connected: Boolean(verified),
    siteUrl: siteUrl || credentials?.siteUrl || null,
    signedInJiraEmail: credentials?.email ?? session?.user?.email ?? null,
    jiraAccountId: session?.user?.jiraAccountId ?? null,
    displayName: verified?.displayName ?? null,
  });
}
