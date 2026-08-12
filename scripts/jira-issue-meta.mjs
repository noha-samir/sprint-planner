import { readFileSync } from "fs";

const issueKey = process.argv[2];
if (!issueKey) {
  console.error("Usage: node scripts/jira-issue-meta.mjs ISSUE-KEY");
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      const key = line.slice(0, index);
      let value = line.slice(index + 1).trim();
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      return [key, value];
    }),
);

const auth = Buffer.from(`${env.JIRA_USER_EMAIL}:${env.JIRA_USER_API_TOKEN}`).toString("base64");
const base = `${env.JIRA_SITE_URL}/rest/api/3`;

const issueRes = await fetch(`${base}/issue/${issueKey}?fields=subtasks,issuetype`, {
  headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
});
const issue = await issueRes.json();
console.log("Subtasks:", issue.fields?.subtasks ?? []);

const projectKey = env.JIRA_PROJECT_KEY || "DEMO";
const squadFieldId = env.JIRA_FIELD_SQUAD || "customfield_10001";
const metaRes = await fetch(
  `${base}/issue/createmeta?projectKeys=${encodeURIComponent(projectKey)}&issuetypeNames=Sub-task&expand=projects.issuetypes.fields`,
  { headers: { Authorization: `Basic ${auth}`, Accept: "application/json" } },
);
const meta = await metaRes.json();
const subtaskType = meta.projects?.[0]?.issuetypes?.find((type) => type.name === "Sub-task");
const squadField = subtaskType?.fields?.[squadFieldId];
console.log("\nSquad field meta:");
console.log(JSON.stringify(squadField, null, 2));
