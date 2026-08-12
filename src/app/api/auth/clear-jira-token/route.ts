import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { clearJiraApiToken } from "@/lib/authz/jiraAccountsStore";
import { logger } from "@/lib/logging/logger";

/**
 * Clears the encrypted Jira API token for the signed-in user (call before client signOut).
 */
export async function POST() {
  const session = await auth();
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await clearJiraApiToken(email);
    logger.info("jira_token_cleared", { email });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error("jira_token_clear_failed", {
      email,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json({ error: "Failed to clear Jira token" }, { status: 500 });
  }
}
