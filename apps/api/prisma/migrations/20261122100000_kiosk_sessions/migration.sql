-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('STARTED', 'COMPLETED', 'ABANDONED');

-- AlterTable
ALTER TABLE "Booth" ADD COLUMN     "kioskCodeExpiresAt" TIMESTAMPTZ(3),
ADD COLUMN     "kioskCodeHash" TEXT;

-- CreateTable
CREATE TABLE "Kiosk" (
    "id" UUID NOT NULL,
    "boothId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "pairedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ(3),
    "userAgent" TEXT,
    "lastError" TEXT,
    "telemetry" JSONB,

    CONSTRAINT "Kiosk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "boothId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'STARTED',
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "endedAt" TIMESTAMPTZ(3),
    "photoCount" INTEGER NOT NULL DEFAULT 0,
    "retakeCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Kiosk_boothId_key" ON "Kiosk"("boothId");

-- CreateIndex
CREATE UNIQUE INDEX "Kiosk_tokenHash_key" ON "Kiosk"("tokenHash");

-- CreateIndex
CREATE INDEX "Kiosk_lastSeenAt_idx" ON "Kiosk"("lastSeenAt");

-- CreateIndex
CREATE INDEX "Session_eventId_startedAt_idx" ON "Session"("eventId", "startedAt");

-- CreateIndex
CREATE INDEX "Session_boothId_startedAt_idx" ON "Session"("boothId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booth_kioskCodeHash_key" ON "Booth"("kioskCodeHash");

-- AddForeignKey
ALTER TABLE "Kiosk" ADD CONSTRAINT "Kiosk_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

