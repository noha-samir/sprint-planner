import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { auth } from "@/auth";
import { forbidden, getSessionAccess } from "@/lib/access/server";
import { readAccessRegistry, writeAccessRegistry, type AccessRegistry } from "@/lib/access/registry";
import { parseUserManagementWriteBody } from "@/lib/access/registryValidation";
import { deleteSquadPlannerState } from "@/lib/authz/squadStorage";
import {
  bumpSessionVersions,
  emailsNeedingSessionRevoke,
} from "@/lib/authz/sessionRevocation";
import { deleteSquadJiraConfig } from "@/lib/integrations/jira/configStore";
import { sanitizeSquadKey } from "@/lib/authz/permissions";
import {
  allowedSquadIdsForUserManagement,
  scopeAccessRegistry,
} from "@/lib/access/userManagementScope";

const hasSuperAdmin = (registry: AccessRegistry) =>
  registry.users.some((user) => user.role === "super_admin");

export async function GET() {
  const session = await auth();
  const access = getSessionAccess(session);
  if (
    !access ||
    (access.role !== "super_admin" &&
      access.role !== "em" &&
      access.role !== "editor" &&
      access.role !== "reviewer")
  ) {
    return forbidden();
  }
  try {
    const registry = await readAccessRegistry();
    const allowedSquadIds = allowedSquadIdsForUserManagement(access);
    return NextResponse.json(scopeAccessRegistry(registry, allowedSquadIds));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load access registry";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access || access.role !== "super_admin") return forbidden();

  let previous: AccessRegistry;
  try {
    previous = await readAccessRegistry();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load access registry";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  let parsed: ReturnType<typeof parseUserManagementWriteBody>;
  try {
    parsed = parseUserManagementWriteBody(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid access registry payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const body: AccessRegistry = {
    squads: parsed.squads,
    users: parsed.users,
    squadAccounts: parsed.squadAccounts,
  };

  if (!hasSuperAdmin(body)) {
    return NextResponse.json(
      { error: "At least one Super Admin must remain." },
      { status: 400 },
    );
  }

  const previousIds = new Set(previous.squads.map((s) => sanitizeSquadKey(s.id)).filter(Boolean));
  const nextIds = new Set(body.squads.map((s) => sanitizeSquadKey(s.id)).filter(Boolean));
  const removed = [...previousIds].filter((id) => id && !nextIds.has(id));
  if (removed.length > 0) {
    return NextResponse.json(
      {
        error:
          "Removing squads via PUT is not allowed (cascades delete planner data). Hide the squad or use DELETE.",
        removedSquadIds: removed,
      },
      { status: 400 },
    );
  }

  await writeAccessRegistry(body, { allowSquadDeletion: false });
  const next = await readAccessRegistry();

  const revoked = emailsNeedingSessionRevoke(previous, next);
  if (revoked.length > 0) {
    await bumpSessionVersions(revoked);
  }

  return NextResponse.json({ ok: true, revokedSessions: revoked.length });
}

export async function DELETE(request: Request) {
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access || access.role !== "super_admin") return forbidden();

  const squadId = sanitizeSquadKey(new URL(request.url).searchParams.get("squadId"));
  if (!squadId) {
    return NextResponse.json({ error: "squadId is required." }, { status: 400 });
  }

  let registry: AccessRegistry;
  try {
    registry = await readAccessRegistry();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load access registry";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const target = registry.squads.find((item) => item.id === squadId);
  if (!target) {
    return NextResponse.json({ error: "Squad not found." }, { status: 404 });
  }

  if (registry.squads.length <= 1) {
    return NextResponse.json({ error: "At least one squad must remain." }, { status: 400 });
  }

  const otherVisible = registry.squads.filter((item) => item.id !== squadId && !item.hidden);
  if (!target.hidden && otherVisible.length === 0) {
    return NextResponse.json(
      { error: "At least one active squad must remain. Hide it instead, or restore another squad first." },
      { status: 400 },
    );
  }

  const fallbackSquadId =
    registry.squads.find((item) => item.id !== squadId && !item.hidden)?.id ??
    registry.squads.find((item) => item.id !== squadId)?.id ??
    "ventures";

  const nextRegistry: AccessRegistry = {
    ...registry,
    squads: registry.squads.filter((item) => item.id !== squadId),
    users: registry.users.map((item) =>
      item.squadId === squadId ? { ...item, squadId: fallbackSquadId } : item,
    ),
    squadAccounts: registry.squadAccounts.map((item) =>
      item.squadId === squadId ? { ...item, squadId: fallbackSquadId } : item,
    ),
  };

  if (!hasSuperAdmin(nextRegistry)) {
    return NextResponse.json(
      { error: "At least one Super Admin must remain." },
      { status: 400 },
    );
  }

  await writeAccessRegistry(nextRegistry, { allowSquadDeletion: true });
  const next = await readAccessRegistry();
  const revoked = emailsNeedingSessionRevoke(registry, next);
  if (revoked.length > 0) {
    await bumpSessionVersions(revoked);
  }

  await deleteSquadPlannerState(squadId);
  await deleteSquadJiraConfig(squadId);

  return NextResponse.json({ ok: true, mode: "hard_delete" });
}
