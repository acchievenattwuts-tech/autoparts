import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ShippingMethod, ShippingStatus } from "@/lib/generated/prisma";
import {
  extractShopeeCarrier,
  extractShopeeTrackingNo,
  mapShopeeCarrierToShippingMethod,
  mapShopeeOrderStatusToShippingStatus,
} from "@/lib/shopee/logistics-utils";

describe("Shopee logistics utils", () => {
  it("extracts tracking and carrier from nested package snapshots", () => {
    const raw = {
      order_sn: "250101ABC",
      package_list: [
        {
          logistics_channel_name: "Flash Express",
          tracking_number: "TH123456789",
        },
      ],
    };

    assert.equal(extractShopeeTrackingNo(raw), "TH123456789");
    assert.equal(extractShopeeCarrier(raw), "Flash Express");
  });

  it("maps common carriers into existing shipping methods", () => {
    assert.equal(mapShopeeCarrierToShippingMethod("KEX"), ShippingMethod.KERRY);
    assert.equal(mapShopeeCarrierToShippingMethod("J&T Express"), ShippingMethod.JT);
    assert.equal(mapShopeeCarrierToShippingMethod("EMS Thailand Post"), ShippingMethod.THAILAND_POST);
    assert.equal(mapShopeeCarrierToShippingMethod("Unknown Courier"), ShippingMethod.OTHER);
    assert.equal(mapShopeeCarrierToShippingMethod(null), ShippingMethod.NONE);
  });

  it("keeps ready orders pending and tracked orders out for delivery", () => {
    assert.equal(mapShopeeOrderStatusToShippingStatus("READY_TO_SHIP", null), ShippingStatus.PENDING);
    assert.equal(mapShopeeOrderStatusToShippingStatus("READY_TO_SHIP", "ABC"), ShippingStatus.OUT_FOR_DELIVERY);
    assert.equal(mapShopeeOrderStatusToShippingStatus("SHIPPED", null), ShippingStatus.OUT_FOR_DELIVERY);
    assert.equal(mapShopeeOrderStatusToShippingStatus("COMPLETED", null), ShippingStatus.DELIVERED);
  });
});

