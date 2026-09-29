import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccessRegistry } from "@/lib/access/registry";
import { prisma } from "@/lib/db/prisma";
import {
  bumpSessionVersions,
  emailsNeedingSessionRevoke,
  getSessionVersion,
  SESSION_VERSION_CACHE_MS,
} from "./sessionRevocation";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    sessionVersion: {
      findUnique: vi.fn(),
      upsert: vi.fn(() => ({})),
    },
    $transaction: vi.fn(async () => []),
  },
}));

describe("getSessionVersion cache", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("queries the database once per email within the cache window", async () => {
    vi.mocked(prisma.sessionVersion.findUnique).mockResolvedValue({ email: "cache-a@x.co", version: 2 } as never);

    expect(await getSessionVersion("Cache-A@x.co")).toBe(2);
    expect(await getSessionVersion("cache-a@x.co")).toBe(2);
    expect(prisma.sessionVersion.findUnique).toHaveBeenCalledTimes(1);
  });

  it("asks the database again after the cache window", async () => {
    vi.useFakeTimers();
    vi.mocked(prisma.sessionVersion.findUnique)
      .mockResolvedValueOnce({ email: "cache-b@x.co", version: 1 } as never)
      .mockResolvedValueOnce({ email: "cache-b@x.co", version: 3 } as never);

    expect(await getSessionVersion("cache-b@x.co")).toBe(1);
    vi.advanceTimersByTime(SESSION_VERSION_CACHE_MS + 1);
    expect(await getSessionVersion("cache-b@x.co")).toBe(3);
  });

  it("drops cached versions of revoked emails right after the bump", async () => {
    vi.mocked(prisma.sessionVersion.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ email: "cache-c@x.co", version: 1 } as never);

    expect(await getSessionVersion("cache-c@x.co")).toBe(0);
    await bumpSessionVersions(["cache-c@x.co"]);
    expect(await getSessionVersion("cache-c@x.co")).toBe(1);
  });
});

const base = (): AccessRegistry => ({
  squads: [{ id: "ventures", name: "Ventures", emEmail: "admin@example.com", pmEmails: [], hidden: false }],
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
