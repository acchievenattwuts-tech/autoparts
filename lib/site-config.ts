import { db } from "./db";
import { unstable_cache } from "next/cache";
import { cache } from "react";
import {
  PRODUCT_SEARCH_AUTO_APPLY_SYNONYMS_ENABLED_KEY,
  parseProductSearchAutoApplyEnabledSetting,
} from "@/lib/product-search-auto-apply";
import {
  LINE_AI_AUTO_REPLY_KEY,
  LINE_AI_DRY_RUN_KEY,
  LINE_AI_IMAGE_SEARCH_KEY,
  LINE_AI_SETTINGS_DEFAULTS,
  parseBoolSetting,
} from "@/lib/line-ai-settings";

export interface SiteConfig {
  shopName: string;
  shopSlogan: string;
  shopAddress: string;
  shopPhone: string;
  shopPhoneSecondary: string;
  shopEmail: string;
  shopLineId: string;
  shopLineUrl: string;
  shopLineQrUrl: string;
  shopLogoUrl: string;
  shopGoogleMapUrl: string;
  shopGoogleMapEmbedUrl: string;
  shopBusinessHours: string;
  shopHolidayNote: string;
  shopContactNote: string;
  heroTitle: string;
  heroSubtitle: string;
  shopWebsiteUrl: string;
  shopFacebookUrl: string;
  shopFacebookEnabled: boolean;
  shopTiktokUrl: string;
  shopTiktokEnabled: boolean;
  shopShopeeUrl: string;
  shopShopeeEnabled: boolean;
  shopLazadaUrl: string;
  shopLazadaEnabled: boolean;
  printNoticeText: string;
  vatType: string; // "NO_VAT" | "EXCLUDING_VAT" | "INCLUDING_VAT"
  vatRate: number; // e.g. 7
  deliveryCommissionPercent: number;
  productSearchAutoApplySynonymsEnabled: boolean;
  lineAiAutoReplyEnabled: boolean;
  lineAiDryRun: boolean;
  lineAiImageSearchEnabled: boolean;
}

export const defaultSiteConfig: SiteConfig = {
  shopName: "ศรีวรรณ อะไหล่แอร์",
  shopSlogan: "อะไหล่แอร์และหม้อน้ำรถยนต์ครบวงจร",
  shopAddress: "",
  shopPhone: "",
  shopPhoneSecondary: "",
  shopEmail: "",
  shopLineId: "",
  shopLineUrl: "",
  shopLineQrUrl: "",
  shopLogoUrl: "",
  shopGoogleMapUrl: "",
  shopGoogleMapEmbedUrl: "",
  shopBusinessHours: "จันทร์ - เสาร์ 08:00 - 18:00 น.",
  shopHolidayNote: "",
  shopContactNote: "",
  heroTitle: "ศรีวรรณ อะไหล่แอร์",
  heroSubtitle: "อะไหล่แอร์และหม้อน้ำรถยนต์ทุกยี่ห้อ คุณภาพดี ราคายุติธรรม",
  shopWebsiteUrl: "",
  shopFacebookUrl: "",
  shopFacebookEnabled: false,
  shopTiktokUrl: "",
  shopTiktokEnabled: false,
  shopShopeeUrl: "",
  shopShopeeEnabled: false,
  shopLazadaUrl: "",
  shopLazadaEnabled: false,
  printNoticeText: "",
  vatType: "NO_VAT",
  vatRate: 7,
  deliveryCommissionPercent: 30,
  productSearchAutoApplySynonymsEnabled: false,
  lineAiAutoReplyEnabled: LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled,
  lineAiDryRun: LINE_AI_SETTINGS_DEFAULTS.dryRun,
  lineAiImageSearchEnabled: LINE_AI_SETTINGS_DEFAULTS.imageSearchEnabled,
};

