"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { ResourceTable } from "@/components/resources/ResourceTable";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { usePlannerStore } from "@/store/usePlannerStore";

export default function ResourcesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);
  const canAccessOpsTabs =
    !!session?.user?.role &&
    getCapabilities(plannerAccessContext(session, activeSquadId)).canAccessOpsTabs;

  useEffect(() => {
    if (status === "loading") return;
    if (!canAccessOpsTabs) {
      router.replace("/");
    }
  }, [canAccessOpsTabs, router, status]);

  if (status === "loading" || !canAccessOpsTabs) {
    return (
      <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-4 overflow-hidden">
      <div className="shrink-0">
        <h1 className="section-title">People & Jira</h1>
        <p className="mt-1 text-sm text-slate-500">
          Roster capacity and Jira connection fields. Only super admins can edit; others have view access.
        </p>
      </div>
      <section className="page-card flex min-h-0 flex-1 flex-col overflow-hidden p-4 md:p-5">
        <ResourceTable />
      </section>
    </main>
  );
}
