-- AlterTable
ALTER TABLE "EventConfig" ADD COLUMN     "captureIntervalSeconds" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "footerText" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "layout" TEXT NOT NULL DEFAULT 'strip',
ADD COLUMN     "showDate" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "shotsPerSession" SET DEFAULT 3;

