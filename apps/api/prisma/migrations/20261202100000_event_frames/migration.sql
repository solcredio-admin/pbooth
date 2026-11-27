CREATE TABLE "EventFrame" (
  "id" UUID NOT NULL, "eventId" UUID NOT NULL, "layout" TEXT NOT NULL, "shots" INTEGER NOT NULL,
  "width" INTEGER NOT NULL, "height" INTEGER NOT NULL, "png" BYTEA NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventFrame_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EventFrame_eventId_layout_shots_key" ON "EventFrame"("eventId", "layout", "shots");
ALTER TABLE "EventFrame" ADD CONSTRAINT "EventFrame_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
