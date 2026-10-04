"use client";

import { useEffect } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import { HoverHintLayer } from "@/components/common/HoverHintLayer";
import { applyColorScheme, resolveColorScheme } from "@/lib/ui/colorScheme";
import { signOutAndClearJiraToken } from "@/lib/authz/signOutClient";
import { safeCallbackUrl } from "@/lib/ui/safeCallbackUrl";

/**
 * Ends the page when the session is no longer usable instead of leaving it view-only:
 * revoked / role cleared → sign out; expired (no session at all) → sign-in, then back to this page.
 * Side effects: navigates away; may re-fetch the session once.
 */
function SessionRevocationWatcher() {
  const { data: session, status, update } = useSession();

  useEffect(() => {
    if (status !== "unauthenticated" || window.location.pathname === "/sign-in") return;
    let cancelled = false;
    void (async () => {
      // Confirm with the server first: a network blip also reports "unauthenticated".
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "include" });
        if (!response.ok || cancelled) return;
        const body = (await response.json()) as { user?: unknown } | null;
        if (cancelled) return;
        if (body?.user) {
          void update();
          return;
        }
      } catch {
        return;
      }
      const callbackUrl = safeCallbackUrl(`${window.location.pathname}${window.location.search}`, "/");
      window.location.assign(`/sign-in?callbackUrl=${encodeURIComponent(callbackUrl)}`);
    })();
    return () => {
      cancelled = true;
    };
  }, [status, update]);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (session?.error === "SessionRevoked") {
      void signOutAndClearJiraToken("/sign-in");
      return;
    }
    // Role cleared after expiry/revoke — do not leave the user as a Viewer.
    if (session?.user?.email && !session.user.role) {
      void signOutAndClearJiraToken("/sign-in");
    }
  }, [session?.error, session?.user?.email, session?.user?.role, status]);

  return null;
}

function ColorSchemeBoot() {
  useEffect(() => {
    applyColorScheme(resolveColorScheme());
  }, []);
  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider refetchInterval={300} refetchOnWindowFocus={false}>
      <ColorSchemeBoot />
      <SessionRevocationWatcher />
      <HoverHintLayer />
      {children}
    </SessionProvider>
  );
}
