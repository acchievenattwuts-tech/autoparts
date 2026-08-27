export const dynamic = "force-dynamic";
export const maxDuration = 200;

import MarketplaceReturnPage from "../../../_marketplace/MarketplaceReturnPage";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ saleId?: string }>;
}) {
  const { saleId } = await searchParams;
  return <MarketplaceReturnPage channel="SHOPEE" saleId={saleId} />;
}
