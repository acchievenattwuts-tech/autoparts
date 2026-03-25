import { db } from "./db";
import { unstable_cache } from "next/cache";

export interface SiteConfig {
  shopName: string;
  shopSlogan: string;
  shopAddress: string;
  shopPhone: string;
  shopEmail: string;
  shopLineId: string;
  shopLineUrl: string;
  shopLogoUrl: string;
  heroTitle: string;
  heroSubtitle: string;
  shopFacebookUrl: string;
  shopFacebookEnabled: boolean;
  shopTiktokUrl: string;
  shopTiktokEnabled: boolean;
  shopShopeeUrl: string;
  shopShopeeEnabled: boolean;
  shopLazadaUrl: string;
  shopLazadaEnabled: boolean;
  vatType: string; // "NO_VAT" | "EXCLUDING_VAT" | "INCLUDING_VAT"
  vatRate: number; // e.g. 7
}

const defaultConfig: SiteConfig = {
  shopName: "ศรีวรรณ อะไหล่แอร์",
  shopSlogan: "อะไหล่แอร์และหม้อน้ำรถยนต์ครบวงจร",
  shopAddress: "",
  shopPhone: "",
  shopEmail: "",
  shopLineId: "@435adwz",
  shopLineUrl: "https://lin.ee/18P0SqG",
  shopLogoUrl: "",
  heroTitle: "ศรีวรรณ อะไหล่แอร์",
  heroSubtitle: "อะไหล่แอร์และหม้อน้ำรถยนต์ทุกยี่ห้อ คุณภาพดี ราคายุติธรรม",
  shopFacebookUrl: "",
  shopFacebookEnabled: false,
  shopTiktokUrl: "",
  shopTiktokEnabled: false,
  shopShopeeUrl: "",
  shopShopeeEnabled: false,
  shopLazadaUrl: "",
  shopLazadaEnabled: false,
  vatType: "NO_VAT",
  vatRate: 7,
};

export const getSiteConfig = unstable_cache(
  async (): Promise<SiteConfig> => {
    const contents = await db.siteContent.findMany();
    const map = Object.fromEntries(contents.map((c) => [c.key, c.value]));

    return {
      shopName: map["shop_name"] ?? defaultConfig.shopName,
      shopSlogan: map["shop_slogan"] ?? defaultConfig.shopSlogan,
      shopAddress: map["shop_address"] ?? defaultConfig.shopAddress,
      shopPhone: map["shop_phone"] ?? defaultConfig.shopPhone,
      shopEmail: map["shop_email"] ?? defaultConfig.shopEmail,
      shopLineId: map["shop_line_id"] ?? defaultConfig.shopLineId,
      shopLineUrl: map["shop_line_url"] ?? defaultConfig.shopLineUrl,
      shopLogoUrl: map["shop_logo_url"] ?? defaultConfig.shopLogoUrl,
      heroTitle: map["hero_title"] ?? defaultConfig.heroTitle,
      heroSubtitle: map["hero_subtitle"] ?? defaultConfig.heroSubtitle,
      shopFacebookUrl: map["shop_facebook_url"] ?? defaultConfig.shopFacebookUrl,
      shopFacebookEnabled: map["shop_facebook_enabled"] === "true",
      shopTiktokUrl: map["shop_tiktok_url"] ?? defaultConfig.shopTiktokUrl,
      shopTiktokEnabled: map["shop_tiktok_enabled"] === "true",
      shopShopeeUrl: map["shop_shopee_url"] ?? defaultConfig.shopShopeeUrl,
      shopShopeeEnabled: map["shop_shopee_enabled"] === "true",
      shopLazadaUrl: map["shop_lazada_url"] ?? defaultConfig.shopLazadaUrl,
      shopLazadaEnabled: map["shop_lazada_enabled"] === "true",
      vatType: map["vat_type"] ?? defaultConfig.vatType,
      vatRate: Number(map["vat_rate"] ?? defaultConfig.vatRate),
    };
  },
  ["site-config"],
  { tags: ["site-config"] }
);
