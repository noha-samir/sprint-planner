import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@/lib/access/server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/access/server")>("@/lib/access/server");
  return {
    ...actual,
    getSessionAccess: vi.fn(),
    resolveRequestedSquadId: vi.fn(async (_access: unknown, requested: string | null) => requested ?? "ventures"),
    canWriteFromSession: vi.fn(() => true),
    canReadFromSession: vi.fn(() => true),
  };
});

import { auth } from "@/auth";
import { getSessionAccess } from "@/lib/access/server";
import { requireSuperAdminAccess, requireWriteAccess } from "./apiAuth";

describe("jira apiAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { email: "a@b.co" } } as never);
  });

  it("requireSuperAdminAccess allows super_admin", async () => {
    vi.mocked(getSessionAccess).mockReturnValue({
      email: "a@b.co",
      role: "super_admin",
      squadId: "ventures",
      globalAdmin: true,
      allowedSquads: ["ventures"],
      squadRoles: {},
    });
    const result = await requireSuperAdminAccess(
      new Request("http://localhost/api", { headers: { "x-squad-id": "ventures" } }),
    );
    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.squadId).toBe("ventures");
    }
  });

  it("requireSuperAdminAccess rejects engineering managers", async () => {
    vi.mocked(getSessionAccess).mockReturnValue({
      email: "em@b.co",
      role: "em",
      squadId: "ventures",
      globalAdmin: false,
      allowedSquads: ["ventures"],
      squadRoles: { ventures: "em" },
    });
    const result = await requireSuperAdminAccess(
      new Request("http://localhost/api", { headers: { "x-squad-id": "ventures" } }),
    );
    expect("error" in result).toBe(true);
  });

  it("requireWriteAccess still allows engineering managers", async () => {
    vi.mocked(getSessionAccess).mockReturnValue({
      email: "em@b.co",
      role: "em",
      squadId: "ventures",
      globalAdmin: false,
      allowedSquads: ["ventures"],
      squadRoles: { ventures: "em" },
    });
    const result = await requireWriteAccess(
      new Request("http://localhost/api", { headers: { "x-squad-id": "ventures" } }),
    );
    expect("error" in result).toBe(false);
  });
});
