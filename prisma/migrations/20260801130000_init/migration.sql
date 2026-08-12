-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('super_admin', 'em', 'reviewer');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('FE', 'BE', 'QC', 'OtherSquad');

-- CreateEnum
CREATE TYPE "OwnershipMode" AS ENUM ('fullyMine', 'shared');

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
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JiraAccount_pkey" PRIMARY KEY ("email")
);

-- CreateTable
CREATE TABLE "PlannerState" (
    "squadId" TEXT NOT NULL,
    "sprintStartDate" TEXT NOT NULL,
    "planningSunday" TEXT NOT NULL,
    "extraHolidays" JSONB NOT NULL,
    "hoursPerDay" INTEGER NOT NULL,
    "sprintWorkingDays" INTEGER NOT NULL,
    "theme" TEXT NOT NULL,
    "releaseStrategy" TEXT,
    "workdayStartHour" INTEGER,
    "replanAsOf" TEXT,
    "timelineStartDate" TEXT,
    "plannerMeta" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlannerState_pkey" PRIMARY KEY ("squadId")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "squadId" TEXT NOT NULL,
    "storyName" TEXT NOT NULL DEFAULT '',
    "storyLink" TEXT NOT NULL DEFAULT '',
    "tags" JSONB NOT NULL,
    "taskNotes" TEXT NOT NULL DEFAULT '',
    "poPriority" INTEGER,
    "status" TEXT NOT NULL,
    "feDevs" JSONB NOT NULL,
    "feHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "beDevs" JSONB NOT NULL,
    "beHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "integrationHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "integrationFlags" JSONB NOT NULL,
    "qcs" JSONB NOT NULL,
    "qcHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bufferHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "replanFromStep" TEXT,
    "carryToNextSprint" BOOLEAN NOT NULL DEFAULT false,
    "releaseGroup" TEXT,
    "jira" JSONB,
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
CREATE TABLE "SquadJiraConfig" (
    "squadId" TEXT NOT NULL,
    "projectKey" TEXT,
    "issueTypeSubTask" TEXT,
    "productManagerName" TEXT,
    "productManagerJiraAccountId" TEXT,
    "parentStoryFields" JSONB,
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
    "summary" JSONB NOT NULL,
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
CREATE INDEX "Task_squadId_idx" ON "Task"("squadId");

-- CreateIndex
CREATE INDEX "Task_squadId_status_idx" ON "Task"("squadId", "status");

-- CreateIndex
CREATE INDEX "Task_squadId_poPriority_idx" ON "Task"("squadId", "poPriority");

-- CreateIndex
CREATE INDEX "Resource_squadId_type_idx" ON "Resource"("squadId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_squadId_name_key" ON "Resource"("squadId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "JiraAssigneeMap_squadId_resourceName_key" ON "JiraAssigneeMap"("squadId", "resourceName");

-- CreateIndex
CREATE INDEX "SprintHistory_squadId_archivedAt_idx" ON "SprintHistory"("squadId", "archivedAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadAccount" ADD CONSTRAINT "SquadAccount_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlannerState" ADD CONSTRAINT "PlannerState_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SquadJiraConfig" ADD CONSTRAINT "SquadJiraConfig_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JiraAssigneeMap" ADD CONSTRAINT "JiraAssigneeMap_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "SquadJiraConfig"("squadId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SprintHistory" ADD CONSTRAINT "SprintHistory_squadId_fkey" FOREIGN KEY ("squadId") REFERENCES "Squad"("id") ON DELETE CASCADE ON UPDATE CASCADE;

