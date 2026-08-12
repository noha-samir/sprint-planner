"use client";

/**
 * Clear stored Jira API token then sign out (best-effort clear).
 */
export async function signOutAndClearJiraToken(callbackUrl = "/sign-in"): Promise<void> {
  try {
    await fetch("/api/auth/clear-jira-token", { method: "POST", credentials: "include" });
  } catch {
    // continue to sign-out even if clear fails
  }
  const { signOut } = await import("next-auth/react");
  await signOut({ callbackUrl });
}
