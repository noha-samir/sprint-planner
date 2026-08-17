"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { signOutAndClearJiraToken } from "@/lib/authz/signOutClient";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import type { AccessRegistry, Squad, UserAccount } from "@/lib/access/registry";
import { getCapabilities, plannerAccessContext } from "@/lib/access/control";
import { userMatchesSquadFilter, type UserSquadFilter } from "@/lib/access/userManagementScope";
import { getSquadIcon } from "@/lib/ui/squadIcon";
import { usePlannerStore } from "@/store/usePlannerStore";

const emptyRegistry: AccessRegistry = { squads: [], users: [], squadAccounts: [] };
const roleOptions: Array<{ value: UserAccount["role"]; label: string }> = [
  { value: "em", label: "Engineering Manager" },
  { value: "editor", label: "Editor" },
  { value: "reviewer", label: "Reviewer" },
  { value: "super_admin", label: "Super Admin" },
];

type DraftSquad = Squad;

type UserManagementPayload = AccessRegistry;

type DraftUser = UserAccount & {
  /** Stable client id for the row (not persisted). */
  draftId: string;
  /** Email as last saved on server; null = never saved. */
  savedEmail: string | null;
};

const toDraftSquad = (squad: Squad): DraftSquad => ({ ...squad });

const toAccessSquad = (squad: DraftSquad): Squad => ({
  id: squad.id,
  name: squad.name,
  emEmail: squad.emEmail,
  ...(squad.hidden !== undefined ? { hidden: squad.hidden } : {}),
});

const cloneRegistry = (value: AccessRegistry): AccessRegistry =>
  JSON.parse(JSON.stringify(value)) as AccessRegistry;

const newDraftId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const toDraftUsers = (users: UserAccount[], previous: DraftUser[] = []): DraftUser[] => {
  const previousByEmail = new Map(
    previous
      .filter((user) => user.savedEmail || user.email.trim())
      .map((user) => [user.savedEmail ?? user.email.trim().toLowerCase(), user.draftId]),
  );
  return users.map((user) => {
    const email = user.email.trim().toLowerCase();
    return {
      ...user,
      draftId: previousByEmail.get(email) ?? newDraftId(),
      savedEmail: email || null,
    };
  });
};

const nextSquadId = (squads: DraftSquad[]): string => {
  const used = new Set(
    squads
      .map((item) => {
        const match = /^squad-(\d+)$/.exec(item.id.trim().toLowerCase());
        return match ? Number(match[1]) : null;
      })
      .filter((value): value is number => value != null),
  );
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return `squad-${candidate}`;
};

const squadEqual = (a: DraftSquad, b: DraftSquad) =>
  a.name.trim() === b.name.trim() &&
  a.emEmail.trim().toLowerCase() === b.emEmail.trim().toLowerCase() &&
  Boolean(a.hidden) === Boolean(b.hidden);

const userEqual = (a: Pick<UserAccount, "email" | "role" | "squadId">, b: Pick<UserAccount, "email" | "role" | "squadId">) =>
  a.email.trim().toLowerCase() === b.email.trim().toLowerCase() &&
  a.role === b.role &&
  (a.squadId ?? "") === (b.squadId ?? "");

