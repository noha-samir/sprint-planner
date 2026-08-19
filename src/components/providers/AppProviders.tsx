"use client";

import { useEffect } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import { HoverHintLayer } from "@/components/common/HoverHintLayer";
import { applyColorScheme, resolveColorScheme } from "@/lib/ui/colorScheme";
import { signOutAndClearJiraToken } from "@/lib/authz/signOutClient";

function SessionRevocationWatcher() {
  const { data: session } = useSession();

  useEffect(() => {
    if (session?.error !== "SessionRevoked") return;
    void signOutAndClearJiraToken("/sign-in");
  }, [session?.error]);

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
