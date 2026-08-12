import type { ResolvedEntitlements, SquadEntitlement, SquadMembershipRole } from "./types";

const DEFAULT_TIMEOUT_MS = 5000;

function parseMembershipRole(value: unknown): SquadMembershipRole | null {
  if (value === "manager" || value === "em" || value === "engineering_manager") return "em";
  if (value === "editor") return "editor";
  if (value === "viewer" || value === "reviewer" || value === "member") return "reviewer";
  return null;
}

function normalizeRemoteMembership(raw: unknown): SquadEntitlement | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const squadId =
    typeof o.squadId === "string"
      ? o.squadId
      : typeof o.id === "string"
        ? o.id
        : typeof o.squad_id === "string"
          ? o.squad_id
          : null;
  if (!squadId?.trim()) return null;
  const role = parseMembershipRole(o.role ?? o.squadRole);
  if (!role) return null;
  const name = typeof o.name === "string" ? o.name : typeof o.squadName === "string" ? o.squadName : undefined;
  return { squadId: squadId.trim().toLowerCase(), role, name };
}

function parseEntitlementsPayload(json: unknown): ResolvedEntitlements | null {
  if (!json || typeof json !== "object") return null;
  const o = json as Record<string, unknown>;
  const globalAdmin = Boolean(o.globalAdmin ?? o.isGlobalAdmin ?? o.super_admin);
  const rawList =
    (Array.isArray(o.memberships) ? o.memberships : null) ??
    (Array.isArray(o.squads) ? o.squads : null) ??
    (Array.isArray(o.entitlements) ? o.entitlements : null);
  if (!rawList) {
    if (globalAdmin) return { globalAdmin: true, memberships: [] };
    return null;
  }
  const memberships = rawList.map(normalizeRemoteMembership).filter((m): m is SquadEntitlement => m != null);
  return { globalAdmin, memberships };
}

export async function fetchIdentityEntitlements(email: string): Promise<ResolvedEntitlements | null> {
  const base = process.env.IDENTITY_SERVICE_BASE_URL?.trim();
  if (!base) return null;

  const token = process.env.IDENTITY_SERVICE_TOKEN?.trim();
  if (!token) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("IDENTITY_SERVICE_TOKEN is required when IDENTITY_SERVICE_BASE_URL is set");
    }
    console.warn(
      "[identity] IDENTITY_SERVICE_TOKEN missing; skipping remote entitlements in non-production",
    );
    return null;
  }

  const timeoutMs = Number(process.env.IDENTITY_SERVICE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const url = new URL(base.replace(/\/$/, "") + "/entitlements");
  url.searchParams.set("email", email);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const json: unknown = await response.json();
    return parseEntitlementsPayload(json);
  } catch (error) {
    if (error instanceof Error && error.message.includes("IDENTITY_SERVICE_TOKEN")) {
      throw error;
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}
