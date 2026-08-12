import { NextResponse } from "next/server";
import { requireSuperAdminAccess } from "@/lib/integrations/jira/apiAuth";
import { readSquadJiraConfig, writeSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { pruneAssigneeMapToRoster } from "@/lib/integrations/jira/resourceJiraIdentity";
import { sanitizeSquadKey } from "@/lib/squads/sanitizeSquadKey";

/**
 * Super-admin: drop assignee-map keys that are no longer on the roster.
 * Optional `dropNames` removes those keys immediately (before planner-state autosave
 * has deleted the Resource rows), so remove-person stays map-once forever.
 */
export async function POST(request: Request) {
  const authResult = await requireSuperAdminAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  try {
    const body = (await request.json().catch(() => ({}))) as { dropNames?: string[] };
    const dropNames = (body.dropNames ?? []).map((name) => name.trim()).filter(Boolean);
    const safe = sanitizeSquadKey(authResult.squadId) || authResult.squadId;

    if (dropNames.length > 0) {
      const current = await readSquadJiraConfig(safe);
      const drop = new Set(dropNames.map((name) => name.toLowerCase()));
      const assigneeMap = Object.fromEntries(
        Object.entries(current.assigneeMap).filter(
          ([name, accountId]) => Boolean(accountId?.trim()) && !drop.has(name.trim().toLowerCase()),
        ),
      );
      const next = {
        ...current,
        assigneeMap,
        assigneesSyncedAt: new Date().toISOString(),
      };
      await writeSquadJiraConfig(safe, next);
      return NextResponse.json({ config: next });
    }

    const config = await pruneAssigneeMapToRoster(authResult.squadId);
    return NextResponse.json({ config });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to prune assignee map";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
