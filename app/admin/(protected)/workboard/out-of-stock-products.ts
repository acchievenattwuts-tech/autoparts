export function buildOutOfStockProductsWhere() {
  return {
    isActive: true,
    inventoryTracking: "TRACKED" as const,
    stock: 0,
  };
}

export function buildOutOfStockProductsHref(): string {
  return "/admin/products?stockStatus=out_of_stock&statusFilter=active&trackingFilter=tracked";
}
