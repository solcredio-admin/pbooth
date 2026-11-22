-- CreateEnum
CREATE TYPE "BoothState" AS ENUM ('UNREGISTERED', 'READY', 'REVOKED');

-- CreateTable
CREATE TABLE "Booth" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "notes" TEXT,
    "state" "BoothState" NOT NULL DEFAULT 'UNREGISTERED',
    "camera" JSONB NOT NULL,
    "printer" JSONB NOT NULL,
    "enrollmentCodeHash" TEXT,
    "enrollmentExpiresAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Booth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" UUID NOT NULL,
    "boothId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "hostname" TEXT,
    "os" TEXT,
    "agentVersion" TEXT,
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "enrolledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastHeartbeatAt" TIMESTAMPTZ(3),
    "lastIp" TEXT,
    "lastError" TEXT,
    "appliedConfigVersion" TEXT,
    "telemetry" JSONB,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventBooth" (
    "eventId" UUID NOT NULL,
    "boothId" UUID NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventBooth_pkey" PRIMARY KEY ("eventId","boothId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Booth_code_key" ON "Booth"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Booth_enrollmentCodeHash_key" ON "Booth"("enrollmentCodeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Device_boothId_key" ON "Device"("boothId");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_lastHeartbeatAt_idx" ON "Device"("lastHeartbeatAt");

-- CreateIndex
CREATE INDEX "EventBooth_boothId_idx" ON "EventBooth"("boothId");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventBooth" ADD CONSTRAINT "EventBooth_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventBooth" ADD CONSTRAINT "EventBooth_boothId_fkey" FOREIGN KEY ("boothId") REFERENCES "Booth"("id") ON DELETE CASCADE ON UPDATE CASCADE;

