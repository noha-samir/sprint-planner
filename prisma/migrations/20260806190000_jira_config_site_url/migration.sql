-- Per-squad Jira site URL and last assignee sync timestamp (product config leaves .env).
ALTER TABLE "SquadJiraConfig" ADD COLUMN IF NOT EXISTS "siteUrl" TEXT;
ALTER TABLE "SquadJiraConfig" ADD COLUMN IF NOT EXISTS "assigneesSyncedAt" TIMESTAMP(3);
