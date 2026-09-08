import { describe, expect, it } from "vitest";
import { parseUserManagementWriteBody } from "./registryValidation";

describe("parseUserManagementWriteBody pmEmails", () => {
  it("defaults missing pmEmails to [] and normalizes emails", () => {
    const parsed = parseUserManagementWriteBody({
      squads: [{ id: "ventures", name: "Ventures", emEmail: "em@example.com" }],
      users: [{ email: "admin@example.com", role: "super_admin", squadId: "ventures" }],
      squadAccounts: [],
    });
    expect(parsed.squads[0]?.pmEmails).toEqual([]);
  });

  it("accepts a list of PM emails", () => {
    const parsed = parseUserManagementWriteBody({
      squads: [
        {
          id: "ventures",
          name: "Ventures",
          emEmail: "em@example.com",
          pmEmails: ["  PM@Example.com ", "other@example.com"],
        },
      ],
      users: [{ email: "admin@example.com", role: "super_admin", squadId: "ventures" }],
      squadAccounts: [],
    });
    expect(parsed.squads[0]?.pmEmails).toEqual(["pm@example.com", "other@example.com"]);
  });
});
