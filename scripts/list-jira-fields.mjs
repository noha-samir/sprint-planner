import { readFileSync } from "fs";

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
const response = await fetch(`${env.JIRA_SITE_URL}/rest/api/3/field`, {
  headers: {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  },
});

if (!response.ok) {
  console.error("Jira API error:", response.status, await response.text());
  process.exit(1);
}

const fields = await response.json();
const needles = [
  "development estimate",
  "testing estimate",
  "qc engineer",
  "product manager",
  "branch",
];

const custom = fields.filter((field) => field.custom);
const hits = custom.filter((field) =>
  needles.some((needle) => field.name.toLowerCase().includes(needle)),
);

console.log("Matching custom fields:\n");
if (hits.length) {
  hits
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((field) => console.log(`${field.id}\t${field.name}`));
} else {
  console.log("(No name matches — listing all custom fields)\n");
  custom
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach((field) => console.log(`${field.id}\t${field.name}`));
}
