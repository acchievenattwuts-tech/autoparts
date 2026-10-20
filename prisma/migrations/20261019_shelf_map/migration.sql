-- Shelf map (ผังชั้นวาง) phase 1a, approved 2026-10-19.
-- Additive only: two new tables and one enum value. Product keeps its legacy
-- "shelfLocation" column untouched (empty for every product).
-- Run this file first; run each indexes/*.sql separately outside a transaction.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'IMPORT';

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShelfRack" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "levels" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ShelfRack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProductShelfLocation" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProductShelfLocation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductShelfLocation_productId_fkey') THEN
    ALTER TABLE "ProductShelfLocation" ADD CONSTRAINT "ProductShelfLocation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductShelfLocation_rackId_fkey') THEN
    ALTER TABLE "ProductShelfLocation" ADD CONSTRAINT "ProductShelfLocation_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "ShelfRack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- New tables follow the repo's backend-only Supabase access policy.
ALTER TABLE public."ShelfRack" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ProductShelfLocation" ENABLE ROW LEVEL SECURITY;