export const getSiteConfig = unstable_cache(
  async (): Promise<SiteConfig> => {
    const contents = await db.siteContent.findMany();
    const map = Object.fromEntries(contents.map((c) => [c.key, c.value]));

    return {
      shopName: map["shop_name"] ?? defaultSiteConfig.shopName,
      shopSlogan: map["shop_slogan"] ?? defaultSiteConfig.shopSlogan,
      shopAddress: map["shop_address"] ?? defaultSiteConfig.shopAddress,
      shopPhone: map["shop_phone"] ?? defaultSiteConfig.shopPhone,
      shopPhoneSecondary: map["shop_phone_secondary"] ?? defaultSiteConfig.shopPhoneSecondary,
      shopEmail: map["shop_email"] ?? defaultSiteConfig.shopEmail,
      shopLineId: map["shop_line_id"] ?? defaultSiteConfig.shopLineId,
      shopLineUrl: map["shop_line_url"] ?? defaultSiteConfig.shopLineUrl,
      shopLineQrUrl: map["shop_line_qr_url"] ?? defaultSiteConfig.shopLineQrUrl,
      shopLogoUrl: map["shop_logo_url"] ?? defaultSiteConfig.shopLogoUrl,
      shopGoogleMapUrl: map["shop_google_map_url"] ?? defaultSiteConfig.shopGoogleMapUrl,
      shopGoogleMapEmbedUrl: map["shop_google_map_embed_url"] ?? defaultSiteConfig.shopGoogleMapEmbedUrl,
      shopBusinessHours: map["shop_business_hours"] ?? defaultSiteConfig.shopBusinessHours,
      shopHolidayNote: map["shop_holiday_note"] ?? defaultSiteConfig.shopHolidayNote,
      shopContactNote: map["shop_contact_note"] ?? defaultSiteConfig.shopContactNote,
      heroTitle: map["hero_title"] ?? defaultSiteConfig.heroTitle,
      heroSubtitle: map["hero_subtitle"] ?? defaultSiteConfig.heroSubtitle,
      shopWebsiteUrl: map["shop_website_url"] ?? defaultSiteConfig.shopWebsiteUrl,
      shopFacebookUrl: map["shop_facebook_url"] ?? defaultSiteConfig.shopFacebookUrl,
      shopFacebookEnabled: map["shop_facebook_enabled"] === "true",
      shopTiktokUrl: map["shop_tiktok_url"] ?? defaultSiteConfig.shopTiktokUrl,
      shopTiktokEnabled: map["shop_tiktok_enabled"] === "true",
      shopShopeeUrl: map["shop_shopee_url"] ?? defaultSiteConfig.shopShopeeUrl,
      shopShopeeEnabled: map["shop_shopee_enabled"] === "true",
      shopLazadaUrl: map["shop_lazada_url"] ?? defaultSiteConfig.shopLazadaUrl,
      shopLazadaEnabled: map["shop_lazada_enabled"] === "true",
      printNoticeText: map["print_notice_text"] ?? defaultSiteConfig.printNoticeText,
      vatType: map["vat_type"] ?? defaultSiteConfig.vatType,
      vatRate: Number(map["vat_rate"] ?? defaultSiteConfig.vatRate),
      deliveryCommissionPercent: Number(
        map["delivery_commission_percent"] ?? defaultSiteConfig.deliveryCommissionPercent,
      ),
      productSearchAutoApplySynonymsEnabled: parseProductSearchAutoApplyEnabledSetting(
        map[PRODUCT_SEARCH_AUTO_APPLY_SYNONYMS_ENABLED_KEY],
      ),
      lineAiAutoReplyEnabled: parseBoolSetting(
        map[LINE_AI_AUTO_REPLY_KEY],
        LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled,
      ),
      lineAiDryRun: parseBoolSetting(map[LINE_AI_DRY_RUN_KEY], LINE_AI_SETTINGS_DEFAULTS.dryRun),
      lineAiImageSearchEnabled: parseBoolSetting(
        map[LINE_AI_IMAGE_SEARCH_KEY],
        LINE_AI_SETTINGS_DEFAULTS.imageSearchEnabled,
      ),
    };
  },
  ["site-config"],
  { tags: ["site-config"] }
);

export const getPublicSiteConfig = cache(async (): Promise<SiteConfig> => {
  try {
    return await getSiteConfig();
  } catch (error) {
    console.warn("Falling back to default public site config", error);
    return defaultSiteConfig;
  }
});
