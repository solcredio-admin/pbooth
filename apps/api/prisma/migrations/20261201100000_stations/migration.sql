CREATE TYPE "PrintMode" AS ENUM ('FIXED', 'ROTATE');
ALTER TABLE "Booth" ADD COLUMN "printMode" "PrintMode" NOT NULL DEFAULT 'FIXED';

CREATE TABLE "Station" (
  "id" UUID NOT NULL, "name" TEXT NOT NULL, "code" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "printerName" TEXT, "paperSize" TEXT NOT NULL DEFAULT '4x6', "orientation" TEXT NOT NULL DEFAULT 'portrait',
  "enrollmentCodeHash" TEXT, "enrollmentExpiresAt" TIMESTAMPTZ(3), "tokenHash" TEXT, "identifier" TEXT, "hostname" TEXT, "os" TEXT,
  "agentVersion" TEXT, "simulated" BOOLEAN NOT NULL DEFAULT false, "enrolledAt" TIMESTAMPTZ(3), "lastPollAt" TIMESTAMPTZ(3),
  "ready" BOOLEAN NOT NULL DEFAULT false, "lastError" TEXT, "printers" JSONB, "lastClaimAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Station_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Station_code_key" ON "Station"("code");
CREATE UNIQUE INDEX "Station_enrollmentCodeHash_key" ON "Station"("enrollmentCodeHash");
CREATE UNIQUE INDEX "Station_tokenHash_key" ON "Station"("tokenHash");

CREATE TABLE "BoothStation" (
  "boothId" UUID NOT NULL, "stationId" UUID NOT NULL, "position" INTEGER NOT NULL,
  CONSTRAINT "BoothStation_pkey" PRIMARY KEY ("boothId", "stationId")
);
CREATE INDEX "BoothStation_stationId_idx" ON "BoothStation"("stationId");
ALTER TABLE "BoothStation" ADD CONSTRAINT "BoothStation_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoothStation" ADD CONSTRAINT "BoothStation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "PrintStatus" AS ENUM ('WAITING', 'CLAIMED', 'PRINTING', 'DONE', 'FAILED', 'EXPIRED');
CREATE TABLE "PrintJob" (
  "id" UUID NOT NULL, "boothId" UUID, "eventId" UUID NOT NULL, "photoId" UUID NOT NULL, "copies" INTEGER NOT NULL,
  "strip" BOOLEAN NOT NULL DEFAULT false, "status" "PrintStatus" NOT NULL DEFAULT 'WAITING', "stationId" UUID, "targetStationId" UUID,
  "attempt" INTEGER NOT NULL DEFAULT 1, "requeues" INTEGER NOT NULL DEFAULT 0, "tried" UUID[], "notBefore" TIMESTAMPTZ(3), "error" TEXT, "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL, "claimedAt" TIMESTAMPTZ(3), "doneAt" TIMESTAMPTZ(3),
  CONSTRAINT "PrintJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrintJob_status_createdAt_idx" ON "PrintJob"("status", "createdAt");
CREATE INDEX "PrintJob_stationId_status_idx" ON "PrintJob"("stationId", "status");
CREATE INDEX "PrintJob_boothId_status_idx" ON "PrintJob"("boothId", "status");
CREATE INDEX "PrintJob_eventId_idx" ON "PrintJob"("eventId");
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PrintJob" ADD CONSTRAINT "PrintJob_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "Station"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Every booth that prints today gets a station with the same settings, run by the same computer (its
-- token works for both), so nothing has to be enrolled again.
DO $$
DECLARE b RECORD; a TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; c TEXT; sid UUID;
BEGIN
  FOR b IN SELECT bo."id", bo."name", bo."printer", d."tokenHash", d."identifier", d."hostname", d."os", d."agentVersion", d."simulated", d."enrolledAt", d."id" AS "deviceId"
           FROM "Booth" bo LEFT JOIN "Device" d ON d."boothId" = bo."id" WHERE bo."printer"->>'enabled' = 'true' LOOP
    LOOP
      SELECT 'ST-' || string_agg(substr(a, 1 + floor(random() * 32)::int, 1), '') INTO c FROM generate_series(1, 4);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Station" WHERE "code" = c);
    END LOOP;
    sid := gen_random_uuid();
    INSERT INTO "Station" ("id", "name", "code", "printerName", "paperSize", "orientation", "tokenHash", "identifier", "hostname", "os", "agentVersion", "simulated", "enrolledAt")
    VALUES (sid, left(b."name", 72) || ' printer', c, b."printer"->>'printerName', coalesce(b."printer"->>'paperSize', '4x6'), coalesce(b."printer"->>'orientation', 'portrait'),
            b."tokenHash", b."identifier", b."hostname", b."os", b."agentVersion", coalesce(b."simulated", false), b."enrolledAt");
    INSERT INTO "BoothStation" ("boothId", "stationId", "position") VALUES (b."id", sid, 0);
  END LOOP;
END $$;
