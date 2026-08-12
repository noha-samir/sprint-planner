import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireSuperAdminAccess } from "@/lib/integrations/jira/apiAuth";
import { syncAssigneeNamesFromJira } from "@/lib/integrations/jira/autoAssigneeMap";
import { JiraApiError } from "@/lib/integrations/jira/client";
import { prisma } from "@/lib/db/prisma";
import { z } from "zod";

const bodySchema = z.object({
  names: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
});

/**
 * Super-admin: sync planner resource names to Jira account IDs using the signed-in Jira connection.
 */
export async function POST(request: Request) {
  const authResult = await requireSuperAdminAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body: z.infer<typeof bodySchema> = {};
  try {
    const raw = await request.json().catch(() => ({}));
    body = bodySchema.parse(raw ?? {});
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid sync payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const resources = await prisma.resource.findMany({
      where: { squadId: authResult.squadId },
      select: { name: true },
    });
    const fromBody = Array.isArray(body.names) ? body.names : [];
    const hints = [
      ...resources.map((row) => ({ name: row.name })),
      ...fromBody.map((name) => ({ name })),
    ];

    const result = await syncAssigneeNamesFromJira(authResult.squadId, hints, { replaceAll: true });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[jira/assignees/sync]", error);
    const message = error instanceof Error ? error.message : "Failed to sync Jira accounts";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
