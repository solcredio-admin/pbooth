-- How to reach the event's client: phone and email next to the organizer's name.
ALTER TABLE "Event" ADD COLUMN "contactPhone" TEXT;
ALTER TABLE "Event" ADD COLUMN "contactEmail" TEXT;
