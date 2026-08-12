import { readFileSync } from "fs";

const query = process.argv[2] ?? "";
const project = process.argv[3] ?? "BR";

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
const response = await fetch(
  `${env.JIRA_SITE_URL}/rest/api/3/user/assignable/search?project=${encodeURIComponent(project)}&query=${encodeURIComponent(query)}&maxResults=20`,
  {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  },
);

const users = await response.json();
if (!response.ok) {
  console.error(users);
  process.exit(1);
}

users.forEach((user) => {
  console.log(`${user.displayName}\t${user.accountId}`);
});
