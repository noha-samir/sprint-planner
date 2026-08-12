"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { signOutAndClearJiraToken } from "@/lib/authz/signOutClient";
import { useSession } from "next-auth/react";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { getSquadIcon } from "@/lib/ui/squadIcon";
import { usePlannerSaveStore } from "@/store/usePlannerSaveStore";
import { usePlannerStore } from "@/store/usePlannerStore";

const tabs = [
  { href: "/", label: "Dashboard", icon: "📊" },
  { href: "/timeline", label: "Timeline", icon: "🕒" },
  { href: "/history", label: "History", icon: "🗂️" },
  { href: "/resources", label: "People & Jira", icon: "👥" },
  { href: "/config", label: "Sprint Settings", icon: "⚙️" },
  { href: "/docs", label: "Help", icon: "📖" },
];

function PlannerSaveStatusChip() {
  const status = usePlannerSaveStore((state) => state.status);
  const message = usePlannerSaveStore((state) => state.message);
  if (status === "idle" || !message) {
    return null;
  }
  return (
    <div
      className={`planner-save-chip planner-save-chip-${status}`}
      role="status"
      aria-live="polite"
      aria-busy={status === "saving"}
    >
      {status === "saving" ? (
        <span className="planner-save-chip-spinner" aria-hidden />
      ) : null}
      <span>{message}</span>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const theme = "ocean";
  const { data: session } = useSession();
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);
  const setActiveSquadId = usePlannerStore((state) => state.setActiveSquadId);
  const [squadIds, setSquadIds] = useState<string[]>([]);
  const [squadNamesById, setSquadNamesById] = useState<Record<string, string>>({});
  const email = session?.user?.email ?? "";
  const role = session?.user?.role;
  const capabilities = useMemo(
    () =>
      role && session?.user?.email ? getCapabilities(plannerAccessContext(session, activeSquadId)) : null,
    [role, session, activeSquadId],
  );
  const canManageUsers = capabilities?.canManageUsers ?? false;
  const canWrite = capabilities?.canWrite ?? false;
  const canAccessOpsTabs = capabilities?.canAccessOpsTabs ?? false;
  const canViewUserManagement = capabilities?.canViewUserManagement ?? false;
  const navTabs = useMemo(
    () => [
      ...tabs.filter((tab) => {
        if (tab.href === "/docs") return true;
        if (tab.href === "/config" || tab.href === "/resources") return canAccessOpsTabs;
        return true;
      }),
      ...(canViewUserManagement
        ? [{ href: "/user-management", label: "User Management", icon: "🔐" }]
        : []),
    ],
    [canViewUserManagement, canAccessOpsTabs],
  );
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  const contextualRoleLabel = useMemo(() => {
    if (role === "super_admin") return "Super Admin";
    const sid = activeSquadId ?? session?.user?.squadId ?? "";
    const sr = sid ? session?.user?.squadRoles?.[sid] : undefined;
    if (sr === "em") return "Engineering Manager";
    if (sr === "editor") return "Editor";
    if (sr === "reviewer") return "Viewer";
    if (role === "em") return "Engineering Manager";
    if (role === "editor") return "Editor";
    return "Viewer";
  }, [role, activeSquadId, session?.user?.squadId, session?.user?.squadRoles]);

  useEffect(() => {
    const applySquads = (squads: Array<{ id: string; name: string }>) => {
      const nextIds = squads.map((item) => item.id);
      const nextNames = Object.fromEntries(squads.map((item) => [item.id, item.name || item.id]));
      setSquadIds(nextIds);
      setSquadNamesById(nextNames);
    };
    const loadSquads = async () => {
      const response = await fetch("/api/squads", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { squads?: { id: string; name: string }[] };
      applySquads(data.squads ?? []);
    };
    const onRegistryUpdated = () => {
      void loadSquads();
    };
    void loadSquads();
    window.addEventListener("squad-registry-updated", onRegistryUpdated as EventListener);
    return () => {
      window.removeEventListener("squad-registry-updated", onRegistryUpdated as EventListener);
    };
  }, []);

  const showSquadSwitcher = role !== "editor" && (canManageUsers || squadIds.length > 1);
  const activeSquadLabel =
    (activeSquadId && squadNamesById[activeSquadId]) ||
    (session?.user?.squadId && squadNamesById[session.user.squadId]) ||
    activeSquadId ||
    session?.user?.squadId ||
    "Squad";

  if (pathname === "/sign-in") {
    return <div className="h-full min-h-0 overflow-auto">{children}</div>;
  }

  return (
    <div className={`app-shell theme-${theme}`}>
      <aside className="app-sidebar flex min-h-0 flex-col">
        <div className="mb-4 shrink-0">
          <h1 className="sidebar-title text-lg font-bold">Sprint Planner</h1>
          <p className="sidebar-subtitle mt-1 text-[13px]">Parallel FE/BE/QC scheduling</p>
        </div>
        <div className="mb-2 shrink-0">
          <PlannerSaveStatusChip />
        </div>
        <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden pb-2 pr-0.5">
          {[...navTabs].map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`block min-w-0 rounded-xl px-3 py-2 text-sm font-medium transition ${
                  active ? "sidebar-link-active shadow-sm" : "sidebar-link"
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.label}
              </Link>
            );
          })}
          {showSquadSwitcher ? (
            <div className="mt-3 rounded-xl border border-white/20 bg-white/10 p-2.5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-200">
                  Active Squad
                </label>
                <span className="rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-100">
                  {squadIds.length} squads
                </span>
              </div>
              <div className="squad-select-shell">
                <select
                  className="squad-select squad-select-dark w-full text-xs"
                  value={activeSquadId ?? squadIds[0] ?? ""}
                  onChange={(event) => setActiveSquadId(event.target.value || null)}
                  title="Switch between squad dashboards"
                >
                  {squadIds.map((id) => (
                    <option key={id} value={id}>
                      {getSquadIcon(id, squadIds)} {squadNamesById[id] || id}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : squadIds.length === 1 ? (
            <div className="mt-3 rounded-xl border border-white/15 bg-white/5 px-2.5 py-2 text-center text-[11px] font-medium text-slate-200">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-300">Squad</span>
              <p className="mt-1 text-xs text-white">
                {getSquadIcon(squadIds[0] ?? "", squadIds)} {squadNamesById[squadIds[0] ?? ""] ?? squadIds[0]}
              </p>
            </div>
          ) : null}
        </nav>
        <div className="sidebar-user-panel mt-auto shrink-0">
          <div className="flex w-full min-w-0 flex-col items-center gap-2.5 text-center">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-md ring-2 ring-white/25"
              style={{
                background: `linear-gradient(145deg, color-mix(in srgb, var(--primary) 92%, white), color-mix(in srgb, var(--primary) 55%, #1e3a8a))`,
              }}
              aria-hidden
            >
              {initial}
            </div>
            <p
              className="w-full min-w-0 break-words px-0.5 text-[12px] font-medium leading-snug"
              style={{ color: "var(--sidebar-text)", wordBreak: "break-word" }}
              title={email}
            >
              {email || "Signed in"}
            </p>
            <p
              className="w-full min-w-0 px-0.5 text-[11px] font-medium leading-snug text-slate-300/95"
              title={activeSquadLabel}
            >
              {activeSquadLabel}
            </p>
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                capabilities?.canWrite
                  ? "border-amber-400/50 bg-amber-400/15 text-amber-100"
                  : "border-white/20 bg-white/10 text-slate-200"
              }`}
            >
              {contextualRoleLabel}
            </span>
          </div>
          <button
            type="button"
            className="sidebar-signout"
            onClick={() => void signOutAndClearJiraToken("/sign-in")}
          >
            Sign out
          </button>
        </div>
      </aside>
      <div className="app-main">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
