-- payment references: existing payments get one too
ALTER TABLE "Payment" ADD COLUMN "reference" TEXT;
DO $$
DECLARE r RECORD; a TEXT := '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; c TEXT;
BEGIN
  FOR r IN SELECT "id" FROM "Payment" LOOP
    LOOP
      SELECT string_agg(substr(a, 1 + floor(random() * 32)::int, 1), '') INTO c FROM generate_series(1, 8);
      c := substr(c, 1, 4) || '-' || substr(c, 5, 4);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM "Payment" WHERE "reference" = c);
    END LOOP;
    UPDATE "Payment" SET "reference" = c WHERE "id" = r."id";
  END LOOP;
END $$;
ALTER TABLE "Payment" ALTER COLUMN "reference" SET NOT NULL;
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

ALTER TABLE "Event" ADD COLUMN "alertFrom" TEXT, ADD COLUMN "alertTo" TEXT;
ALTER TABLE "Booth" ADD COLUMN "staffPinHash" TEXT;
ALTER TABLE "Voucher" ADD COLUMN "complimentary" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "RefundReason" AS ENUM ('NO_SESSION', 'NO_PRINT', 'OTHER', 'SESSION_FAILED');
CREATE TYPE "RefundStatus" AS ENUM ('OPEN', 'PROCESSING', 'REFUNDED', 'REPLACED', 'REJECTED');
CREATE TABLE "RefundRequest" (
  "id" UUID NOT NULL, "eventId" UUID NOT NULL, "boothId" UUID, "paymentId" UUID,
  "reason" "RefundReason" NOT NULL, "status" "RefundStatus" NOT NULL DEFAULT 'OPEN',
  "note" TEXT, "providerRef" TEXT, "link" TEXT, "resolvedBy" TEXT, "resolvedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RefundRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RefundRequest_eventId_status_createdAt_idx" ON "RefundRequest"("eventId", "status", "createdAt");
CREATE INDEX "RefundRequest_paymentId_idx" ON "RefundRequest"("paymentId");
-- one unresolved request per payment
CREATE UNIQUE INDEX "RefundRequest_one_open" ON "RefundRequest"("paymentId") WHERE "status" IN ('OPEN', 'PROCESSING');
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RefundRequest" ADD CONSTRAINT "RefundRequest_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AlertChat" (
  "id" UUID NOT NULL, "chatId" TEXT NOT NULL, "label" TEXT NOT NULL, "kinds" TEXT[], "lastError" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AlertChat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AlertChat_chatId_key" ON "AlertChat"("chatId");
CREATE TABLE "Alert" (
  "id" UUID NOT NULL, "key" TEXT NOT NULL, "kind" TEXT NOT NULL, "text" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "sentAt" TIMESTAMPTZ(3), "clearedAt" TIMESTAMPTZ(3),
  CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Alert_key_idx" ON "Alert"("key");
CREATE INDEX "Alert_createdAt_idx" ON "Alert"("createdAt");
