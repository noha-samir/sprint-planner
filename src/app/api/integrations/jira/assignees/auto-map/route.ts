import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { requireSuperAdminAccess } from "@/lib/integrations/jira/apiAuth";
import { autoMapAssigneeNames } from "@/lib/integrations/jira/autoAssigneeMap";
import { JiraApiError } from "@/lib/integrations/jira/client";
import { parseAutoMapNamesBody } from "@/lib/validation/apiBodies";

export async function POST(request: Request) {
  const authResult = await requireSuperAdminAccess(request);
  if ("error" in authResult) {
    return authResult.error;
  }

  let body;
  try {
    body = parseAutoMapNamesBody(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid auto-map payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const names = Array.isArray(body.names) ? body.names : [];

  try {
    const result = await autoMapAssigneeNames(authResult.squadId, names);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof JiraApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Failed to auto-map Jira assignees" }, { status: 500 });
  }
}
