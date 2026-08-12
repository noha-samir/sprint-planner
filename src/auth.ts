import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { appEnv } from "@/lib/config/env";
import { isSignInAllowedEmail } from "@/constants/signIn";
import { getAllowedEmailDomain } from "@/lib/config/appConfig";
import { readAccessRegistry } from "@/lib/access/registry";
import { clearJiraApiToken, upsertJiraAccount } from "@/lib/authz/jiraAccountsStore";
import { verifyJiraEmailAndApiKey } from "@/lib/authz/jiraSignIn";
import { sanitizeSquadKey } from "@/lib/authz/permissions";
import { resolveEntitlements } from "@/lib/authz/resolveEntitlements";
import { getSessionVersion } from "@/lib/authz/sessionRevocation";
import { resolveAuthCryptoSecret } from "@/lib/crypto/secretBox";
import { logger } from "@/lib/logging/logger";
import type { SquadMembershipRole } from "@/lib/authz/types";

const authSecret = (() => {
  try {
    return resolveAuthCryptoSecret();
  } catch {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SECRET is required in production");
    }
    const dev = process.env.AUTH_SECRET?.trim();
    if (!dev) {
      throw new Error("AUTH_SECRET is required. Set it in .env.local (npx auth secret).");
    }
    return dev;
  }
})();

const useSecureCookies = process.env.NODE_ENV === "production";
const ENTITLEMENTS_REFRESH_MS = 5 * 60 * 1000;

