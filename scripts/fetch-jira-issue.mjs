import { readFileSync } from "fs";

const issueKey = process.argv[2];
if (!issueKey) {
  console.error("Usage: node scripts/fetch-jira-issue.mjs ISSUE-KEY");
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
const response = await fetch(`${env.JIRA_SITE_URL}/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
  headers: {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  },
});

if (!response.ok) {
  console.error("Jira API error:", response.status, await response.text());
  process.exit(1);
}

const issue = await response.json();
const trackedFields = Object.fromEntries(
  [
    [env.JIRA_FIELD_DEVELOPMENT_ESTIMATE_HOURS, "Development Estimate in Hours"],
    [env.JIRA_FIELD_TESTING_ESTIMATE_HOURS, "Testing Estimate in Hours"],
    [env.JIRA_FIELD_QC_ENGINEER, "QC Engineer"],
    [env.JIRA_FIELD_PRODUCT_MANAGER, "Product Manager"],
    [env.JIRA_FIELD_BRANCH_NAME, "Branch name"],
  ].filter(([fieldId]) => Boolean(fieldId)),
);

console.log(`Issue: ${issue.key} — ${issue.fields?.summary ?? ""}\n`);
for (const [fieldId, label] of Object.entries(trackedFields)) {
  console.log(`${label} (${fieldId}):`, JSON.stringify(issue.fields?.[fieldId] ?? null));
}