export default function UserManagementPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const activeSquadId = usePlannerStore((state) => state.activeSquadId);
  const caps =
    session?.user?.role != null ? getCapabilities(plannerAccessContext(session, activeSquadId)) : null;
  const canManageUsers = Boolean(caps?.canManageUsers);
  const canViewUserManagement = Boolean(caps?.canViewUserManagement);
  const [savedRegistry, setSavedRegistry] = useState<AccessRegistry>(emptyRegistry);
  const [savedSquads, setSavedSquads] = useState<DraftSquad[]>([]);
  const [squads, setSquads] = useState<DraftSquad[]>([]);
  const [users, setUsers] = useState<DraftUser[]>([]);
  const [userSquadFilter, setUserSquadFilter] = useState<UserSquadFilter>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ tone: "success" | "error" | "info"; text: string } | null>(
    null,
  );
  const usersRef = useRef<DraftUser[]>([]);

  useEffect(() => {
    if (status === "loading") return;
    if (!canViewUserManagement) {
      router.replace("/");
    }
  }, [canViewUserManagement, router, status]);

  useEffect(() => {
    usersRef.current = users;
  }, [users]);

  const notifySquadRegistryUpdated = () => {
    window.dispatchEvent(new CustomEvent("squad-registry-updated"));
  };

  const applyLoadedRegistry = useCallback((payload: UserManagementPayload) => {
    const next: AccessRegistry = {
      squads: payload.squads,
      users: payload.users,
      squadAccounts: payload.squadAccounts,
    };
    const cloned = cloneRegistry(next);
    const nextDraftSquads = cloned.squads.map((squad) => toDraftSquad(squad));

    setSavedRegistry(cloned);
    setSavedSquads(nextDraftSquads);
    setSquads(nextDraftSquads);

    setUsers((previous) => {
      const drafted = toDraftUsers(cloned.users, previous);
      const previousComparable = previous.map((user) => ({
        email: user.email,
        role: user.role,
        squadId: user.squadId,
        savedEmail: user.savedEmail,
      }));
      const nextComparable = drafted.map((user) => ({
        email: user.email,
        role: user.role,
        squadId: user.squadId,
        savedEmail: user.savedEmail,
      }));
      if (JSON.stringify(previousComparable) === JSON.stringify(nextComparable)) {
        return previous;
      }
      return drafted;
    });
  }, []);

  const persistRegistry = async (nextRegistry: AccessRegistry): Promise<boolean> => {
    const response = await fetch("/api/user-management", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextRegistry),
    });
    if (!response.ok) {
      const error = (await response.json().catch(() => null)) as { error?: string } | null;
      setStatusMessage({ tone: "error", text: error?.error ?? "Save failed. Please try again." });
      return false;
    }
    await response.json().catch(() => null);
    setSavedRegistry(cloneRegistry(nextRegistry));
    setSavedSquads(nextRegistry.squads.map((squad) => toDraftSquad(squad)));
    notifySquadRegistryUpdated();

    const me = session?.user?.email?.trim().toLowerCase() ?? "";
    const myNext = nextRegistry.users.find((user) => user.email === me);
    const myPrev = savedRegistry.users.find((user) => user.email === me);
    const selfAccessChanged =
      Boolean(me) &&
      Boolean(myPrev) &&
      (!myNext ||
        myPrev!.role !== myNext.role ||
        (myPrev!.squadId ?? "") !== (myNext.squadId ?? ""));
    if (selfAccessChanged) {
      await signOutAndClearJiraToken("/sign-in");
    }
    return true;
  };

  const load = async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "initial") {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    try {
      const response = await fetch("/api/user-management", { cache: "no-store" });
      if (response.ok) {
        applyLoadedRegistry((await response.json()) as UserManagementPayload);
        notifySquadRegistryUpdated();
      } else if (mode === "initial") {
        setStatusMessage({ tone: "error", text: "Could not load user management data." });
      }
    } finally {
      if (mode === "initial") {
        setLoading(false);
      } else {
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    if (!canViewUserManagement) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial remote load on mount
    void load("initial");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only after access confirmed
  }, [canViewUserManagement]);

  useEffect(() => {
    if (!statusMessage || statusMessage.tone !== "success") return;
    const timer = window.setTimeout(() => setStatusMessage(null), 3500);
    return () => window.clearTimeout(timer);
  }, [statusMessage]);

  const savedSquadById = useMemo(() => {
    const map = new Map<string, DraftSquad>();
    savedSquads.forEach((squad) => map.set(squad.id, squad));
    return map;
  }, [savedSquads]);

  const isSquadDirty = (squad: DraftSquad) => {
    const saved = savedSquadById.get(squad.id);
    if (!saved) return true;
    return !squadEqual(squad, saved);
  };

  const isUserDirty = (user: DraftUser) => {
    if (!user.savedEmail) return true;
    const saved = savedRegistry.users.find((item) => item.email === user.savedEmail);
    if (!saved) return true;
    return !userEqual(user, saved);
  };

  const visibleSquadIds = useMemo(
    () => squads.filter((item) => !item.hidden).map((item) => item.id),
    [squads],
  );

  const squadLabelById = useMemo(() => {
    const map = new Map<string, string>();
    squads.forEach((squad) => map.set(squad.id, squad.name.trim() || squad.id));
    return map;
  }, [squads]);

  const displayedUsers = useMemo(() => {
    return users.filter((user) => {
      if (!canManageUsers && caps && user.savedEmail) {
        const inOwnSquads = squads.some(
          (squad) =>
            caps.canAccessSquad(squad.id) && userMatchesSquadFilter(user, squad.id, savedRegistry),
        );
        if (!inOwnSquads) {
          return false;
        }
      }
      return userMatchesSquadFilter(user, userSquadFilter, savedRegistry);
    });
  }, [users, canManageUsers, caps, squads, savedRegistry, userSquadFilter]);

  const showUserSquadFilter = canManageUsers || visibleSquadIds.length > 1;

  const updateSquad = (squadId: string, patch: Partial<DraftSquad>) => {
    setSquads((current) => current.map((item) => (item.id === squadId ? { ...item, ...patch } : item)));
    setStatusMessage(null);
  };

  const updateUser = (draftId: string, patch: Partial<UserAccount>) => {
    setUsers((current) =>
      current.map((item) => (item.draftId === draftId ? { ...item, ...patch } : item)),
    );
    setStatusMessage(null);
  };

  useEffect(() => {
    if (userSquadFilter === "all") return;
    if (!squads.some((squad) => squad.id === userSquadFilter)) {
      setUserSquadFilter("all");
    }
  }, [squads, userSquadFilter]);

  const saveSquad = async (squadId: string) => {
    const squad = squads.find((item) => item.id === squadId);
    if (!squad) return;
    if (!squad.name.trim() || !squad.emEmail.trim()) {
      setStatusMessage({ tone: "error", text: "Squad name and EM email are required before saving." });
      return;
    }
    if (!isSquadDirty(squad)) return;
    const wasHidden = Boolean(savedSquadById.get(squadId)?.hidden);
    const willHide = Boolean(squad.hidden);
    if (!wasHidden && willHide) {
      const otherVisible = savedRegistry.squads.filter(
        (item) => item.id !== squadId && !item.hidden,
      ).length;
      if (otherVisible === 0) {
        setStatusMessage({
          tone: "error",
          text: "At least one active squad must remain. Uncheck Hidden or add another squad first.",
        });
        return;
      }
    }
    const confirmText =
      !wasHidden && willHide
        ? `Hide squad "${squad.name.trim()}"?\n\nIt will move under Hidden. Uncheck Hidden and Save to restore.`
        : wasHidden && !willHide
          ? `Restore squad "${squad.name.trim()}" to Active?`
          : `Save squad "${squad.name.trim()}"?\n\nOnly this squad will be written.`;
    const confirmed = window.confirm(confirmText);
    if (!confirmed) return;

    setBusyKey(`squad-save-${squadId}`);
    setStatusMessage(null);
    try {
      const accessSquad = toAccessSquad(squad);
      const exists = savedRegistry.squads.some((item) => item.id === squadId);
      const nextSaved: AccessRegistry = {
        ...savedRegistry,
        squads: exists
          ? savedRegistry.squads.map((item) => (item.id === squadId ? accessSquad : item))
          : [...savedRegistry.squads, accessSquad],
      };
      const ok = await persistRegistry(nextSaved);
      if (ok) {
        setSquads((current) =>
          current.map((item) => (item.id === squadId ? { ...squad } : item)),
        );
        setSavedSquads((current) => {
          const existsSaved = current.some((item) => item.id === squadId);
          return existsSaved
            ? current.map((item) => (item.id === squadId ? { ...squad } : item))
            : [...current, { ...squad }];
        });
        const successText =
          !wasHidden && willHide
            ? `Squad "${squad.name.trim()}" hidden.`
            : wasHidden && !willHide
              ? `Squad "${squad.name.trim()}" restored.`
              : `Squad "${squad.name.trim()}" saved.`;
        setStatusMessage({ tone: "success", text: successText });
      }
    } finally {
      setBusyKey(null);
    }
  };

  const discardSquad = (squadId: string) => {
    const saved = savedSquadById.get(squadId);
    if (!saved) {
      const confirmed = window.confirm("Discard this new squad? It was never saved.");
      if (!confirmed) return;
      setSquads((current) => current.filter((item) => item.id !== squadId));
      setStatusMessage({ tone: "info", text: "New squad discarded." });
      return;
    }
    const confirmed = window.confirm(`Discard edits to "${saved.name.trim() || squadId}"?`);
    if (!confirmed) return;
    setSquads((current) => current.map((item) => (item.id === squadId ? { ...saved } : item)));
    setStatusMessage({ tone: "info", text: "Squad edits discarded." });
  };

  const deleteSquad = async (squadId: string) => {
    const squad = squads.find((item) => item.id === squadId);
    const saved = savedSquadById.get(squadId);

    // Never persisted — remove locally only.
    if (!saved) {
      const confirmed = window.confirm(
        `Remove unsaved squad "${squad?.name.trim() || squadId}"?`,
      );
      if (!confirmed) return;
      setSquads((current) => current.filter((item) => item.id !== squadId));
      setStatusMessage({ tone: "success", text: "Unsaved squad removed." });
      return;
    }

    const confirmed = window.confirm(
      `Permanently delete squad "${saved.name.trim() || squadId}"?\n\nThis cannot be undone. Users on this squad will move to another squad. Use Hidden + Save to soft-hide instead.`,
    );
    if (!confirmed) return;

    setBusyKey(`squad-delete-${squadId}`);
    setStatusMessage(null);
    try {
      const response = await fetch(`/api/user-management?squadId=${encodeURIComponent(squadId)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { error?: string } | null;
        setStatusMessage({ tone: "error", text: error?.error ?? "Failed to delete squad." });
        return;
      }
      notifySquadRegistryUpdated();

      const fallbackSquadId =
        savedRegistry.squads.find((item) => item.id !== squadId && !item.hidden)?.id ??
        savedRegistry.squads.find((item) => item.id !== squadId)?.id ??
        "ventures";
      setSavedRegistry((current) => ({
        ...current,
        squads: current.squads.filter((item) => item.id !== squadId),
        users: current.users.map((item) =>
          item.squadId === squadId ? { ...item, squadId: fallbackSquadId } : item,
        ),
      }));
      setSavedSquads((current) => current.filter((item) => item.id !== squadId));
      setSquads((current) => current.filter((item) => item.id !== squadId));
      setUsers((current) =>
        current.map((item) =>
          item.squadId === squadId ? { ...item, squadId: fallbackSquadId } : item,
        ),
      );
      setStatusMessage({
        tone: "success",
        text: `Squad "${saved.name.trim()}" deleted permanently.`,
      });
    } finally {
      setBusyKey(null);
    }
  };

  const saveUser = async (draftId: string) => {
    const user = users.find((item) => item.draftId === draftId);
    if (!user) return;
    if (!user.email.trim() || !user.role || !user.squadId?.trim()) {
      setStatusMessage({
        tone: "error",
        text: "User email, role, and squad are required before saving.",
      });
      return;
    }
    if (!isUserDirty(user)) return;

    const email = user.email.trim().toLowerCase();
    const duplicate = savedRegistry.users.some(
      (item) => item.email === email && item.email !== user.savedEmail,
    );
    if (duplicate) {
      setStatusMessage({ tone: "error", text: `Another saved user already uses ${email}.` });
      return;
    }

    const confirmed = window.confirm(
      `Save user "${email}"?\n\nOnly this user will be written. Changing role or squad signs them out immediately.`,
    );
    if (!confirmed) return;

    setBusyKey(`user-save-${draftId}`);
    setStatusMessage(null);
    try {
      const payload: UserAccount = {
        email,
        role: user.role,
        squadId: user.squadId,
      };
      let nextUsers: UserAccount[];
      if (user.savedEmail) {
        nextUsers = savedRegistry.users.map((item) =>
          item.email === user.savedEmail ? payload : item,
        );
      } else {
        nextUsers = [...savedRegistry.users, payload];
      }
      const nextSaved: AccessRegistry = { ...savedRegistry, users: nextUsers };
      const ok = await persistRegistry(nextSaved);
      if (ok) {
        setUsers((current) =>
          current.map((item) =>
            item.draftId === draftId
              ? { ...payload, draftId: item.draftId, savedEmail: payload.email }
              : item,
          ),
        );
        setStatusMessage({ tone: "success", text: `User "${email}" saved.` });
      }
    } finally {
      setBusyKey(null);
    }
  };

  const discardUser = (draftId: string) => {
    const user = users.find((item) => item.draftId === draftId);
    if (!user) return;

    if (!user.savedEmail) {
      const confirmed = window.confirm("Discard this new user? It was never saved.");
      if (!confirmed) return;
      setUsers((current) => current.filter((item) => item.draftId !== draftId));
      setStatusMessage({ tone: "info", text: "New user discarded." });
      return;
    }

    const saved = savedRegistry.users.find((item) => item.email === user.savedEmail);
    if (!saved) return;
    const confirmed = window.confirm(`Discard edits to "${saved.email}"?`);
    if (!confirmed) return;
    setUsers((current) =>
      current.map((item) =>
        item.draftId === draftId
          ? { ...saved, draftId: item.draftId, savedEmail: saved.email }
          : item,
      ),
    );
    setStatusMessage({ tone: "info", text: "User edits discarded." });
  };

  const deleteUser = async (draftId: string) => {
    const user = users.find((item) => item.draftId === draftId);
    if (!user) return;

    if (!user.savedEmail) {
      const confirmed = window.confirm(
        `Remove unsaved user "${user.email.trim() || "new user"}"?`,
      );
      if (!confirmed) return;
      setUsers((current) => current.filter((item) => item.draftId !== draftId));
      setStatusMessage({ tone: "success", text: "Unsaved user removed." });
      return;
    }

    const confirmed = window.confirm(
      `Delete user "${user.savedEmail}"?\n\nThis applies immediately.`,
    );
    if (!confirmed) return;

    setBusyKey(`user-delete-${draftId}`);
    setStatusMessage(null);
    try {
      const nextSaved: AccessRegistry = {
        ...savedRegistry,
        users: savedRegistry.users.filter((item) => item.email !== user.savedEmail),
      };
      const ok = await persistRegistry(nextSaved);
      if (ok) {
        setUsers((current) => current.filter((item) => item.draftId !== draftId));
        setStatusMessage({ tone: "success", text: `User "${user.savedEmail}" deleted.` });
      }
    } finally {
      setBusyKey(null);
    }
  };

  const rowActions = (
    dirty: boolean,
    busy: boolean,
    onSave: () => void,
    onDiscard: () => void,
    onDelete: () => void,
  ) =>
    canManageUsers ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        className="btn-secondary px-3 py-1.5 text-xs"
        onClick={onDiscard}
        disabled={!dirty || busy}
      >
        Discard
      </button>
      <button
        type="button"
        className="btn-danger px-3 py-1.5 text-xs"
        onClick={onDelete}
        disabled={busy}
      >
        Delete
      </button>
      <button
        type="button"
        className="btn-primary px-3 py-1.5 text-xs"
        onClick={onSave}
        disabled={!dirty || busy}
      >
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
    ) : null;

  if (status === "loading" || !canViewUserManagement) {
    return (
      <main className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 items-center justify-center">
        <p className="text-sm text-slate-500">Loading…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-0 w-full max-w-[1400px] flex-1 flex-col gap-3 overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="section-title">User Management</h1>
          <p className="mt-1 text-sm text-slate-500">
            {canManageUsers
              ? "Save, discard, or delete each squad and user independently."
              : "View only — only super admins can change users and squads."}
          </p>
        </div>
        <button
          type="button"
          className="btn-secondary inline-flex min-w-[7.5rem] items-center justify-center gap-2"
          onClick={() => void load("refresh")}
          disabled={loading || refreshing || busyKey != null}
          aria-busy={refreshing}
        >
          {refreshing ? (
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent"
              aria-hidden
            />
          ) : null}
          {refreshing ? "Loading…" : "Refresh"}
        </button>
      </header>

      <div className="flex h-10 shrink-0 items-center">
        {statusMessage ? (
          <div
            className={`w-full rounded-xl border px-3 py-2 text-sm font-medium ${
              statusMessage.tone === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                : statusMessage.tone === "error"
                  ? "border-rose-300 bg-rose-50 text-rose-900"
                  : "border-slate-300 bg-slate-50 text-slate-800"
            }`}
            role="status"
          >
            {statusMessage.text}
          </div>
        ) : null}
      </div>

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-3 overflow-hidden transition-opacity lg:grid-cols-2 lg:grid-rows-1 ${
          refreshing ? "pointer-events-none opacity-60" : ""
        }`}
        aria-busy={refreshing}
      >
        {loading ? (
          <div className="page-card flex min-h-0 items-center justify-center lg:col-span-2">
            <p className="text-sm text-slate-500">Loading…</p>
          </div>
        ) : null}

        {!loading ? (
          <>
        <section className="page-card flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">Squads</h2>
            </div>
            {canManageUsers ? (
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-xs"
              onClick={() => {
                setSquads((current) => [
                  ...current,
                  {
                    id: nextSquadId(current),
                    name: "",
                    emEmail: "",
                  },
                ]);
                setStatusMessage({ tone: "info", text: "New squad added — fill details, then Save on that card." });
              }}
            >
              Add squad
            </button>
            ) : null}
          </div>

          <div className="user-mgmt-squad-list">
            {squads.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                No squads yet. Add one to get started.
              </p>
            ) : null}
            {(() => {
              const activeSquads = squads.filter((squad) => !squad.hidden);
              const hiddenSquads = squads.filter((squad) => squad.hidden);
              const renderSquadCard = (squad: DraftSquad) => {
                const dirty = isSquadDirty(squad);
                const busy =
                  busyKey === `squad-save-${squad.id}` || busyKey === `squad-delete-${squad.id}`;
                return (
                  <article
                    key={squad.id}
                    className={`user-mgmt-squad-card ${
                      squad.hidden
                        ? "border-slate-400 bg-slate-100"
                        : dirty
                          ? "border-amber-400 ring-1 ring-amber-200"
                          : "border-slate-200"
                    }`}
                  >
                    <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <span
                            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-[11px]"
                            aria-hidden
                          >
                            {getSquadIcon(
                              squad.id,
                              visibleSquadIds.length ? visibleSquadIds : squads.map((s) => s.id),
                            )}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-semibold leading-tight text-slate-900">
                              {squad.name.trim() || "New squad"}
                            </p>
                            <p className="truncate text-[10px] leading-tight text-slate-500">{squad.id}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {squad.hidden ? (
                            <span className="rounded bg-slate-700 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-white">
                              Hidden
                            </span>
                          ) : null}
                          {dirty ? (
                            <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-900">
                              Not saved
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        <label className="min-w-0 space-y-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            Name
                          </span>
                          <input
                            className="field-input px-2 py-1 text-[13px]"
                            placeholder="Ventures"
                            value={squad.name}
                            disabled={!canManageUsers}
                            onChange={(event) => updateSquad(squad.id, { name: event.target.value })}
                          />
                        </label>
                        <label className="min-w-0 space-y-0.5">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                            EM email
                          </span>
                          <input
                            className="field-input px-2 py-1 text-[13px]"
                            placeholder="em@example.com"
                            value={squad.emEmail}
                            disabled={!canManageUsers}
                            onChange={(event) =>
                              updateSquad(squad.id, { emEmail: event.target.value.toLowerCase() })
                            }
                          />
                        </label>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-800">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5 rounded border-slate-300"
                            checked={Boolean(squad.hidden)}
                            disabled={!canManageUsers}
                            onChange={(event) => updateSquad(squad.id, { hidden: event.target.checked })}
                          />
                          <span className="font-medium">Hidden</span>
                        </label>
                        {rowActions(
                          dirty,
                          busy,
                          () => void saveSquad(squad.id),
                          () => discardSquad(squad.id),
                          () => void deleteSquad(squad.id),
                        )}
                      </div>
                    </div>
                  </article>
                );
              };

              return (
                <>
                  {activeSquads.length > 0 ? (
                    <div className="user-mgmt-squad-group">
                      <p className="user-mgmt-squad-group-title">Active ({activeSquads.length})</p>
                      {activeSquads.map(renderSquadCard)}
                    </div>
                  ) : null}
                  {hiddenSquads.length > 0 ? (
                    <div className="user-mgmt-squad-group">
                      <p className="user-mgmt-squad-group-title">
                        Hidden ({hiddenSquads.length})
                      </p>
                      {hiddenSquads.map(renderSquadCard)}
                    </div>
                  ) : null}
                </>
              );
            })()}
          </div>
        </section>

        <section className="page-card flex min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-2 border-b border-slate-200 bg-slate-50/80 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900">Users</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {showUserSquadFilter ? (
                <label className="flex min-w-[11rem] items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    Squad
                  </span>
                  <div className="squad-select-shell min-w-0 flex-1">
                    <select
                      className="squad-select py-1 text-[13px]"
                      value={userSquadFilter}
                      aria-label="Filter users by squad"
                      onChange={(event) =>
                        setUserSquadFilter((event.target.value || "all") as UserSquadFilter)
                      }
                    >
                      <option value="all">{canManageUsers ? "All squads" : "My squads"}</option>
                      {squads
                        .filter((squad) => !squad.hidden || squad.id === userSquadFilter)
                        .map((squad) => (
                          <option key={squad.id} value={squad.id}>
                            {squadLabelById.get(squad.id) ?? squad.id}
                            {squad.hidden ? " (hidden)" : ""}
                          </option>
                        ))}
                    </select>
                  </div>
                </label>
              ) : null}
              {canManageUsers ? (
            <button
              type="button"
              className="btn-secondary px-3 py-1.5 text-xs"
              onClick={() => {
                setUsers((current) => [
                  ...current,
                  {
                    draftId: newDraftId(),
                    savedEmail: null,
                    email: "",
                    role: "reviewer",
                    squadId: userSquadFilter === "all" ? null : userSquadFilter,
                  },
                ]);
                setStatusMessage({ tone: "info", text: "New user added — fill details, then Save on that card." });
              }}
            >
              Add user
            </button>
            ) : null}
            </div>
          </div>

          <div className="user-mgmt-user-list">
            {displayedUsers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                {users.length === 0
                  ? "No users yet. Add someone to assign a role and squad."
                  : "No users in this squad."}
              </p>
            ) : null}
            {displayedUsers.map((user) => {
              const dirty = isUserDirty(user);
              const busy = busyKey === `user-save-${user.draftId}` || busyKey === `user-delete-${user.draftId}`;
              return (
                <article
                  key={user.draftId}
                  className={`user-mgmt-user-card ${
                    dirty ? "border-amber-400 ring-1 ring-amber-200" : "border-slate-200"
                  }`}
                >
                  <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-[13px] font-semibold leading-tight text-slate-900">
                        {user.email.trim() || "New user"}
                      </p>
                      {dirty ? (
                        <span className="shrink-0 rounded bg-amber-100 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-amber-900">
                          Not saved
                        </span>
                      ) : null}
                    </div>

                    <label className="min-w-0 space-y-0.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        Email
                      </span>
                      <input
                        className="field-input px-2 py-1 text-[13px]"
                        placeholder="name@example.com"
                        value={user.email}
                        disabled={!canManageUsers}
                        onChange={(event) =>
                          updateUser(user.draftId, { email: event.target.value.toLowerCase() })
                        }
                      />
                    </label>

                    <div className="grid grid-cols-2 gap-1.5">
                      <label className="min-w-0 space-y-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Role
                        </span>
                        <select
                          className="field-input px-2 py-1 text-[13px]"
                          value={user.role}
                          disabled={!canManageUsers}
                          onChange={(event) =>
                            updateUser(user.draftId, {
                              role: event.target.value as UserAccount["role"],
                            })
                          }
                        >
                          {roleOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="min-w-0 space-y-0.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          Squad
                        </span>
                        <div className="squad-select-shell">
                          <select
                            className="squad-select py-1 text-[13px]"
                            value={user.squadId ?? ""}
                            disabled={!canManageUsers}
                            onChange={(event) =>
                              updateUser(user.draftId, { squadId: event.target.value || null })
                            }
                          >
                            <option value="">Select squad</option>
                            {squads
                              .filter((squad) => !squad.hidden || squad.id === user.squadId)
                              .map((squad) => (
                                <option key={squad.id} value={squad.id}>
                                  {getSquadIcon(
                                    squad.id,
                                    visibleSquadIds.length ? visibleSquadIds : squads.map((s) => s.id),
                                  )}{" "}
                                  {squadLabelById.get(squad.id) ?? squad.id}
                                  {squad.hidden ? " (hidden)" : ""}
                                </option>
                              ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end">
                      {rowActions(
                        dirty,
                        busy,
                        () => void saveUser(user.draftId),
                        () => discardUser(user.draftId),
                        () => void deleteUser(user.draftId),
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
