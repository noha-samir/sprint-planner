"use client";

/**
 * In-app Help content: roles, tabs, workflows (mirrors docs/USER_GUIDE.md + README section 3).
 * Diagrams are static SVG / structured layouts (no Mermaid dependency).
 */
export function HelpDocs() {
  return (
    <div className="mx-auto w-full max-w-4xl space-y-10 pb-10 text-slate-800">
      <header className="space-y-2">
        <h1 className="section-title">Help</h1>
        <p className="text-sm text-slate-600">
          How Sprint Planner works for your role. Full write-ups also live in the repo under{" "}
          <code className="rounded bg-slate-100 px-1 text-[12px]">docs/</code> and the project README.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">Roles & permissions</h2>
        <div className="overflow-x-auto rounded-2xl border border-slate-200">
          <table className="w-full min-w-[36rem] text-left text-[13px]">
            <thead className="bg-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Plan board</th>
                <th className="px-3 py-2">Sprint lifecycle*</th>
                <th className="px-3 py-2">People / Settings / Users</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              <tr>
                <td className="px-3 py-2 font-semibold">Super Admin</td>
                <td className="px-3 py-2">Edit all squads</td>
                <td className="px-3 py-2">Yes</td>
                <td className="px-3 py-2">See + edit</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-semibold">EM</td>
                <td className="px-3 py-2">Edit own squad</td>
                <td className="px-3 py-2">Yes</td>
                <td className="px-3 py-2">See only</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-semibold">Editor</td>
                <td className="px-3 py-2">Edit own squad</td>
                <td className="px-3 py-2">No</td>
                <td className="px-3 py-2">See only</td>
              </tr>
              <tr>
                <td className="px-3 py-2 font-semibold">Reviewer</td>
                <td className="px-3 py-2">View only</td>
                <td className="px-3 py-2">No</td>
                <td className="px-3 py-2">See only</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[12px] text-slate-500">
          *Lifecycle = move next/current sprint, set buffer hours, Mark Progress Now, New Sprint.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">Schedule flow</h2>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[12px] font-semibold">
          {[
            "FE / BE / Mobile",
            "Integration",
            "QC",
            "Buffer",
            "UAT",
            "Production",
          ].map((label, index, arr) => (
            <div key={label} className="flex items-center gap-2">
              <span className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-slate-800 shadow-sm">
                {label}
              </span>
              {index < arr.length - 1 ? <span className="text-slate-400" aria-hidden>→</span> : null}
            </div>
          ))}
        </div>
        <p className="text-sm text-slate-600">
          Estimated dates freeze on first valid calculation. UAT/Production track after Mark Progress Now
          (EM / Super Admin).
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">Tabs</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[
            { name: "Dashboard", desc: "Stories, hours, assignees, status, dates, Jira sync" },
            { name: "Timeline", desc: "Phase view of the schedule" },
            { name: "History", desc: "Archived sprint snapshots" },
            { name: "People & Jira", desc: "Roster + Jira fields (edit: super admin)" },
            { name: "Sprint Settings", desc: "Window, hours, holidays (edit: super admin)" },
            { name: "User Management", desc: "Squads & roles (edit: super admin)" },
          ].map((item) => (
            <li
              key={item.name}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
            >
              <div className="text-sm font-bold text-slate-900">{item.name}</div>
              <div className="mt-0.5 text-[12px] text-slate-600">{item.desc}</div>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">Planning loop</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700">
          <li>Confirm sprint window and roster (super admin when changes are needed).</li>
          <li>Add or import stories; set hours and assignees.</li>
          <li>Check Timeline for overload.</li>
          <li>EM / Super Admin: Mark Progress Now when locking Cur dates.</li>
          <li>Push / pull Jira for linked stories as needed.</li>
        </ol>
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] text-blue-950">
          <strong>Editors:</strong> you can plan the board on your squad, but you cannot run New Sprint,
          Mark Progress, buffer edits, or move stories between current/next sprint.
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-bold text-slate-900">Data path</h2>
        <pre className="overflow-x-auto rounded-2xl border border-slate-200 bg-slate-900 p-4 text-[11px] leading-relaxed text-slate-100">
{`Sign-in (Jira email + token)
        ↓
Hydrate board  GET /api/planner-state
        ↓
Edit in Dashboard (Zustand)
        ↓
Save           POST /api/planner-state  →  Neon Postgres`}
        </pre>
      </section>
    </div>
  );
}
