-- More design options; new events default to the 4R landscape layout (existing events keep theirs).
ALTER TABLE "EventConfig" ALTER COLUMN "layout" SET DEFAULT 'landscape';
ALTER TABLE "EventConfig" ADD COLUMN "pattern" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "EventConfig" ADD COLUMN "frameStyle" TEXT NOT NULL DEFAULT 'line';
ALTER TABLE "EventConfig" ADD COLUMN "photoStyle" TEXT NOT NULL DEFAULT 'rounded';
ALTER TABLE "EventConfig" ADD COLUMN "fontStyle" TEXT NOT NULL DEFAULT 'serif';
