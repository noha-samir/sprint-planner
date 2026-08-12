-- Replace hybrid schema with normalized models (data re-seeded from data/*.json)
DROP TABLE IF EXISTS "TaskJiraSubtask" CASCADE;
DROP TABLE IF EXISTS "TaskJiraLink" CASCADE;
DROP TABLE IF EXISTS "TaskAssignee" CASCADE;
DROP TABLE IF EXISTS "TaskTag" CASCADE;
DROP TABLE IF EXISTS "TaskEstimatedBaseline" CASCADE;
DROP TABLE IF EXISTS "TaskNeedRemark" CASCADE;
DROP TABLE IF EXISTS "DashboardTaskOrder" CASCADE;
DROP TABLE IF EXISTS "JiraAssigneeMap" CASCADE;
DROP TABLE IF EXISTS "SquadHoliday" CASCADE;
DROP TABLE IF EXISTS "SprintHistory" CASCADE;
DROP TABLE IF EXISTS "Task" CASCADE;
DROP TABLE IF EXISTS "Resource" CASCADE;
DROP TABLE IF EXISTS "PlannerMeta" CASCADE;
DROP TABLE IF EXISTS "SprintConfig" CASCADE;
DROP TABLE IF EXISTS "PlannerState" CASCADE;
DROP TABLE IF EXISTS "SquadJiraConfig" CASCADE;
DROP TABLE IF EXISTS "SquadAccount" CASCADE;
DROP TABLE IF EXISTS "User" CASCADE;
DROP TABLE IF EXISTS "SessionVersion" CASCADE;
DROP TABLE IF EXISTS "JiraAccount" CASCADE;
DROP TABLE IF EXISTS "AppConfig" CASCADE;
DROP TABLE IF EXISTS "Squad" CASCADE;
DROP TYPE IF EXISTS "TaskReplanStep" CASCADE;
DROP TYPE IF EXISTS "JiraSubtaskRole" CASCADE;
DROP TYPE IF EXISTS "AssigneeRole" CASCADE;
DROP TYPE IF EXISTS "ReleaseStrategy" CASCADE;
DROP TYPE IF EXISTS "Theme" CASCADE;
DROP TYPE IF EXISTS "OwnershipMode" CASCADE;
DROP TYPE IF EXISTS "ResourceType" CASCADE;
DROP TYPE IF EXISTS "UserRole" CASCADE;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'em', 'reviewer');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('FE', 'BE', 'QC', 'OtherSquad');

-- CreateEnum
CREATE TYPE "OwnershipMode" AS ENUM ('fullyMine', 'shared');

-- CreateEnum
CREATE TYPE "Theme" AS ENUM ('ocean', 'sunset', 'forest');

-- CreateEnum
CREATE TYPE "ReleaseStrategy" AS ENUM ('earliestStoriesFirst', 'latestReleaseOnly');

-- CreateEnum
CREATE TYPE "AssigneeRole" AS ENUM ('FE', 'BE', 'QC');

-- CreateEnum
CREATE TYPE "JiraSubtaskRole" AS ENUM ('fe', 'be');

-- CreateEnum
CREATE TYPE "TaskReplanStep" AS ENUM ('Start', 'FE', 'Integration', 'QC', 'Buffer');

-- CreateTable
CREATE TABLE "AppConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "allowedEmailDomain" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Squad" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "emEmail" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Squad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "squadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadAccount" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "squadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquadAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionVersion" (
    "email" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionVersion_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "JiraAccount" (
    "email" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraAccount_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "SprintConfig" (
    "squadId" TEXT NOT NULL,
    "sprintStartDate" TEXT NOT NULL,
    "planningSunday" TEXT NOT NULL,
    "hoursPerDay" INTEGER NOT NULL,
    "sprintWorkingDays" INTEGER NOT NULL,
    "theme" "Theme" NOT NULL DEFAULT 'ocean',
    "releaseStrategy" "ReleaseStrategy" NOT NULL DEFAULT 'earliestStoriesFirst',
    "workdayStartHour" INTEGER,
    "replanAsOf" TEXT,
    "timelineStartDate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SprintConfig_pkey" PRIMARY KEY ("squadId")
);

-- CreateTable
CREATE TABLE "SquadHoliday" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SquadHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlannerMeta" (
    "squadId" TEXT NOT NULL,
    "snapshot1TakenAt" TEXT,
    "estimatedBaselineCapturedAt" TEXT,
    "uatTrackingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "curScheduleSnapshot" JSONB,
    "curScheduleTakenAt" TEXT,
    "rulesVersion" INTEGER NOT NULL DEFAULT 2,
    "replanAsOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannerMeta_pkey" PRIMARY KEY ("squadId")
);

-- CreateTable
CREATE TABLE "TaskEstimatedBaseline" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "releaseAt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskEstimatedBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskNeedRemark" (
    "squadId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "TaskNeedRemark_pkey" PRIMARY KEY ("squadId","taskId")
);

-- CreateTable
CREATE TABLE "DashboardTaskOrder" (
    "squadId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "DashboardTaskOrder_pkey" PRIMARY KEY ("squadId","taskId")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "storyName" TEXT NOT NULL DEFAULT '',
    "storyLink" TEXT NOT NULL DEFAULT '',
    "taskNotes" TEXT NOT NULL DEFAULT '',
    "poPriority" INTEGER,
    "status" TEXT NOT NULL,
    "feHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "beHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "integrationHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qcHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bufferHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "needsDevOps" BOOLEAN NOT NULL DEFAULT false,
    "needsCdc" BOOLEAN NOT NULL DEFAULT false,
    "needsDbSync" BOOLEAN NOT NULL DEFAULT false,
    "needsOtherSquad" BOOLEAN NOT NULL DEFAULT false,
    "needsThirdParty" BOOLEAN NOT NULL DEFAULT false,
    "replanFromStep" "TaskReplanStep",
    "carryToNextSprint" BOOLEAN NOT NULL DEFAULT false,
    "releaseGroup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "capacityHours" DOUBLE PRECISION,
    "ownershipMode" "OwnershipMode",
    "ourSquadHours" DOUBLE PRECISION,
    "nickname" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignee" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "role" "AssigneeRole" NOT NULL,
    "resourceName" TEXT NOT NULL,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTag" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskJiraLink" (
    "taskId" TEXT NOT NULL,
    "parentIssueKey" TEXT NOT NULL,
    "lastPushedAt" TIMESTAMP(3),
    "lastPulledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskJiraLink_pkey" PRIMARY KEY ("taskId")
);

-- CreateTable
CREATE TABLE "TaskJiraSubtask" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "role" "JiraSubtaskRole" NOT NULL,
    "assigneeName" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskJiraSubtask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquadJiraConfig" (
    "squadId" TEXT NOT NULL,
    "projectKey" TEXT,
    "issueTypeSubTask" TEXT,
    "productManagerName" TEXT,
    "productManagerJiraAccountId" TEXT,
    "developmentEstimateFieldId" TEXT,
    "testingEstimateFieldId" TEXT,
    "qcEngineerFieldId" TEXT,
    "productManagerFieldId" TEXT,
    "branchNameFieldId" TEXT,
    "qcEngineerFieldIsUser" BOOLEAN,
    "productManagerFieldIsUser" BOOLEAN,
    "subtaskSquadFieldId" TEXT,
    "subtaskSquadOptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SquadJiraConfig_pkey" PRIMARY KEY ("squadId")
);

-- CreateTable
CREATE TABLE "JiraAssigneeMap" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "jiraAccountId" TEXT NOT NULL,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JiraAssigneeMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SprintHistory" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL,
    "sprintStartDate" TEXT NOT NULL,
    "planningSunday" TEXT NOT NULL,
    "tasksSnapshot" JSONB NOT NULL,
    "resourcesSnapshot" JSONB NOT NULL,
    "configSnapshot" JSONB NOT NULL,
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "carryOverTasks" INTEGER NOT NULL DEFAULT 0,
    "totalResources" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SprintHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Squad_hidden_idx" ON "Squad"("hidden");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_squadId_idx" ON "User"("squadId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "SquadAccount_squadId_idx" ON "SquadAccount"("squadId");

-- CreateIndex
CREATE UNIQUE INDEX "SquadAccount_email_squadId_key" ON "SquadAccount"("email", "squadId");

-- CreateIndex
CREATE INDEX "SquadHoliday_squadId_idx" ON "SquadHoliday"("squadId");

-- CreateIndex
CREATE UNIQUE INDEX "SquadHoliday_squadId_date_key" ON "SquadHoliday"("squadId", "date");

-- CreateIndex
CREATE INDEX "TaskEstimatedBaseline_squadId_idx" ON "TaskEstimatedBaseline"("squadId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskEstimatedBaseline_squadId_taskId_key" ON "TaskEstimatedBaseline"("squadId", "taskId");

-- CreateIndex
CREATE INDEX "DashboardTaskOrder_squadId_position_idx" ON "DashboardTaskOrder"("squadId", "position");

-- CreateIndex
CREATE INDEX "Task_squadId_idx" ON "Task"("squadId");

-- CreateIndex
CREATE INDEX "Task_squadId_status_idx" ON "Task"("squadId", "status");

-- CreateIndex
CREATE INDEX "Task_squadId_poPriority_idx" ON "Task"("squadId", "poPriority");

-- CreateIndex
CREATE INDEX "Task_squadId_releaseGroup_idx" ON "Task"("squadId", "releaseGroup");

-- CreateIndex
CREATE INDEX "Resource_squadId_type_idx" ON "Resource"("squadId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_squadId_name_key" ON "Resource"("squadId", "name");

-- CreateIndex
CREATE INDEX "TaskAssignee_taskId_role_idx" ON "TaskAssignee"("taskId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAssignee_taskId_role_resourceName_key" ON "TaskAssignee"("taskId", "role", "resourceName");

-- CreateIndex
CREATE INDEX "TaskTag_taskId_idx" ON "TaskTag"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTag_taskId_tag_key" ON "TaskTag"("taskId", "tag");

-- CreateIndex
CREATE INDEX "TaskJiraSubtask_taskId_role_idx" ON "TaskJiraSubtask"("taskId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "TaskJiraSubtask_taskId_key_key" ON "TaskJiraSubtask"("taskId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "JiraAssigneeMap_squadId_resourceName_key" ON "JiraAssigneeMap"("squadId", "resourceName");

-- CreateIndex
CREATE INDEX "SprintHistory_squadId_archivedAt_idx" ON "SprintHistory"("squadId", "archivedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadAccount" ADD CONSTRAINT "SquadAccount_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintConfig" ADD CONSTRAINT "SprintConfig_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadHoliday" ADD CONSTRAINT "SquadHoliday_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannerMeta" ADD CONSTRAINT "PlannerMeta_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEstimatedBaseline" ADD CONSTRAINT "TaskEstimatedBaseline_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "PlannerMeta"("squadId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskNeedRemark" ADD CONSTRAINT "TaskNeedRemark_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "PlannerMeta"("squadId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardTaskOrder" ADD CONSTRAINT "DashboardTaskOrder_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "PlannerMeta"("squadId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignee" ADD CONSTRAINT "TaskAssignee_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTag" ADD CONSTRAINT "TaskTag_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskJiraLink" ADD CONSTRAINT "TaskJiraLink_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskJiraSubtask" ADD CONSTRAINT "TaskJiraSubtask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "TaskJiraLink"("taskId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadJiraConfig" ADD CONSTRAINT "SquadJiraConfig_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraAssigneeMap" ADD CONSTRAINT "JiraAssigneeMap_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "SquadJiraConfig"("squadId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraAssigneeMap" ADD CONSTRAINT "JiraAssigneeMap_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintHistory" ADD CONSTRAINT "SprintHistory_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

