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
  const response = await fetch("/api/history", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { error?: string };
      detail = data.error?.trim() ? `: ${data.error.trim()}` : "";
    } catch {
      /* ignore non-JSON error bodies */
    }
    throw new Error(`Failed to archive sprint to History (HTTP ${response.status})${detail}`);
  }
};
