-- CreateEnum
CREATE TYPE "JiraSprintState" AS ENUM ('active', 'future', 'closed', 'none');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "jiraSprintId" INTEGER,
ADD COLUMN "jiraSprintName" TEXT,
ADD COLUMN "jiraSprintState" "JiraSprintState";
