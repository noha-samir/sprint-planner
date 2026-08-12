import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSquadJiraConfig } from "./types";

const readSquadJiraConfig = vi.fn();
const writeSquadJiraConfig = vi.fn();

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    resource: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("./configStore", () => ({
  readSquadJiraConfig: (...args: unknown[]) => readSquadJiraConfig(...args),
  writeSquadJiraConfig: (...args: unknown[]) => writeSquadJiraConfig(...args),
}));

import { prisma } from "@/lib/db/prisma";
import { pruneAssigneeMapToRoster } from "./resourceJiraIdentity";

describe("pruneAssigneeMapToRoster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("drops map keys that are not on the roster", async () => {
    const base = defaultSquadJiraConfig();
    readSquadJiraConfig.mockResolvedValue({
      ...base,
      productManagerName: "PM Name",
      assigneeMap: {
        OnRoster: "acct-1",
        StaleKey: "acct-2",
        "PM Name": "acct-pm",
      },
    });
    vi.mocked(prisma.resource.findMany).mockResolvedValue([{ name: "OnRoster" }] as never);
    writeSquadJiraConfig.mockImplementation(async (_squad: string, next: unknown) => next);

    const config = await pruneAssigneeMapToRoster("ventures");
    expect(config.assigneeMap).toEqual({
      OnRoster: "acct-1",
    });
    expect(writeSquadJiraConfig).toHaveBeenCalled();
  });
});
