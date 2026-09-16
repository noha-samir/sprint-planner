import { describe, expect, it } from "vitest";
import {
  getCapabilities,
  normalizeUserRole,
  plannerAccessContext,
  sessionCapabilities,
  type AccessContext,
} from "./control";

describe("normalizeUserRole", () => {
  it("keeps editor as its own role", () => {
    expect(normalizeUserRole("editor")).toBe("editor");
    expect(normalizeUserRole("viewer")).toBe("reviewer");
  });
});

const base = (role: AccessContext["role"], squadRole?: "em" | "editor" | "reviewer"): AccessContext => ({
  email: `${role}@example.com`,
  role,
  squadId: "ventures",
  activeSquadId: "ventures",
  squadRoles: squadRole ? { ventures: squadRole } : {},
  allowedSquads: ["ventures"],
});

describe("getCapabilities role matrix", () => {
  it("super admin can do everything", () => {
    const caps = getCapabilities({ ...base("super_admin"), globalAdmin: true });
    expect(caps.canWrite).toBe(true);
    expect(caps.canManageSprintLifecycle).toBe(true);
    expect(caps.canManageUsers).toBe(true);
    expect(caps.canViewUserManagement).toBe(true);
    expect(caps.canAccessOpsTabs).toBe(true);
    expect(caps.canEditOpsTabs).toBe(true);
  });

  it("reviewer can see ops/UM but edit nothing", () => {
    const caps = getCapabilities(base("reviewer", "reviewer"));
    expect(caps.canWrite).toBe(false);
    expect(caps.canManageSprintLifecycle).toBe(false);
    expect(caps.canManageUsers).toBe(false);
    expect(caps.canViewUserManagement).toBe(true);
    expect(caps.canAccessOpsTabs).toBe(true);
    expect(caps.canEditOpsTabs).toBe(false);
  });

  it("editor can write planner on own squad and view ops/UM without editing them", () => {
    const caps = getCapabilities(base("editor", "editor"));
    expect(caps.canWrite).toBe(true);
    expect(caps.canManageSprintLifecycle).toBe(false);
    expect(caps.canAccessSquad("ventures")).toBe(true);
    expect(caps.canAccessSquad("ship")).toBe(false);
    expect(caps.canManageUsers).toBe(false);
    expect(caps.canViewUserManagement).toBe(true);
    expect(caps.canAccessOpsTabs).toBe(true);
    expect(caps.canEditOpsTabs).toBe(false);

    const otherSquad = getCapabilities({
      ...base("editor", "editor"),
      activeSquadId: "ship",
      allowedSquads: ["ventures", "ship"],
    });
    expect(otherSquad.canWrite).toBe(false);
    expect(otherSquad.canAccessSquad("ship")).toBe(false);
  });

  it("EM can write planner and run sprint lifecycle actions", () => {
    const caps = getCapabilities(base("em", "em"));
    expect(caps.canWrite).toBe(true);
    expect(caps.canManageSprintLifecycle).toBe(true);
    expect(caps.canManageUsers).toBe(false);
    expect(caps.canViewUserManagement).toBe(true);
    expect(caps.canAccessOpsTabs).toBe(true);
    expect(caps.canEditOpsTabs).toBe(false);
  });

  it("does not fall back to Viewer capabilities when role is cleared", () => {
    const caps = getCapabilities({
      email: "em@example.com",
      role: "" as AccessContext["role"],
      squadId: "ventures",
    });
    expect(caps.canWrite).toBe(false);
    expect(caps.canViewUserManagement).toBe(false);
    expect(caps.canAccessOpsTabs).toBe(false);
    expect(caps.canAccessSquad("ventures")).toBe(false);
  });
});

describe("plannerAccessContext / sessionCapabilities", () => {
  it("returns null for revoked or role-less sessions instead of Viewer", () => {
    expect(
      plannerAccessContext(
        { error: "SessionRevoked", user: { email: "a@example.com", role: undefined } },
        "ventures",
      ),
    ).toBeNull();
    expect(
      plannerAccessContext({ user: { email: "a@example.com", role: undefined } }, "ventures"),
    ).toBeNull();
    expect(sessionCapabilities({ user: { email: "a@example.com" } }, "ventures")).toBeNull();
  });

  it("builds capabilities for a valid EM session", () => {
    const caps = sessionCapabilities(
      {
        user: {
          email: "em@example.com",
          role: "em",
          squadId: "ventures",
          squadRoles: { ventures: "em" },
          allowedSquads: ["ventures"],
        },
      },
      "ventures",
    );
    expect(caps?.canWrite).toBe(true);
    expect(caps?.canManageSprintLifecycle).toBe(true);
  });
});
