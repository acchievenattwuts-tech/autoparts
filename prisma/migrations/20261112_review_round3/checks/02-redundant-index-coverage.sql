-- Phase B guard, read-only. Run BEFORE indexes/08.sql - 27.sql (R12):
--   npx prisma db execute --file prisma/migrations/20261112_review_round3/checks/02-redundant-index-coverage.sql
-- For every index that indexes/08-27.sql drops, checks in the live catalog (not in schema.prisma) that another VALID,
-- non-partial btree index on the same table starts with exactly the same columns in the same order. Fails and names
-- the uncovered ones otherwise: skip those drop files and report them. Writes nothing.
DO $check$
DECLARE
  uncovered text;
BEGIN
  WITH wanted (table_name, drop_index, leading_columns) AS (
    VALUES
      ('User', 'User_username_idx', ARRAY['username']),
      ('UserLineRecipient', 'UserLineRecipient_recipientId_idx', ARRAY['recipientId']),
      ('Product', 'Product_categoryId_idx', ARRAY['categoryId']),
      ('SearchKeyword', 'SearchKeyword_normalized_idx', ARRAY['normalized']),
      ('Sale', 'Sale_trackingToken_idx', ARRAY['trackingToken']),
      ('DeliveryTracking', 'DeliveryTracking_saleId_idx', ARRAY['saleId']),
      ('WarrantyClaim', 'WarrantyClaim_warrantyId_idx', ARRAY['warrantyId']),
      ('ClaimStockBalance', 'ClaimStockBalance_claimId_idx', ARRAY['claimId']),
      ('Expense', 'Expense_cashBankAccountId_idx', ARRAY['cashBankAccountId']),
      ('DeliveryCommissionRun', 'DeliveryCommissionRun_expenseId_idx', ARRAY['expenseId']),
      ('CreditNote', 'CreditNote_cashBankAccountId_idx', ARRAY['cashBankAccountId']),
      ('PurchaseReturn', 'PurchaseReturn_cashBankAccountId_idx', ARRAY['cashBankAccountId']),
      ('Receipt', 'Receipt_cashBankAccountId_idx', ARRAY['cashBankAccountId']),
      ('CashBankAccount', 'CashBankAccount_type_isActive_idx', ARRAY['type', 'isActive']),
      ('CustomerAdvance', 'CustomerAdvance_cashBankAccountId_idx', ARRAY['cashBankAccountId']),
      ('CustomerAdvanceRefund', 'CustomerAdvanceRefund_cashBankAccountId_idx', ARRAY['cashBankAccountId']),
      ('SupplierAdvance', 'SupplierAdvance_cashBankAccountId_idx', ARRAY['cashBankAccountId']),
      ('SupplierAdvanceRefund', 'SupplierAdvanceRefund_cashBankAccountId_idx', ARRAY['cashBankAccountId']),
      ('SupplierPayment', 'SupplierPayment_cashBankAccountId_idx', ARRAY['cashBankAccountId']),
      ('LotBalance', 'LotBalance_productId_idx', ARRAY['productId'])
  ),
  coverage AS (
    SELECT
      w.table_name,
      w.drop_index,
      EXISTS (
        SELECT 1
        FROM pg_index x
        JOIN pg_class ic ON ic.oid = x.indexrelid
        JOIN pg_am am ON am.oid = ic.relam
        WHERE x.indrelid = to_regclass(format('public.%I', w.table_name))
          AND ic.relname <> w.drop_index
          AND am.amname = 'btree'
          AND x.indisvalid
          AND x.indpred IS NULL
          AND x.indnkeyatts >= cardinality(w.leading_columns)
          AND ARRAY(
            SELECT a.attname::text
            FROM generate_subscripts(w.leading_columns, 1) AS k(pos)
            JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[k.pos - 1]
            ORDER BY k.pos
          ) = w.leading_columns
      ) AS covered
    FROM wanted w
  )
  SELECT string_agg(format('%s.%s', c.table_name, c.drop_index), ', ' ORDER BY c.drop_index)
    INTO uncovered
  FROM coverage c
  WHERE NOT c.covered;

  IF uncovered IS NOT NULL THEN
    RAISE EXCEPTION 'No covering index found for: % (skip those drop files)', uncovered;
  END IF;
  RAISE NOTICE 'OK: every index dropped by indexes/08-27.sql is covered by another valid btree index.';
END
$check$;
