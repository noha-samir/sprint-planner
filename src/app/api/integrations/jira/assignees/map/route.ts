import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { requireSuperAdminAccess } from "@/lib/integrations/jira/apiAuth";
import { applyAssigneeMappings } from "@/lib/integrations/jira/autoAssigneeMap";
import { JiraApiError } from "@/lib/integrations/jira/client";

const bodySchema = z.object({
  mappings: z
    .array(
      z.object({
        plannerName: z.string().trim().min(1).max(200),
        accountId: z.string().trim().min(1).max(200),
        displayName: z.string().trim().min(1).max(200).optional(),
      }),
    )
    .min(1)
    .max(200),
});

/**
 * Super-admin: set exact planner-name → Jira accountId and rename resource to Jira display name.
 */
export async function PUT(request: Request) {
  const authResult = await requireSuperAdminAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid assignee map payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await applyAssigneeMappings(authResult.squadId, body.mappings);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to save Jira account mappings" }, { status: 500 });
  }
}
