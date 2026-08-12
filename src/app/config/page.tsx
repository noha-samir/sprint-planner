"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ConfigForm } from "@/components/config/ConfigForm";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { usePlannerStore } from "@/store/usePlannerStore";

export default function ConfigPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);
  const caps =
    session?.user?.role != null ? getCapabilities(plannerAccessContext(session, activeSquadId)) : null;
  const canOpenConfig = Boolean(caps?.canAccessOpsTabs);

  useEffect(() => {
    if (status === "loading") return;
    if (!canOpenConfig) {
      router.replace("/");
    }
  }, [canOpenConfig, router, status]);

  if (status === "loading" || !canOpenConfig) {
    return (
      <main className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <h1 className="section-title">Sprint Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Sprint calendar, working hours, holidays, and capacity rules for the active squad.
          {!caps?.canEditOpsTabs ? " View only — only super admins can edit." : ""}
        </p>
      </div>
      <section className="page-card flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-5">
        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto">
          <ConfigForm />
        </div>
      </section>
    </main>
  );
}
