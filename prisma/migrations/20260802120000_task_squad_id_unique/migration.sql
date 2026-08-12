-- Ensure task ids are unique within a squad (id remains the global PK for FK simplicity).
CREATE UNIQUE INDEX IF NOT EXISTS "Task_squadId_id_key" ON "Task"("squadId", "id");