const applyEntitlementsToToken = async (
  token: Record<string, unknown>,
  email: string,
): Promise<Record<string, unknown>> => {
  const ent = await resolveEntitlements(email);
  const registry = await readAccessRegistry();
  const knownIds = new Set(
    registry.squads.map((s) => sanitizeSquadKey(s.id)).filter((id): id is string => id != null),
  );

  if (ent.globalAdmin) {
    const allowedSquads = registry.squads
      .filter((s) => !s.hidden)
      .map((s) => sanitizeSquadKey(s.id))
      .filter((id): id is string => id != null);
    const currentSquad = sanitizeSquadKey(
      typeof token.squadId === "string" ? token.squadId : allowedSquads[0] ?? null,
    );
    return {
      ...token,
      role: "super_admin",
      globalAdmin: true,
      allowedSquads,
      squadRoles: {},
      squadId: currentSquad && knownIds.has(currentSquad) ? currentSquad : allowedSquads[0] ?? null,
      entitlementsRefreshedAt: Date.now(),
      error: undefined,
    };
  }

  const memberships = ent.memberships
    .map((m) => {
      const id = sanitizeSquadKey(m.squadId);
      if (!id || !knownIds.has(id)) return null;
      return { squadId: id, role: m.role };
    })
    .filter((m): m is { squadId: string; role: SquadMembershipRole } => m != null);

  if (memberships.length === 0) {
    return {
      ...token,
      error: "SessionRevoked",
      role: undefined,
      globalAdmin: false,
      allowedSquads: [],
      squadRoles: {},
      jiraAccountId: undefined,
      entitlementsRefreshedAt: Date.now(),
    };
  }

  const hasEm = memberships.some((m) => m.role === "em");
  const hasEditor = memberships.some((m) => m.role === "editor");
  const sessionRole = hasEm ? ("em" as const) : hasEditor ? ("editor" as const) : ("reviewer" as const);

  // Editors are locked to squads where they are editor (not other memberships).
  const scopedMemberships =
    sessionRole === "editor" ? memberships.filter((m) => m.role === "editor") : memberships;
  const allowedSquads = [...new Set(scopedMemberships.map((m) => m.squadId))];
  const squadRoles = Object.fromEntries(scopedMemberships.map((m) => [m.squadId, m.role])) as Record<
    string,
    SquadMembershipRole
  >;
  const prevSquad = sanitizeSquadKey(typeof token.squadId === "string" ? token.squadId : null);
  const squadId =
    prevSquad && allowedSquads.includes(prevSquad) ? prevSquad : allowedSquads[0] ?? null;

  return {
    ...token,
    role: sessionRole,
    globalAdmin: false,
    allowedSquads,
    squadRoles,
    squadId,
    entitlementsRefreshedAt: Date.now(),
    error: undefined,
  };
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: authSecret,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 12,
  },
  cookies: {
    sessionToken: {
      name: useSecureCookies
        ? "__Secure-authjs.session-token"
        : "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    csrfToken: {
      name: useSecureCookies ? "__Host-authjs.csrf-token" : "authjs.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
    callbackUrl: {
      name: useSecureCookies
        ? "__Secure-authjs.callback-url"
        : "authjs.callback-url",
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: useSecureCookies,
      },
    },
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        apiKey: { label: "Jira API key", type: "password" },
        squadId: { label: "Squad", type: "text" },
      },
      authorize: async (credentials) => {
        const email = String(credentials?.email ?? "")
          .toLowerCase()
          .trim();
        const apiKey = String(credentials?.apiKey ?? "").trim();
        const squadPickRaw = String(credentials?.squadId ?? "").trim();
        const squadIdPick = squadPickRaw ? sanitizeSquadKey(squadPickRaw) : null;
        if (!email || !apiKey || !isSignInAllowedEmail(email, await getAllowedEmailDomain())) {
          return null;
        }

        const jiraProfile = await verifyJiraEmailAndApiKey(email, apiKey);
        if (!jiraProfile) {
          return null;
        }

        const ent = await resolveEntitlements(email);
        const registry = await readAccessRegistry();
        const knownIds = new Set(
          registry.squads.map((s) => sanitizeSquadKey(s.id)).filter((id): id is string => id != null),
        );
        const isSuper = ent.globalAdmin;
        const sessionVersion = await getSessionVersion(email);

        if (isSuper) {
          await upsertJiraAccount(email, jiraProfile.accountId, apiKey);
          let selected: string | null = squadIdPick && knownIds.has(squadIdPick) ? squadIdPick : null;
          if (!selected) {
            const fallback =
              registry.squads.find((s) => !s.hidden)?.id ?? registry.squads[0]?.id ?? appEnv.defaultSquadId;
            selected = sanitizeSquadKey(fallback);
          }
          const allowedSquads = registry.squads
            .filter((s) => !s.hidden)
            .map((s) => sanitizeSquadKey(s.id))
            .filter((id): id is string => id != null);
          logger.info("sign_in_ok", { email, role: "super_admin" });
          return {
            id: email,
            email,
            role: "super_admin" as const,
            squadId: selected,
            globalAdmin: true,
            allowedSquads,
            squadRoles: {} as Record<string, SquadMembershipRole>,
            jiraAccountId: jiraProfile.accountId,
            sessionVersion,
          };
        }

        const memberships = ent.memberships
          .map((m) => {
            const id = sanitizeSquadKey(m.squadId);
            if (!id || !knownIds.has(id)) return null;
            return { squadId: id, role: m.role };
          })
          .filter((m): m is { squadId: string; role: SquadMembershipRole } => m != null);

        if (memberships.length === 0) {
          return null;
        }

        await upsertJiraAccount(email, jiraProfile.accountId, apiKey);

        let selected: string | null = null;
        if (memberships.length === 1) {
          selected = memberships[0].squadId;
        } else {
          if (!squadIdPick || !memberships.some((m) => m.squadId === squadIdPick)) {
            return null;
          }
          selected = squadIdPick;
        }

        const hasEm = memberships.some((m) => m.role === "em");
        const hasEditor = memberships.some((m) => m.role === "editor");
        const sessionRole = hasEm ? ("em" as const) : hasEditor ? ("editor" as const) : ("reviewer" as const);

        // Editor may only sign into a squad where they are editor.
        if (
          sessionRole === "editor" &&
          (!selected || !memberships.some((m) => m.squadId === selected && m.role === "editor"))
        ) {
          return null;
        }

        // Editor: only the selected squad (own squad), not every membership row.
        const scopedMemberships =
          sessionRole === "editor" ? memberships.filter((m) => m.role === "editor") : memberships;
        const allowedSquads =
          sessionRole === "editor" && selected
            ? [selected]
            : [...new Set(scopedMemberships.map((m) => m.squadId))];
        const squadRoles =
          sessionRole === "editor" && selected
            ? ({ [selected]: "editor" } as Record<string, SquadMembershipRole>)
            : (Object.fromEntries(scopedMemberships.map((m) => [m.squadId, m.role])) as Record<
                string,
                SquadMembershipRole
              >);
        logger.info("sign_in_ok", { email, role: sessionRole });

        return {
          id: email,
          email,
          role: sessionRole,
          squadId: selected,
          globalAdmin: false,
          allowedSquads,
          squadRoles,
          jiraAccountId: jiraProfile.accountId,
          sessionVersion,
        };
      },
    }),
  ],
  events: {
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      const email =
        typeof token?.email === "string" ? token.email.trim().toLowerCase() : "";
      if (!email) return;
      try {
        await clearJiraApiToken(email);
        logger.info("sign_out_token_cleared", { email });
      } catch (error) {
        logger.warn("sign_out_token_clear_failed", {
          email,
          reason: error instanceof Error ? error.message : "unknown",
        });
      }
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as {
          role: "reviewer" | "editor" | "em" | "super_admin";
          squadId: string | null;
          globalAdmin?: boolean;
          allowedSquads?: string[];
          squadRoles?: Record<string, SquadMembershipRole>;
          jiraAccountId?: string;
          sessionVersion?: number;
        };
        token.role = u.role;
        token.squadId = u.squadId;
        token.globalAdmin = u.globalAdmin;
        token.allowedSquads = u.allowedSquads;
        token.squadRoles = u.squadRoles;
        token.jiraAccountId = u.jiraAccountId;
        token.sessionVersion = u.sessionVersion ?? 0;
        token.email = user.email ?? token.email;
        token.entitlementsRefreshedAt = Date.now();
        delete token.jiraApiTokenEnc;
        delete token.error;
        return token;
      }

      const email = typeof token.email === "string" ? token.email.toLowerCase() : "";
      if (email) {
        const currentVersion = await getSessionVersion(email);
        const tokenVersion = typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
        if (tokenVersion !== currentVersion) {
          return {
            ...token,
            error: "SessionRevoked",
            role: undefined,
            globalAdmin: false,
            allowedSquads: [],
            squadRoles: {},
            jiraAccountId: undefined,
            jiraApiTokenEnc: undefined,
          };
        }

        const refreshedAt =
          typeof token.entitlementsRefreshedAt === "number" ? token.entitlementsRefreshedAt : 0;
        if (Date.now() - refreshedAt >= ENTITLEMENTS_REFRESH_MS) {
          try {
            return await applyEntitlementsToToken(token as Record<string, unknown>, email);
          } catch (error) {
            logger.warn("entitlements_refresh_failed", {
              email,
              reason: error instanceof Error ? error.message : "unknown",
            });
          }
        }
      }
      if (token.jiraApiTokenEnc) {
        delete token.jiraApiTokenEnc;
      }
      return token;
    },
    session({ session, token }) {
      if (token.error === "SessionRevoked") {
        session.error = "SessionRevoked";
        if (session.user) {
          session.user.role = undefined;
          session.user.globalAdmin = false;
          session.user.allowedSquads = [];
          session.user.squadRoles = {};
          session.user.jiraAccountId = null;
        }
        return session;
      }
      if (session.user) {
        session.user.role = token.role as typeof session.user.role;
        session.user.squadId = (token.squadId as string | null | undefined) ?? null;
        session.user.globalAdmin = Boolean(token.globalAdmin);
        session.user.allowedSquads = (token.allowedSquads as string[] | undefined) ?? [];
        session.user.squadRoles = (token.squadRoles as Record<string, SquadMembershipRole> | undefined) ?? {};
        session.user.jiraAccountId = (token.jiraAccountId as string | undefined) ?? null;
      }
      return session;
    },
  },
  pages: {
    signIn: "/sign-in",
  },
});
