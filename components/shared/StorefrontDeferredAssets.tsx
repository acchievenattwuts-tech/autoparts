import DeferredAnalytics from "@/components/analytics/DeferredAnalytics";
import DeferredFloatingLine from "@/components/shared/DeferredFloatingLine";

interface StorefrontDeferredAssetsProps {
  lineUrl?: string;
}

const StorefrontDeferredAssets = ({ lineUrl }: StorefrontDeferredAssetsProps) => {
  return (
    <>
      <DeferredAnalytics />
      {/* Keep the floating CTA on public storefront pages because content pages
          still feed the LINE/phone handoff flow. */}
      <DeferredFloatingLine lineUrl={lineUrl} />
    </>
  );
};

export default StorefrontDeferredAssets;
