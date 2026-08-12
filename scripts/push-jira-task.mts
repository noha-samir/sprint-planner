import { readFileSync } from "fs";

const loadEnvLocal = () => {
  try {
    const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
    for (const line of lines) {
      if (!line || line.startsWith("#")) {
        continue;
      }
      const index = line.indexOf("=");
      const key = line.slice(0, index);
      let value = line.slice(index + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  } catch {
    // ignore
  }
};

loadEnvLocal();

const squadId = process.argv[2] ?? "ventures";
const taskId = process.argv[3];

const { syncTaskToJira } = await import("../src/lib/integrations/jira/pushSubtasks");
const { readSquadJiraConfig } = await import("../src/lib/integrations/jira/configStore");
const { readSquadPlannerState, writeSquadPlannerState } = await import("../src/lib/authz/squadStorage");

const state = (await readSquadPlannerState(squadId)) as {
  tasks: import("../src/lib/scheduler/types").Task[];
};
const task = taskId
  ? state.tasks.find((row) => row.id === taskId)
  : state.tasks.find(
      (row) =>
        row.storyLink.includes("atlassian.net/browse/") &&
        row.feHours > 0 &&
        row.beHours > 0 &&
        row.feDevs.length > 0 &&
        row.beDevs.length > 0 &&
        row.qcs.length > 0,
    );

if (!task) {
  console.error("No suitable task found to push.");
  process.exit(1);
}

const config = await readSquadJiraConfig(squadId);
console.log(`Pushing task: ${task.storyName} (${task.id})`);
console.log(`Jira link: ${task.storyLink}`);

try {
  const result = await syncTaskToJira(task, config);
  task.jira = result.jira;
  await writeSquadPlannerState(squadId, state as unknown as Record<string, unknown>);
  console.log("\nSuccess!");
  console.log("Parent:", result.jira.parentIssueKey);
  console.log("Subtasks:", result.jira.subtasks.map((row) => `${row.key} [${row.role}]`).join(", "));
  if (result.warnings.length) {
    console.log("\nWarnings:");
    result.warnings.forEach((warning) => console.log(`- ${warning}`));
  }
} catch (error) {
  console.error("\nPush failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
