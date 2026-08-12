import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSquadJiraConfig } from "./types";

const readSquadJiraConfig = vi.fn();
const writeSquadJiraConfig = vi.fn();
const applyResourceJiraIdentities = vi.fn();
const pruneAssigneeMapToRoster = vi.fn();
const clearSquadResourceNicknames = vi.fn();

vi.mock("./configStore", () => ({
  readSquadJiraConfig: (...args: unknown[]) => readSquadJiraConfig(...args),
  writeSquadJiraConfig: (...args: unknown[]) => writeSquadJiraConfig(...args),
}));

vi.mock("./resourceJiraIdentity", () => ({
  applyResourceJiraIdentities: (...args: unknown[]) => applyResourceJiraIdentities(...args),
  pruneAssigneeMapToRoster: (...args: unknown[]) => pruneAssigneeMapToRoster(...args),
  clearSquadResourceNicknames: (...args: unknown[]) => clearSquadResourceNicknames(...args),
}));

vi.mock("@/lib/authz/sessionJiraCredentials", () => ({
  requireJiraApiCredentials: vi.fn(),
}));

vi.mock("./userSearch", () => ({
  fetchJiraUserByAccountId: vi.fn(),
  resolveJiraAccountForPlannerName: vi.fn(),
}));

import { applyAssigneeMappings } from "./autoAssigneeMap";

describe("applyAssigneeMappings dedupe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const base = defaultSquadJiraConfig();
    readSquadJiraConfig.mockResolvedValue({
      ...base,
      assigneeMap: { Alice: "acct-alice" },
    });
    clearSquadResourceNicknames.mockResolvedValue(undefined);
  });

  it("rejects mapping an accountId already used by another name", async () => {
    await expect(
      applyAssigneeMappings("ventures", [
        { plannerName: "Bob", accountId: "acct-alice", displayName: "Bob" },
      ]),
    ).rejects.toMatchObject({
      message: expect.stringContaining("already mapped"),
      status: 409,
    });
    expect(writeSquadJiraConfig).not.toHaveBeenCalled();
  });
});
