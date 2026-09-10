-- Signature snapshot for quotation / customer advance / customer advance refund.
-- Mirrors the existing Sale / Receipt / WarrantyClaim signer columns so the
-- printed signature is frozen with the document instead of following the user
-- record. All columns are nullable and additive.

ALTER TABLE "SalesQuotation"
ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "signerName" TEXT,
ADD COLUMN IF NOT EXISTS "signerSignatureUrl" TEXT;

ALTER TABLE "CustomerAdvance"
ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "signerName" TEXT,
ADD COLUMN IF NOT EXISTS "signerSignatureUrl" TEXT;

ALTER TABLE "CustomerAdvanceRefund"
ADD COLUMN IF NOT EXISTS "signedAt" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "signerName" TEXT,
ADD COLUMN IF NOT EXISTS "signerSignatureUrl" TEXT;
