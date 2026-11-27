ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'SALES';

-- Kiosk admins see only the events they're assigned to (and open those kiosks).
CREATE TABLE "EventKiosk" ("eventId" UUID NOT NULL, "adminId" UUID NOT NULL, CONSTRAINT "EventKiosk_pkey" PRIMARY KEY ("eventId", "adminId"));
CREATE INDEX "EventKiosk_adminId_idx" ON "EventKiosk"("adminId");
ALTER TABLE "EventKiosk" ADD CONSTRAINT "EventKiosk_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventKiosk" ADD CONSTRAINT "EventKiosk_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;
