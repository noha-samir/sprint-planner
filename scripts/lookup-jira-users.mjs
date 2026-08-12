import { readFileSync } from "fs";

const names = process.argv.slice(2);
if (!names.length) {
  console.error("Usage: node scripts/lookup-jira-users.mjs Name1 Name2 ...");
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

for (const name of names) {
  const response = await fetch(
    `${env.JIRA_SITE_URL}/rest/api/3/user/search?query=${encodeURIComponent(name)}&maxResults=5`,
    {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    },
  );
  const users = await response.json();
  console.log(`\n${name}:`);
  if (!Array.isArray(users) || !users.length) {
    console.log("  (no matches)");
    continue;
  }
  users.forEach((user) => {
    console.log(`  ${user.displayName}\t${user.accountId}`);
  });
}
