-- Several users with roles. The existing account keeps everything (OWNER) and signs in with the
-- same name it always used (the old email column becomes the username).
CREATE TYPE "AdminRole" AS ENUM ('OWNER', 'EVENTS', 'BOOTHS', 'KIOSK');
ALTER TABLE "Admin" RENAME COLUMN "email" TO "username";
ALTER INDEX "Admin_email_key" RENAME TO "Admin_username_key";
ALTER TABLE "Admin" ADD COLUMN "role" "AdminRole" NOT NULL DEFAULT 'OWNER';
ALTER TABLE "Admin" ADD COLUMN "disabled" BOOLEAN NOT NULL DEFAULT false;
