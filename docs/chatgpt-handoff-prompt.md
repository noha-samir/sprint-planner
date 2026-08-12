# Sprint Planner Handoff Prompt

Use this prompt with ChatGPT when you want a fast, accurate review of the current project state and release behavior.

## Prompt

You are reviewing a Next.js sprint-planner app.

Please explain the current project behavior and release flow using the structure below:

1. Authentication and authorization
- Roles in use and what each can do.
- How squad isolation is applied for read/write APIs.
- How super admin differs from Engineering Manager and Reviewer.

2. Squad data model
- How planner state is stored per squad.
- How users are mapped to squads.
- What happens when a new squad has no saved state.

3. Sprint archive and retention
- How a sprint is archived to history.
- Retention policy per squad (latest 6) and when retention is applied.
- How close squad differs from start new sprint in archive behavior.

4. Release dates shown in task table
- Estimate Time (first snapshot).
- UAT Release Date (current recalculated plan).
- Production Release Date (next business day after UAT with Friday/Saturday, holidays, and planning Sunday rules).

5. Account switching behavior
- How local persistence and server hydration interact.
- How the app avoids showing another squad's stale board when switching accounts/squads.

6. User Management tab
- What each field means in Squads and Users sections.
- Role labels shown to users (Engineering Manager, Reviewer, Super Admin).
- How squad IDs can be reused from dropdown or custom input.

7. Validation checklist
- What API endpoints to test.
- What manual scenarios to test for role, squad isolation, release dates, and retention.

After the explanation, provide:
- A concise risk list (top 5 items).
- A release readiness verdict (Ready / Needs fixes) with reasons.
