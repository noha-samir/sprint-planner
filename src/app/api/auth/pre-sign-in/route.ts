import { NextResponse } from "next/server";
import { isSignInAllowedEmail } from "@/constants/signIn";
import { getAllowedEmailDomain } from "@/lib/config/appConfig";
import { readAccessRegistry } from "@/lib/access/registry";
import { upsertJiraAccount } from "@/lib/authz/jiraAccountsStore";
import { verifyJiraEmailAndApiKey } from "@/lib/authz/jiraSignIn";
import { sanitizeSquadKey } from "@/lib/authz/permissions";
import { resolveEntitlements } from "@/lib/authz/resolveEntitlements";
import { clientIpFromRequest, consumeRateLimit } from "@/lib/security/rateLimit";

export async function POST(request: Request) {
  const ip = clientIpFromRequest(request);
  const limited = consumeRateLimit(`pre-sign-in:${ip}`, 20, 60_000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  let body: { email?: string; apiKey?: string };
  try {
    body = (await request.json()) as { email?: string; apiKey?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = String(body.email ?? "")
    .trim()
    .toLowerCase();
  const apiKey = String(body.apiKey ?? "").trim();
  if (!email || !apiKey || !isSignInAllowedEmail(email, await getAllowedEmailDomain())) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  const perEmail = consumeRateLimit(`pre-sign-in-email:${email}`, 10, 60_000);
  if (!perEmail.ok) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(perEmail.retryAfterSec) },
      },
    );
  }

  const jiraProfile = await verifyJiraEmailAndApiKey(email, apiKey);
  if (!jiraProfile) {
    return NextResponse.json({ error: "Invalid Jira email or API key" }, { status: 401 });
  }

  let registry;
  let ent;
  try {
    registry = await readAccessRegistry();
    ent = await resolveEntitlements(email);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Access registry unavailable";
    return NextResponse.json({ error: message }, { status: 503 });
  }

  const nameById = Object.fromEntries(registry.squads.map((s) => [sanitizeSquadKey(s.id), s.name]));

  if (ent.globalAdmin) {
    await upsertJiraAccount(email, jiraProfile.accountId, apiKey);
    const squads = registry.squads
      .filter((s) => !s.hidden)
      .map((s) => {
        const id = sanitizeSquadKey(s.id);
        return id ? { id, name: s.name } : null;
      })
      .filter((s): s is { id: string; name: string } => s != null);
    return NextResponse.json({
      mode: "super_admin" as const,
      displayName: jiraProfile.displayName,
      accountId: jiraProfile.accountId,
      squads,
    });
  }

  const knownIds = new Set(
    registry.squads.map((s) => sanitizeSquadKey(s.id)).filter((id): id is string => id != null),
  );
  let squads = ent.memberships
    .map((m) => {
      const id = sanitizeSquadKey(m.squadId);
      if (!id || !knownIds.has(id)) return null;
      return { id, name: nameById[id] ?? m.name ?? id, role: m.role };
    })
    .filter((s): s is { id: string; name: string; role: "em" | "editor" | "reviewer" } => s != null);

  // Editors only pick among squads where they are editor.
  const hasEm = squads.some((s) => s.role === "em");
  const editorSquads = squads.filter((s) => s.role === "editor");
  if (!hasEm && editorSquads.length > 0) {
    squads = editorSquads;
  }

  if (squads.length === 0) {
    return NextResponse.json({ error: "No squad access for this account" }, { status: 403 });
  }

  await upsertJiraAccount(email, jiraProfile.accountId, apiKey);
  return NextResponse.json({
    mode: "member" as const,
    displayName: jiraProfile.displayName,
    accountId: jiraProfile.accountId,
    squads,
  });
}
