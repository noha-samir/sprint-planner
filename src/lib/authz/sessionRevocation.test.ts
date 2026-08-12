import { describe, expect, it } from "vitest";
import type { AccessRegistry } from "@/lib/access/registry";
import { emailsNeedingSessionRevoke } from "./sessionRevocation";

const base = (): AccessRegistry => ({
  squads: [{ id: "ventures", name: "Ventures", emEmail: "admin@example.com", hidden: false }],
  users: [
    { email: "admin@example.com", role: "super_admin", squadId: "ventures" },
    { email: "user@example.com", role: "reviewer", squadId: "ventures" },
  ],
  squadAccounts: [],
});

describe("emailsNeedingSessionRevoke", () => {
  it("revokes when role changes", () => {
    const previous = base();
    const next = base();
    next.users[0] = { ...next.users[0], role: "em" };
    expect(emailsNeedingSessionRevoke(previous, next)).toEqual(["admin@example.com"]);
  });

  it("revokes when squad changes", () => {
    const previous = base();
    const next = base();
    next.users[1] = { ...next.users[1], squadId: "ship" };
    expect(emailsNeedingSessionRevoke(previous, next)).toEqual(["user@example.com"]);
  });

  it("revokes when user is removed", () => {
    const previous = base();
    const next = base();
    next.users = [next.users[0]];
    expect(emailsNeedingSessionRevoke(previous, next)).toEqual(["user@example.com"]);
  });

  it("does not revoke when nothing access-related changed", () => {
    const previous = base();
    const next = base();
    next.squads[0] = { ...next.squads[0], name: "Ventures Squad" };
    expect(emailsNeedingSessionRevoke(previous, next)).toEqual([]);
  });

  it("revokes when squadAccount is removed", () => {
    const previous = base();
    previous.squadAccounts = [{ email: "viewer@example.com", role: "reviewer", squadId: "ventures" }];
    const next = base();
    expect(emailsNeedingSessionRevoke(previous, next)).toEqual(["viewer@example.com"]);
  });
});
