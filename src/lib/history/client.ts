import type { Config, Resource, Task } from "@/lib/scheduler/types";

interface ArchiveSprintPayload {
  tasks: Task[];
  resources: Resource[];
  config: Config;
  squadId?: string | null;
  retentionMode?: "new_sprint" | "close_squad";
}

export const archiveSprintSnapshot = async (payload: ArchiveSprintPayload): Promise<void> => {
  const { squadId, retentionMode = "close_squad", ...body } = payload;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (squadId) {
    headers["x-squad-id"] = squadId;
  }
  headers["x-retention-mode"] = retentionMode;
  await fetch("/api/history", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
};
