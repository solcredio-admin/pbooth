-- Deleting a booth keeps the sessions (and photos, galleries) it shot; they just lose the booth link.
ALTER TABLE "Session" DROP CONSTRAINT "Session_boothId_fkey";
ALTER TABLE "Session" ALTER COLUMN "boothId" DROP NOT NULL;
ALTER TABLE "Session" ADD CONSTRAINT "Session_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE SET NULL ON UPDATE CASCADE;
