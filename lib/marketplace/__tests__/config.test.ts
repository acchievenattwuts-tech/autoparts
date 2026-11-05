import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SaleChannel } from "@/lib/generated/prisma";
import {
  getDefaultMarketplaceShippingAddress,
  getMarketplaceChannelConfig,
  isManualMarketplaceChannel,
  isMarketplaceSalePaymentValid,
  resolveChannelFromSlug,
} from "@/lib/marketplace/config";

describe("marketplace channel config", () => {
  it("recognises only the manual marketplace channels", () => {
    assert.equal(isManualMarketplaceChannel(SaleChannel.SHOPEE), true);
    assert.equal(isManualMarketplaceChannel(SaleChannel.LAZADA), true);
    assert.equal(isManualMarketplaceChannel(SaleChannel.STORE), false);
    assert.equal(isManualMarketplaceChannel(""), false);
  });

  it("provides the order labels used consistently across marketplace sale pages", () => {
    assert.equal(
      getMarketplaceChannelConfig(SaleChannel.SHOPEE).orderRefLabel,
      "เลขคำสั่งซื้อ Shopee",
    );
    assert.equal(
      getMarketplaceChannelConfig(SaleChannel.LAZADA).orderRefLabel,
      "เลขคำสั่งซื้อ Lazada",
    );
  });

  it("maps url slugs back to their channel", () => {
    assert.equal(resolveChannelFromSlug("lazada"), SaleChannel.LAZADA);
    assert.equal(resolveChannelFromSlug("shopee"), SaleChannel.SHOPEE);
    assert.equal(resolveChannelFromSlug("tiktok"), null);
  });

  it("keeps document prefixes distinct per channel", () => {
    const shopee = getMarketplaceChannelConfig(SaleChannel.SHOPEE);
    const lazada = getMarketplaceChannelConfig(SaleChannel.LAZADA);
    assert.notEqual(shopee.saleDocPrefix, lazada.saleDocPrefix);
    assert.notEqual(shopee.settlementDocPrefix, lazada.settlementDocPrefix);
    assert.notEqual(shopee.feeExpenseCodePrefix, lazada.feeExpenseCodePrefix);
  });

  // ใบเสร็จเทียบสตริงนี้เพื่อซ่อนแถวที่อยู่ตอนแอดมินยังไม่ได้คีย์ที่อยู่จริง
  // ถ้าข้อความสองฝั่งหลุดจากกันเมื่อไร ลูกค้าจะเห็นประโยคตั้งต้นบนใบเสร็จทันที
  it("builds the default shipping address from the channel label", () => {
    assert.equal(
      getDefaultMarketplaceShippingAddress(SaleChannel.LAZADA),
      "จัดส่งตามที่อยู่ในคำสั่งซื้อ Lazada",
    );
    assert.equal(
      getDefaultMarketplaceShippingAddress(SaleChannel.SHOPEE),
      "จัดส่งตามที่อยู่ในคำสั่งซื้อ Shopee",
    );
  });

  it("requires the full amount in the holding account as a single payment row", () => {
    const holding = "acc-holding";
    assert.equal(isMarketplaceSalePaymentValid([{ cashBankAccountId: holding }], holding, 350), true);
    assert.equal(isMarketplaceSalePaymentValid([], holding, 350), false);
    assert.equal(isMarketplaceSalePaymentValid([{ cashBankAccountId: "acc-other" }], holding, 350), false);
    assert.equal(
      isMarketplaceSalePaymentValid([{ cashBankAccountId: holding }, { cashBankAccountId: holding }], holding, 350),
      false,
    );
    assert.equal(isMarketplaceSalePaymentValid([{ cashBankAccountId: holding }], null, 350), false);
  });

  // ใบยอด 0 บาท (ของแถม/ของทดแทน) ไม่มีเงินเข้าบัญชีพักเงิน จึงต้องไม่มีแถวรับเงิน
  it("accepts a 0-baht marketplace sale only without payment rows", () => {
    const holding = "acc-holding";
    assert.equal(isMarketplaceSalePaymentValid([], holding, 0), true);
    assert.equal(isMarketplaceSalePaymentValid([], null, 0), true);
    assert.equal(isMarketplaceSalePaymentValid([{ cashBankAccountId: holding }], holding, 0), false);
  });
});
