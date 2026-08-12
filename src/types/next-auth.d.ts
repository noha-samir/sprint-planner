import type { DefaultSession } from "next-auth";
import type { SquadMembershipRole } from "@/lib/authz/types";

declare module "next-auth" {
  interface Session {
    error?: "SessionRevoked";
    user: DefaultSession["user"] & {
      role?: "reviewer" | "editor" | "em" | "super_admin";
      squadId?: string | null;
      globalAdmin?: boolean;
      allowedSquads?: string[];
      squadRoles?: Record<string, SquadMembershipRole>;
      jiraAccountId?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "reviewer" | "editor" | "em" | "super_admin";
    squadId?: string | null;
    globalAdmin?: boolean;
    allowedSquads?: string[];
    squadRoles?: Record<string, SquadMembershipRole>;
    jiraAccountId?: string;
    /** @deprecated legacy; stripped from tokens */
    jiraApiTokenEnc?: string;
    sessionVersion?: number;
    entitlementsRefreshedAt?: number;
    error?: "SessionRevoked";
  }
}
