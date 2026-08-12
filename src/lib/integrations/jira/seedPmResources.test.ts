import { beforeEach, describe, expect, it, vi } from "vitest";

const createMappedResource = vi.fn();
const resolveJiraAccountForPlannerName = vi.fn();
const requireJiraApiCredentials = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    resource: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("./createMappedResource", () => ({
  createMappedResource: (...args: unknown[]) => createMappedResource(...args),
}));

vi.mock("./userSearch", () => ({
  resolveJiraAccountForPlannerName: (...args: unknown[]) => resolveJiraAccountForPlannerName(...args),
}));

vi.mock("@/lib/authz/sessionJiraCredentials", () => ({
  requireJiraApiCredentials: (...args: unknown[]) => requireJiraApiCredentials(...args),
}));

import { prisma } from "@/lib/db/prisma";
import { seedDefaultProductManagers } from "./seedPmResources";

describe("seedDefaultProductManagers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireJiraApiCredentials.mockResolvedValue({
      email: "a@b.co",
      apiToken: "tok",
      siteUrl: "https://example.atlassian.net",
    });
  });

  it("skips when all seed queries are already covered", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      { name: "Alex Rivera" },
      { name: "Casey Morgan" },
      { name: "Jordan Lee" },
    ] as never);
    const result = await seedDefaultProductManagers("ventures");
    expect(result.created).toEqual([]);
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(createMappedResource).not.toHaveBeenCalled();
  });

  it("creates mapped PM resources for unique Jira hits", async () => {
    vi.mocked(prisma.resource.findMany).mockResolvedValue([] as never);
    resolveJiraAccountForPlannerName
      .mockResolvedValueOnce({
        accountId: "acct-rivera",
        candidates: [{ accountId: "acct-rivera", displayName: "Alex Rivera" }],
      })
      .mockResolvedValueOnce({
        accountId: "acct-rivera",
        candidates: [{ accountId: "acct-rivera", displayName: "Alex Rivera" }],
      })
      .mockResolvedValueOnce({
        accountId: "acct-casey",
        candidates: [{ accountId: "acct-casey", displayName: "Casey Morgan" }],
      })
      .mockResolvedValueOnce({
        accountId: null,
        candidates: [],
      });
    createMappedResource.mockImplementation(async (_squad: string, params: { displayName: string; accountId: string }) => ({
      resource: { name: params.displayName, type: "PM" },
      config: {},
      renames: [],
    }));

    const result = await seedDefaultProductManagers("ventures");
    expect(result.created.map((row) => row.name)).toEqual(
      expect.arrayContaining(["Alex Rivera", "Casey Morgan"]),
    );
    expect(result.failed.some((row) => row.query === "Lee")).toBe(true);
    expect(createMappedResource).toHaveBeenCalled();
  });
});
