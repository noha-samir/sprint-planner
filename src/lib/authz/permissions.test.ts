import { describe, expect, it } from "vitest";
import {
  allowedSquadIdsFromEntitlements,
  canReadSquad,
  canWriteSquad,
  sanitizeSquadKey,
} from "./permissions";
import type { ResolvedEntitlements } from "./types";

describe("sanitizeSquadKey", () => {
  it("normalizes default aliases", () => {
    expect(sanitizeSquadKey("Default")).toBe("ventures");
    expect(sanitizeSquadKey("ship")).toBe("ship");
  });

  it("rejects unsafe ids", () => {
    expect(sanitizeSquadKey("../etc")).toBeNull();
    expect(sanitizeSquadKey("a".repeat(80))).toBeNull();
  });
});

describe("canReadSquad / canWriteSquad", () => {
  const ent: ResolvedEntitlements = {
    globalAdmin: false,
    memberships: [
      { squadId: "ship", role: "em" },
      { squadId: "ventures", role: "reviewer" },
    ],
  };
  const allowed = allowedSquadIdsFromEntitlements(ent);
  const roles = Object.fromEntries(ent.memberships.map((m) => [sanitizeSquadKey(m.squadId)!, m.role]));

  it("global admin can read and write", () => {
    expect(canReadSquad({ globalAdmin: true, allowedSquads: [], squadId: "ship" })).toBe(true);
    expect(canWriteSquad({ globalAdmin: true, squadRoles: {}, squadId: "ship" })).toBe(true);
  });

  it("member can read allowed squads only", () => {
    expect(canReadSquad({ globalAdmin: false, allowedSquads: allowed, squadId: "ship" })).toBe(true);
    expect(canReadSquad({ globalAdmin: false, allowedSquads: allowed, squadId: "other" })).toBe(false);
  });

  it("EM and editor can write for a squad", () => {
    expect(canWriteSquad({ globalAdmin: false, squadRoles: roles, squadId: "ship" })).toBe(true);
    expect(canWriteSquad({ globalAdmin: false, squadRoles: roles, squadId: "ventures" })).toBe(false);
    expect(
      canWriteSquad({
        globalAdmin: false,
        squadRoles: { ventures: "editor" },
        squadId: "ventures",
      }),
    ).toBe(true);
  });
});
