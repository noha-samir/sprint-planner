import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db/prisma";
import {
  ACCESS_REGISTRY_CACHE_MS,
  invalidateAccessRegistryCache,
  readAccessRegistry,
  writeAccessRegistry,
} from "./registry";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    squad: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    squadAccount: { findMany: vi.fn() },
    $transaction: vi.fn(async () => undefined),
  },
}));

const squadRow = { id: "ventures", name: "Ventures", emEmail: "em@x.co", pmEmails: [], hidden: false };
const userRow = (email: string) => ({ email, role: "super_admin", squadId: "ventures" });

const mockDb = (email: string) => {
  vi.mocked(prisma.squad.findMany).mockResolvedValue([squadRow] as never);
  vi.mocked(prisma.user.findMany).mockResolvedValue([userRow(email)] as never);
  vi.mocked(prisma.squadAccount.findMany).mockResolvedValue([] as never);
};

describe("readAccessRegistry cache", () => {
  beforeEach(() => invalidateAccessRegistryCache());

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("loads from the database once for concurrent and repeated reads", async () => {
    mockDb("a@x.co");

    const [first, second] = await Promise.all([readAccessRegistry(), readAccessRegistry()]);
    await readAccessRegistry();

    expect(first.users[0].email).toBe("a@x.co");
    expect(second.users[0].email).toBe("a@x.co");
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it("returns copies so callers cannot corrupt the cache", async () => {
    mockDb("a@x.co");

    const first = await readAccessRegistry();
    first.users.push({ email: "intruder@x.co", role: "reviewer", squadId: "ventures" });

    expect((await readAccessRegistry()).users).toHaveLength(1);
  });

  it("reloads after the cache window", async () => {
    vi.useFakeTimers();
    mockDb("a@x.co");
    await readAccessRegistry();

    mockDb("b@x.co");
    vi.advanceTimersByTime(ACCESS_REGISTRY_CACHE_MS + 1);

    expect((await readAccessRegistry()).users[0].email).toBe("b@x.co");
  });

  it("reloads right after writeAccessRegistry", async () => {
    mockDb("a@x.co");
    const registry = await readAccessRegistry();

    mockDb("b@x.co");
    await writeAccessRegistry(registry);

    expect((await readAccessRegistry()).users[0].email).toBe("b@x.co");
  });

  it("does not cache a failed load", async () => {
    vi.mocked(prisma.squad.findMany).mockRejectedValueOnce(new Error("P2024 pool timeout"));
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.squadAccount.findMany).mockResolvedValue([] as never);

    await expect(readAccessRegistry()).rejects.toThrow("P2024");

    mockDb("a@x.co");
    expect((await readAccessRegistry()).users[0].email).toBe("a@x.co");
  });
});
