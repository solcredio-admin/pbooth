-- QR payments expire if not paid in time.
ALTER TABLE "Payment" ADD COLUMN "expiresAt" TIMESTAMPTZ(3);
