import { describe, expect, it, vi } from "vitest";
import type { Session } from "next-auth";
import { getSessionAccess, canReadFromSession, canWriteFromSession } from "./server";

vi.mock("@/lib/access/registry", () => ({
  readAccessRegistry: vi.fn(async () => ({
    squads: [
      { id: "ventures", name: "V", emEmail: "a@example.com", hidden: false },
      { id: "ship", name: "S", emEmail: "b@example.com", hidden: false },
    ],
    users: [],
    squadAccounts: [],
  })),
}));

describe("getSessionAccess", () => {
  it("derives allowed squads and roles from session user", () => {
    const session = {
      expires: "2099-01-01T00:00:00.000Z",
      user: {
        email: "u@example.com",
        role: "em",
        squadId: "ship",
        globalAdmin: false,
        allowedSquads: ["ship"],
        squadRoles: { ship: "em" as const },
      },
    } as Session;
    const access = getSessionAccess(session);
    expect(access?.allowedSquads).toEqual(["ship"]);
    expect(access?.squadRoles.ship).toBe("em");
  });
});

describe("canReadFromSession / canWriteFromSession", () => {
  it("reviewer can read but not write", () => {
    const access = getSessionAccess({
      expires: "2099-01-01T00:00:00.000Z",
      user: {
        email: "u@example.com",
        role: "reviewer",
        squadId: "ventures",
        allowedSquads: ["ventures"],
        squadRoles: { ventures: "reviewer" },
      },
    } as Session);
    expect(canReadFromSession(access, "ventures")).toBe(true);
    expect(canWriteFromSession(access, "ventures")).toBe(false);
  });

  it("editor can read and write own squad only", () => {
    const access = getSessionAccess({
      expires: "2099-01-01T00:00:00.000Z",
      user: {
        email: "editor@example.com",
        role: "editor",
        squadId: "ventures",
        allowedSquads: ["ventures", "ship"],
        squadRoles: { ventures: "editor", ship: "reviewer" },
      },
    } as Session);
    expect(access?.allowedSquads).toEqual(["ventures"]);
    expect(canReadFromSession(access, "ventures")).toBe(true);
    expect(canWriteFromSession(access, "ventures")).toBe(true);
    expect(canReadFromSession(access, "ship")).toBe(false);
    expect(canWriteFromSession(access, "ship")).toBe(false);
  });
});
