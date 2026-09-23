import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MarketplaceReturnStockDisposition } from "@/lib/generated/prisma";
import {
  isCreditNoteReturnQuantityAvailable,
  resolveReferencedReturnSaleItemIds,
  resolveReturnUnitCost,
  returnDispositionReversesStockCost,
} from "@/lib/credit-note-return";

describe("credit-note return rules", () => {
  it("reverses stock cost only when the returned goods are restocked", () => {
    assert.equal(returnDispositionReversesStockCost(MarketplaceReturnStockDisposition.RESTOCK), true);
    assert.equal(returnDispositionReversesStockCost(MarketplaceReturnStockDisposition.REFUND_ONLY), false);
    assert.equal(
      returnDispositionReversesStockCost(
        MarketplaceReturnStockDisposition.DAMAGED_NO_RESTOCK,
      ),
      false,
    );
  });

  it("uses the exact sold line cost before the legacy product fallback", () => {
    const saleItemCostById = new Map([
      ["sale-line-1", 80],
      ["sale-line-2", 120],
    ]);
    const productCostById = new Map([["product-1", 100]]);

    assert.equal(
      resolveReturnUnitCost({
        saleItemId: "sale-line-2",
        productId: "product-1",
        saleItemCostById,
        productCostById,
        fallbackCost: 140,
      }),
      120,
    );
    assert.equal(
      resolveReturnUnitCost({
        productId: "product-1",
        saleItemCostById,
        productCostById,
        fallbackCost: 140,
      }),
      100,
    );
  });

  it("blocks cumulative over-return for every referenced sale return", () => {
    assert.equal(isCreditNoteReturnQuantityAvailable(10, 4, 6), true);
    assert.equal(isCreditNoteReturnQuantityAvailable(10, 4, 6.00009), true);
    assert.equal(isCreditNoteReturnQuantityAvailable(10, 4, 6.01), false);
  });

  it("resolves a legacy request only when one sale line matches the product", () => {
    const resolved = resolveReferencedReturnSaleItemIds({
      saleLines: [{ id: "sale-line-1", productId: "product-1", soldBaseQty: 2 }],
      requests: [{ productId: "product-1", requestedBaseQty: 1 }],
      linkedReturnedBySaleItemId: new Map(),
      legacyReturnedByProductId: new Map(),
    });
    assert.deepEqual(resolved, ["sale-line-1"]);
  });

  it("aggregates split outcomes from the same sale line before checking quantity", () => {
    assert.throws(
      () =>
        resolveReferencedReturnSaleItemIds({
          saleLines: [{ id: "sale-line-1", productId: "product-1", soldBaseQty: 2 }],
          requests: [
            { saleItemId: "sale-line-1", productId: "product-1", requestedBaseQty: 1.25 },
            { saleItemId: "sale-line-1", productId: "product-1", requestedBaseQty: 1 },
          ],
          linkedReturnedBySaleItemId: new Map(),
          legacyReturnedByProductId: new Map(),
        }),
      /CREDIT_NOTE_RETURN_QTY_EXCEEDED/,
    );
  });

  it("rejects a product that does not belong to the referenced sale line", () => {
    assert.throws(
      () =>
        resolveReferencedReturnSaleItemIds({
          saleLines: [{ id: "sale-line-1", productId: "product-1", soldBaseQty: 2 }],
          requests: [
            { saleItemId: "sale-line-1", productId: "product-2", requestedBaseQty: 1 },
          ],
          linkedReturnedBySaleItemId: new Map(),
          legacyReturnedByProductId: new Map(),
        }),
      /CREDIT_NOTE_RETURN_INVALID_SALE_LINE/,
    );
  });

  it("fails closed when an old unlinked return is ambiguous across duplicate sale lines", () => {
    assert.throws(
      () =>
        resolveReferencedReturnSaleItemIds({
          saleLines: [
            { id: "sale-line-1", productId: "product-1", soldBaseQty: 1 },
            { id: "sale-line-2", productId: "product-1", soldBaseQty: 1 },
          ],
          requests: [
            { saleItemId: "sale-line-1", productId: "product-1", requestedBaseQty: 1 },
          ],
          linkedReturnedBySaleItemId: new Map(),
          legacyReturnedByProductId: new Map([["product-1", 1]]),
        }),
      /CREDIT_NOTE_RETURN_AMBIGUOUS_HISTORY/,
    );
  });
});
