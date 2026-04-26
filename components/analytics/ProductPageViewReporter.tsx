"use client";

import { useEffect } from "react";
import { trackGoogleAnalyticsEvent } from "@/lib/google-analytics";
import {
  isStorefrontPath,
  isTrackedStorefrontHost,
  normalizeStorefrontPath,
} from "@/lib/storefront-visitor";

interface ProductPageViewReporterProps {
  productId: string;
  productName: string;
  productCode: string;
  categoryName: string;
  brandName?: string | null;
}

const ProductPageViewReporter = ({
  productId,
  productName,
  productCode,
  categoryName,
  brandName,
}: ProductPageViewReporterProps) => {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !isTrackedStorefrontHost(window.location.hostname) ||
      !isStorefrontPath(window.location.pathname)
    ) {
      return;
    }

    trackGoogleAnalyticsEvent("product_page_view", {
      product_id: productId,
      product_name: productName,
      product_code: productCode,
      item_category: categoryName,
      item_brand: brandName ?? undefined,
      page_path: normalizeStorefrontPath(window.location.pathname),
    });
  }, [brandName, categoryName, productCode, productId, productName]);

  return null;
};

export default ProductPageViewReporter;
