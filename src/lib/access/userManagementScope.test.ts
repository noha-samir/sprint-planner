import { describe, expect, it } from "vitest";
import type { AccessRegistry } from "./registry";
import {
  allowedSquadIdsForUserManagement,
  scopeAccessRegistry,
  userMatchesSquadFilter,
} from "./userManagementScope";

const registry = (): AccessRegistry => ({
  squads: [
    { id: "ventures", name: "Ventures", emEmail: "em@example.com" },
    { id: "ship", name: "Ship", emEmail: "lead@example.com" },
  ],
  users: [
    { email: "em@example.com", role: "em", squadId: "ventures" },
    { email: "dev@example.com", role: "editor", squadId: "ventures" },
    { email: "lead@example.com", role: "em", squadId: "ship" },
    { email: "admin@example.com", role: "super_admin", squadId: "ventures" },
    { email: "shared@example.com", role: "reviewer", squadId: "ventures" },
  ],
  squadAccounts: [{ email: "shared@example.com", role: "reviewer", squadId: "ship" }],
});

describe("allowedSquadIdsForUserManagement", () => {
  it("returns null for super admin", () => {
    expect(
      allowedSquadIdsForUserManagement({
        globalAdmin: true,
        role: "super_admin",
        squadId: "ventures",
        allowedSquads: ["ventures", "ship"],
      }),
    ).toBeNull();
  });

  it("returns the EM allowed squads", () => {
    expect(
      allowedSquadIdsForUserManagement({
        role: "em",
        squadId: "ship",
        allowedSquads: ["ship"],
      }),
    ).toEqual(["ship"]);
  });

  it("unions primary squad with extra allowed squads for non-admins", () => {
    expect(
      allowedSquadIdsForUserManagement({
        role: "editor",
        squadId: "ventures",
        allowedSquads: ["ship"],
      }).sort(),
    ).toEqual(["ship", "ventures"]);
  });
});

describe("scopeAccessRegistry", () => {
  it("keeps only squad lead users and extra memberships", () => {
    const scoped = scopeAccessRegistry(registry(), ["ship"]);
    expect(scoped.squads.map((squad) => squad.id)).toEqual(["ship"]);
    expect(scoped.users.map((user) => user.email).sort()).toEqual(["lead@example.com", "shared@example.com"]);
    expect(scoped.squadAccounts).toEqual([
      { email: "shared@example.com", role: "reviewer", squadId: "ship" },
    ]);
  });

  it("does not scope super-admin viewers", () => {
    expect(scopeAccessRegistry(registry(), null)).toEqual(registry());
  });
});

describe("userMatchesSquadFilter", () => {
  it("passes every row when the filter is all squads", () => {
    expect(
      userMatchesSquadFilter(
        { email: "em@example.com", squadId: "ventures" },
        "all",
        { squadAccounts: [] },
      ),
    ).toBe(true);
  });

  it("matches primary squad and extra membership", () => {
    const extra = { squadAccounts: registry().squadAccounts };
    expect(
      userMatchesSquadFilter({ email: "lead@example.com", squadId: "ship" }, "ship", extra),
    ).toBe(true);
    expect(
      userMatchesSquadFilter({ email: "em@example.com", squadId: "ventures" }, "ship", extra),
    ).toBe(false);
    expect(
      userMatchesSquadFilter({ email: "shared@example.com", squadId: "ventures" }, "ship", extra),
    ).toBe(true);
    expect(
      userMatchesSquadFilter({ email: "", squadId: null, savedEmail: null }, "ship", extra),
    ).toBe(true);
  });
});
