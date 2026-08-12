-- Split Mobile hours into Android / optional iOS
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "androidHours" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "iosHours" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "needsIos" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Task' AND column_name = 'moHours'
  ) THEN
    EXECUTE 'UPDATE "Task" SET "androidHours" = "moHours" WHERE "androidHours" = 0';
    EXECUTE 'ALTER TABLE "Task" DROP COLUMN "moHours"';
  END IF;
END $$;

-- AssigneeRole: MO → ANDROID; introduce IOS
ALTER TABLE "TaskAssignee" ALTER COLUMN "role" TYPE TEXT USING ("role"::text);
UPDATE "TaskAssignee" SET "role" = 'ANDROID' WHERE "role" = 'MO';
DROP TYPE "AssigneeRole";
CREATE TYPE "AssigneeRole" AS ENUM ('FE', 'BE', 'ANDROID', 'IOS', 'QC');
ALTER TABLE "TaskAssignee"
  ALTER COLUMN "role" TYPE "AssigneeRole"
  USING ("role"::"AssigneeRole");

-- JiraSubtaskRole: mo → android; introduce ios
ALTER TABLE "TaskJiraSubtask" ALTER COLUMN "role" TYPE TEXT USING ("role"::text);
UPDATE "TaskJiraSubtask" SET "role" = 'android' WHERE "role" = 'mo';
DROP TYPE "JiraSubtaskRole";
CREATE TYPE "JiraSubtaskRole" AS ENUM ('fe', 'be', 'android', 'ios');
ALTER TABLE "TaskJiraSubtask"
  ALTER COLUMN "role" TYPE "JiraSubtaskRole"
  USING ("role"::"JiraSubtaskRole");
