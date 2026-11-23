-- Self-service events (a booth left at a café), vouchers, payments and cashier accounts.
ALTER TYPE "AdminRole" ADD VALUE 'CASHIER';
CREATE TYPE "EventKind" AS ENUM ('MANAGED', 'SELF_SERVICE');
CREATE TYPE "VoucherKind" AS ENUM ('ONE_TIME', 'UNLIMITED');
CREATE TYPE "PaymentMethod" AS ENUM ('VOUCHER', 'QR', 'FREE');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'REFUNDED');

ALTER TABLE "Event" ADD COLUMN "kind" "EventKind" NOT NULL DEFAULT 'MANAGED';
ALTER TABLE "Event" ADD COLUMN "priceCentavos" INTEGER NOT NULL DEFAULT 15000;
ALTER TABLE "Event" ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'PHP';
ALTER TABLE "Event" ADD COLUMN "freeSessions" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "partnerName" TEXT;
ALTER TABLE "Event" ADD COLUMN "partnerSharePercent" INTEGER;

CREATE TABLE "EventCashier" (
  "eventId" UUID NOT NULL,
  "adminId" UUID NOT NULL,
  CONSTRAINT "EventCashier_pkey" PRIMARY KEY ("eventId", "adminId")
);
CREATE INDEX "EventCashier_adminId_idx" ON "EventCashier"("adminId");
ALTER TABLE "EventCashier" ADD CONSTRAINT "EventCashier_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventCashier" ADD CONSTRAINT "EventCashier_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Voucher" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "kind" "VoucherKind" NOT NULL,
  "codeHash" TEXT NOT NULL,
  "hint" TEXT NOT NULL,
  "label" TEXT,
  "batch" TEXT,
  "uses" INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMPTZ(3),
  "voidedAt" TIMESTAMPTZ(3),
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Voucher_codeHash_key" ON "Voucher"("codeHash");
CREATE INDEX "Voucher_eventId_createdAt_idx" ON "Voucher"("eventId", "createdAt");
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "boothId" UUID,
  "sessionId" UUID,
  "method" "PaymentMethod" NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "amountCentavos" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'PHP',
  "voucherId" UUID,
  "provider" TEXT,
  "providerRef" TEXT,
  "paidAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payment_sessionId_key" ON "Payment"("sessionId");
CREATE UNIQUE INDEX "Payment_providerRef_key" ON "Payment"("providerRef");
CREATE INDEX "Payment_eventId_createdAt_idx" ON "Payment"("eventId", "createdAt");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
