DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ProductSearchReviewStatus') THEN
    CREATE TYPE "ProductSearchReviewStatus" AS ENUM (
      'PENDING',
      'APPLIED',
      'IGNORED',
      'NEEDS_INVESTIGATION',
      'DUPLICATE'
    );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "ProductSearchReviewOutcome" (
  "id" TEXT NOT NULL,
  "normalizedQuery" VARCHAR(200) NOT NULL,
  "candidateAction" VARCHAR(50) NOT NULL,
  "status" "ProductSearchReviewStatus" NOT NULL DEFAULT 'PENDING',
  "note" VARCHAR(500),
  "appliedType" VARCHAR(50),
  "appliedRef" VARCHAR(100),
  "reviewedById" TEXT,
  "reviewedByName" VARCHAR(100),
  "reviewedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ProductSearchReviewOutcome_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProductSearchReviewOutcome_normalizedQuery_candidateAction_key"
ON "ProductSearchReviewOutcome"("normalizedQuery", "candidateAction");

CREATE INDEX IF NOT EXISTS "ProductSearchReviewOutcome_status_updatedAt_idx"
ON "ProductSearchReviewOutcome"("status", "updatedAt" DESC);

CREATE INDEX IF NOT EXISTS "ProductSearchReviewOutcome_reviewedAt_idx"
ON "ProductSearchReviewOutcome"("reviewedAt" DESC);
