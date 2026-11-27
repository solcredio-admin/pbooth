ALTER TABLE "AuditLog" ADD COLUMN "actorName" TEXT;
-- older entries: today's username and role, where the account still exists
UPDATE "AuditLog" l SET "actorName" = a."username" || ' (' || a."role" || ')' FROM "Admin" a WHERE l."actor" = 'admin:' || a."id";
CREATE INDEX "AuditLog_actor_idx" ON "AuditLog"("actor");
