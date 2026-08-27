export const dynamic = "force-dynamic";
export const maxDuration = 200;

import MarketplaceSalePage from "../../_marketplace/MarketplaceSalePage";

export default async function Page() {
  return <MarketplaceSalePage channel="LAZADA" />;
}
