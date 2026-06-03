ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "purchaseLastPrice" DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS "purchaseLastDate" TIMESTAMPTZ(3);

WITH latest_purchase_item AS (
  SELECT DISTINCT ON (pi."productId")
    pi."productId",
    COALESCE(pi."showPricePerUnit", pi."costPrice") AS "purchaseLastPrice",
    p."purchaseDate" AS "purchaseLastDate",
    COALESCE(pi."showUnitName", pr."purchaseUnitName") AS "purchaseUnitName"
  FROM "PurchaseItem" pi
  JOIN "Purchase" p ON p.id = pi."purchaseId"
  JOIN "Product" pr ON pr.id = pi."productId"
  WHERE p.status = 'ACTIVE'
  ORDER BY pi."productId", p."purchaseDate" DESC, p."purchaseNo" DESC, pi."lineNo" DESC, pi.id DESC
)
UPDATE "Product" pr
SET
  "purchaseLastPrice" = latest_purchase_item."purchaseLastPrice",
  "purchaseLastDate" = latest_purchase_item."purchaseLastDate",
  "purchaseUnitName" = latest_purchase_item."purchaseUnitName"
FROM latest_purchase_item
WHERE pr.id = latest_purchase_item."productId";
