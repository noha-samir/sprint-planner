import { NextResponse } from "next/server";
import { ZodError, z } from "zod";
import { requireSuperAdminAccess } from "@/lib/integrations/jira/apiAuth";
import { createMappedResource } from "@/lib/integrations/jira/createMappedResource";
import { JiraApiError } from "@/lib/integrations/jira/client";

const bodySchema = z.object({
  type: z.enum(["FE", "BE", "MO", "QC", "PM", "OtherSquad"]),
  accountId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(200),
  capacityHours: z.number().min(0).max(80).optional(),
});

/**
 * Super-admin: create a roster resource from an exact Jira account pick.
 */
export async function POST(request: Request) {
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
        { error: "Invalid create-resource payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const result = await createMappedResource(authResult.squadId, {
      type: body.type,
      accountId: body.accountId,
      displayName: body.displayName,
      capacityHours: body.capacityHours ?? 80,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const status =
      error && typeof error === "object" && "status" in error && typeof error.status === "number"
        ? error.status
        : 500;
    const message = error instanceof Error ? error.message : "Failed to create mapped resource";
    return NextResponse.json({ error: message }, { status });
  }
}
