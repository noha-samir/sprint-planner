"use client";

import { useEffect } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import { HoverHintLayer } from "@/components/common/HoverHintLayer";
import { applyColorScheme, resolveColorScheme } from "@/lib/ui/colorScheme";
import { signOutAndClearJiraToken } from "@/lib/authz/signOutClient";

function SessionRevocationWatcher() {
  const { data: session, status } = useSession();

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
    <SessionProvider refetchInterval={30} refetchOnWindowFocus>
      <ColorSchemeBoot />
      <SessionRevocationWatcher />
      <HoverHintLayer />
      {children}
    </SessionProvider>
  );
}
