import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSquadJiraConfig } from "./types";

const readSquadJiraConfig = vi.fn();
const writeSquadJiraConfig = vi.fn();
const applyResourceJiraIdentities = vi.fn();
const pruneAssigneeMapToRoster = vi.fn();
const requireJiraApiCredentials = vi.fn();
const fetchJiraUserByAccountId = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    resource: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

vi.mock("./configStore", () => ({
  readSquadJiraConfig: (...args: unknown[]) => readSquadJiraConfig(...args),
  writeSquadJiraConfig: (...args: unknown[]) => writeSquadJiraConfig(...args),
}));

vi.mock("./resourceJiraIdentity", () => ({
  applyResourceJiraIdentities: (...args: unknown[]) => applyResourceJiraIdentities(...args),
  pruneAssigneeMapToRoster: (...args: unknown[]) => pruneAssigneeMapToRoster(...args),
}));

vi.mock("@/lib/authz/sessionJiraCredentials", () => ({
  requireJiraApiCredentials: (...args: unknown[]) => requireJiraApiCredentials(...args),
}));

vi.mock("./userSearch", () => ({
  fetchJiraUserByAccountId: (...args: unknown[]) => fetchJiraUserByAccountId(...args),
}));

import { prisma } from "@/lib/db/prisma";
import {
  createMappedResource,
  refreshMappedIdentitiesFromJira,
} from "./createMappedResource";

describe("createMappedResource", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const base = defaultSquadJiraConfig();
    readSquadJiraConfig.mockResolvedValue({
      ...base,
      assigneeMap: { Existing: "acct-existing" },
    });
    writeSquadJiraConfig.mockResolvedValue(undefined);
    applyResourceJiraIdentities.mockResolvedValue({
      config: { ...base, assigneeMap: { Existing: "acct-existing", "New Person": "acct-new" } },
      renames: [],
    });
    pruneAssigneeMapToRoster.mockResolvedValue({
      ...base,
      assigneeMap: { Existing: "acct-existing", "New Person": "acct-new" },
    });
    vi.mocked(prisma.resource.findMany).mockResolvedValue([
      { id: "1", name: "Existing" },
    ] as never);
    vi.mocked(prisma.resource.create).mockResolvedValue({ id: "2" } as never);
  });

  it("creates resource and maps accountId", async () => {
    const result = await createMappedResource("ventures", {
      type: "BE",
      accountId: "acct-new",
      displayName: "New Person",
      capacityHours: 80,
    });

    expect(prisma.resource.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        squadId: "ventures",
        name: "New Person",
        type: "BE",
      }),
    });
    expect(writeSquadJiraConfig).toHaveBeenCalled();
    expect(result.resource.name).toBe("New Person");
    expect(result.config.assigneeMap["New Person"]).toBe("acct-new");
  });

  it("rejects duplicate accountId", async () => {
    await expect(
      createMappedResource("ventures", {
        type: "FE",
        accountId: "acct-existing",
        displayName: "Someone Else",
        capacityHours: 80,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("already mapped"),
      status: 409,
    });
    expect(prisma.resource.create).not.toHaveBeenCalled();
  });

  it("rejects duplicate displayName case-insensitively", async () => {
    await expect(
      createMappedResource("ventures", {
        type: "FE",
        accountId: "acct-other",
        displayName: "existing",
        capacityHours: 80,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("already exists"),
      status: 409,
    });
    expect(prisma.resource.create).not.toHaveBeenCalled();
  });
});

describe("refreshMappedIdentitiesFromJira", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const base = defaultSquadJiraConfig();
    readSquadJiraConfig.mockResolvedValue({
      ...base,
      assigneeMap: { Short: "acct-1", Stale: "acct-gone" },
    });
    requireJiraApiCredentials.mockResolvedValue({
      email: "a@b.co",
      apiToken: "tok",
      siteUrl: "https://example.atlassian.net",
    });
    vi.mocked(prisma.resource.findMany).mockResolvedValue([{ name: "Short" }] as never);
    fetchJiraUserByAccountId.mockResolvedValue({
      accountId: "acct-1",
      displayName: "Full Name",
    });
    writeSquadJiraConfig.mockResolvedValue(undefined);
    applyResourceJiraIdentities.mockResolvedValue({
      config: base,
      renames: [{ from: "Short", to: "Full Name" }],
    });
    pruneAssigneeMapToRoster.mockResolvedValue({
      ...base,
      assigneeMap: { "Full Name": "acct-1" },
    });
  });

  it("renames via accountId and returns pruned config", async () => {
    const result = await refreshMappedIdentitiesFromJira("ventures");
    expect(fetchJiraUserByAccountId).toHaveBeenCalledWith(expect.anything(), "acct-1");
    expect(applyResourceJiraIdentities).toHaveBeenCalledWith(
      "ventures",
      expect.arrayContaining([
        expect.objectContaining({
          currentName: "Short",
          accountId: "acct-1",
          displayName: "Full Name",
        }),
      ]),
    );
    expect(result.renames).toEqual([{ from: "Short", to: "Full Name" }]);
    expect(result.config.assigneeMap).toEqual({ "Full Name": "acct-1" });
  });
});
