import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import {
  canReadFromSession,
  canWriteFromSession,
  forbidden,
  getSessionAccess,
  resolveRequestedSquadId,
} from "@/lib/access/server";
import { keepNewestPerSquad } from "@/lib/history/retention";
import type { Config, Resource, Task } from "@/lib/scheduler/types";
import type { SprintHistoryEntry, SprintHistoryListItem } from "@/lib/history/types";
import { prisma } from "@/lib/db/prisma";
import { sanitizeSquadKey } from "@/lib/authz/permissions";

const asJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const normalizePayload = (
  payload: Partial<{
    tasks: Task[];
    resources: Resource[];
    config: Config;
  }>,
) => ({
  tasks: Array.isArray(payload.tasks) ? payload.tasks : [],
  resources: Array.isArray(payload.resources) ? payload.resources : [],
  config: payload.config,
});

const normalizeSquadId = (squadId: string | undefined): string => {
  const safe = sanitizeSquadKey(squadId ?? "") ?? "";
  if (!safe || safe === "default" || safe === "ventures") {
    return "ventures";
  }
  return safe;
};

const toListItem = (row: {
  id: string;
  squadId: string;
  archivedAt: Date;
  sprintStartDate: string;
  planningSunday: string;
  totalTasks: number;
  carryOverTasks: number;
  totalResources: number;
}): SprintHistoryListItem => ({
  id: row.id,
  archivedAt: row.archivedAt.toISOString(),
  squadId: row.squadId,
  sprintStartDate: row.sprintStartDate,
  planningSunday: row.planningSunday,
  summary: {
    totalTasks: row.totalTasks,
    carryOverTasks: row.carryOverTasks,
    totalResources: row.totalResources,
  },
});

const toEntry = (row: {
  id: string;
  squadId: string;
  archivedAt: Date;
  sprintStartDate: string;
  planningSunday: string;
  tasksSnapshot: unknown;
  resourcesSnapshot: unknown;
  configSnapshot: unknown;
  totalTasks: number;
  carryOverTasks: number;
  totalResources: number;
}): SprintHistoryEntry => ({
  ...toListItem(row),
  tasks: Array.isArray(row.tasksSnapshot) ? (row.tasksSnapshot as Task[]) : [],
  resources: Array.isArray(row.resourcesSnapshot) ? (row.resourcesSnapshot as Resource[]) : [],
  config: row.configSnapshot as Config,
});

export async function GET(request: Request) {
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access) return forbidden();
  const url = new URL(request.url);
  const requestedSquadId = await resolveRequestedSquadId(
    access,
    url.searchParams.get("squadId"),
  );
  if (!requestedSquadId || !canReadFromSession(access, requestedSquadId)) {
    return forbidden();
  }

  const entryId = url.searchParams.get("id")?.trim() ?? "";
  if (entryId) {
    const row = await prisma.sprintHistory.findFirst({
      where: { id: entryId, squadId: normalizeSquadId(requestedSquadId) },
    });
    if (!row) {
      return NextResponse.json({ error: "History entry not found." }, { status: 404 });
    }
    return NextResponse.json({ item: toEntry(row) });
  }

  const rows = await prisma.sprintHistory.findMany({
    where: { squadId: normalizeSquadId(requestedSquadId) },
    orderBy: { archivedAt: "desc" },
    select: {
      id: true,
      squadId: true,
      archivedAt: true,
      sprintStartDate: true,
      planningSunday: true,
      totalTasks: true,
      carryOverTasks: true,
      totalResources: true,
    },
  });
  return NextResponse.json({ items: rows.map(toListItem) });
}

export async function POST(request: Request) {
  const session = await auth();
  const access = getSessionAccess(session);
  if (!access) return forbidden();
  const requestedSquadId = await resolveRequestedSquadId(
    access,
    request.headers.get("x-squad-id") ?? new URL(request.url).searchParams.get("squadId"),
  );
  if (!requestedSquadId) {
    return NextResponse.json({ error: "Squad is required." }, { status: 400 });
  }
  if (!canWriteFromSession(access, requestedSquadId)) return forbidden();

  let parsedBody;
  try {
    const { parseHistoryWriteBody } = await import("@/lib/validation/apiBodies");
    parsedBody = parseHistoryWriteBody(await request.json());
  } catch (error) {
    const { ZodError } = await import("zod");
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: "Invalid history payload.", details: error.flatten() },
        { status: 400 },
      );
    }
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { tasks, resources, config } = normalizePayload({
    tasks: parsedBody.tasks as unknown as Task[] | undefined,
    resources: parsedBody.resources as unknown as Resource[] | undefined,
    config: parsedBody.config as unknown as Config,
  });
  if (!config) {
    return NextResponse.json({ error: "Invalid payload: config is required." }, { status: 400 });
  }

  const squadId = normalizeSquadId(requestedSquadId);
  const squadExists = await prisma.squad.findUnique({ where: { id: squadId }, select: { id: true } });
  if (!squadExists) {
    return NextResponse.json({ error: `Unknown squad "${squadId}".` }, { status: 400 });
  }

  const entry: SprintHistoryEntry = {
    id: crypto.randomUUID(),
    archivedAt: new Date().toISOString(),
    squadId,
    sprintStartDate: config.sprintStartDate,
    planningSunday: config.planningSunday,
    tasks,
    resources,
    config,
    summary: {
      totalTasks: tasks.length,
      carryOverTasks: tasks.filter((task) => !!task.carryToNextSprint).length,
      totalResources: resources.length,
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.sprintHistory.create({
      data: {
        id: entry.id,
        squadId,
        archivedAt: new Date(entry.archivedAt),
        sprintStartDate: entry.sprintStartDate,
        planningSunday: entry.planningSunday,
        tasksSnapshot: asJson(tasks),
        resourcesSnapshot: asJson(resources),
        configSnapshot: asJson(config),
        totalTasks: entry.summary.totalTasks,
        carryOverTasks: entry.summary.carryOverTasks,
        totalResources: entry.summary.totalResources,
      },
    });

    const retentionMode = request.headers.get("x-retention-mode");
    if (retentionMode === "new_sprint") {
      const all = await tx.sprintHistory.findMany({
        where: { squadId },
        orderBy: { archivedAt: "desc" },
      });
      const mapped = all.map(toEntry);
      const kept = keepNewestPerSquad(mapped, squadId, 6);
      const keepIds = new Set(kept.map((item) => item.id));
      const removeIds = all.map((row) => row.id).filter((id) => !keepIds.has(id));
      if (removeIds.length > 0) {
        await tx.sprintHistory.deleteMany({ where: { id: { in: removeIds } } });
      }
    }
  });

  return NextResponse.json({ ok: true, item: entry });
}
