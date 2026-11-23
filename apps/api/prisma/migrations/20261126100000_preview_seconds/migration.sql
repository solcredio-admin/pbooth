-- How long each photo is shown before the next countdown (multi-photo sessions).
ALTER TABLE "EventConfig" ADD COLUMN "previewSeconds" INTEGER NOT NULL DEFAULT 3;
