import Image from "next/image";

import {
  PRINT_SECTION_BORDER_CLASS,
  PRINT_SECTION_BOTTOM_BORDER_CLASS,
  type PrintShopConfig,
} from "./shared";

const PrintDocumentHeader = ({
  shopConfig,
  title,
  pageLabel = "หน้า 1/1",
}: {
  shopConfig: PrintShopConfig;
  title: string;
  pageLabel?: string;
}) => (
  <div className={`mb-4 flex items-start justify-between ${PRINT_SECTION_BOTTOM_BORDER_CLASS} pb-3`}>
    <div className="flex items-start gap-3">
      {shopConfig.shopLogoUrl ? (
        <div className="relative h-14 w-14 shrink-0 overflow-hidden">
          <Image src={shopConfig.shopLogoUrl} alt="Shop logo" fill className="object-contain" sizes="56px" />
        </div>
      ) : null}
      <div className="space-y-0.5 text-xs text-gray-600">
        {shopConfig.shopName ? <p className="text-sm font-semibold text-gray-800">{shopConfig.shopName}</p> : null}
        {shopConfig.shopAddress ? <p>{shopConfig.shopAddress}</p> : null}
        {shopConfig.shopPhone ? <p>โทร: {shopConfig.shopPhone}</p> : null}
        {shopConfig.shopWebsiteUrl || shopConfig.shopLineId ? (
          <p>
            {[shopConfig.shopWebsiteUrl, shopConfig.shopLineId ? `Line: ${shopConfig.shopLineId}` : null]
              .filter(Boolean)
              .join("  |  ")}
          </p>
        ) : null}
      </div>
    </div>
    <div className="text-right">
      <p className={`inline-block ${PRINT_SECTION_BORDER_CLASS} px-6 py-1.5 text-base font-bold`}>{title}</p>
      <p className="mt-1 text-xs text-gray-400">{pageLabel}</p>
    </div>
  </div>
);

export default PrintDocumentHeader;
