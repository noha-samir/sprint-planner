"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Legacy Jira settings URL — connection/fields now live on People & Jira → Jira fields tab.
 */
export default function JiraSettingsPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/resources#jira-connection");
  }, [router]);

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 items-center justify-center">
      <p className="text-sm text-slate-500">Redirecting to People & Jira…</p>
    </main>
  );
}
