export { buildOutOfStockProductsWhere } from "@/lib/out-of-stock-products";

export function buildOutOfStockProductsHref(): string {
  return "/admin/products?stockStatus=out_of_stock&statusFilter=active&trackingFilter=tracked";
}
