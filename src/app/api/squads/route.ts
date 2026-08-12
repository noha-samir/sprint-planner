import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readAccessRegistry } from "@/lib/access/registry";
import { forbidden, getSessionAccess } from "@/lib/access/server";
import { sanitizeSquadKey } from "@/lib/authz/permissions";

export async function GET() {
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access) return forbidden();
  const registry = await readAccessRegistry();
  const squads = registry.squads.filter((s) => {
    const id = sanitizeSquadKey(s.id);
    if (!id) return false;
    if (access.globalAdmin || access.role === "super_admin") {
      return !s.hidden;
    }
    return access.allowedSquads.includes(id);
  });
  return NextResponse.json({
    squads: squads.map((s) => ({ id: s.id, name: s.name })),
  });
}
