-- CreateEnum
CREATE TYPE "PhotoKind" AS ENUM ('ORIGINAL', 'DESIGN');

-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('PENDING', 'UPLOADED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "GalleryScope" AS ENUM ('SESSION', 'EVENT');

-- CreateTable
CREATE TABLE "Photo" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "boothId" UUID NOT NULL,
    "kind" "PhotoKind" NOT NULL,
    "index" INTEGER NOT NULL DEFAULT 0,
    "status" "PhotoStatus" NOT NULL DEFAULT 'PENDING',
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "key" TEXT NOT NULL,
    "thumbKey" TEXT,
    "previewKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMPTZ(3),
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gallery" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "scope" "GalleryScope" NOT NULL,
    "eventId" UUID NOT NULL,
    "sessionId" UUID,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gallery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Photo_key_key" ON "Photo"("key");

-- CreateIndex
CREATE INDEX "Photo_eventId_status_idx" ON "Photo"("eventId", "status");

-- CreateIndex
CREATE INDEX "Photo_sessionId_idx" ON "Photo"("sessionId");

-- CreateIndex
CREATE INDEX "Photo_status_uploadedAt_idx" ON "Photo"("status", "uploadedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Gallery_token_key" ON "Gallery"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Gallery_sessionId_key" ON "Gallery"("sessionId");

-- CreateIndex
CREATE INDEX "Gallery_eventId_scope_idx" ON "Gallery"("eventId", "scope");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gallery" ADD CONSTRAINT "Gallery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Gallery" ADD CONSTRAINT "Gallery_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

