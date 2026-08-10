import DeferredAnalytics from "@/components/analytics/DeferredAnalytics";
import DeferredFloatingLine from "@/components/shared/DeferredFloatingLine";

interface StorefrontDeferredAssetsProps {
  lineUrl?: string;
  shopPhone?: string;
}

const StorefrontDeferredAssets = ({ lineUrl, shopPhone }: StorefrontDeferredAssetsProps) => {
  return (
    <>
      <DeferredAnalytics />
      {/* Keep the floating CTA on public storefront pages because content pages
          still feed the LINE/phone handoff flow. */}
      <DeferredFloatingLine lineUrl={lineUrl} shopPhone={shopPhone} />
    </>
  );
};

export default StorefrontDeferredAssets;
