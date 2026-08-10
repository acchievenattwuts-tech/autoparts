/**
 * Icon vocabulary for category tiles.
 *
 * There is no admin setting behind this any more: the icon/tone/motion for a
 * category is inferred from its name, and it is only ever a last-resort fallback
 * for a category that has neither an uploaded thumbnail nor a photographed
 * product. Keeping it inferred means one less DB read on every storefront render.
 */

export const CATEGORY_ICON_OPTIONS = [
  { key: "compressor", label: "คอมเพรสเซอร์", keywords: ["compressor", "คอมเพรส", "คลัทช์"] },
  { key: "evaporator", label: "คอยล์เย็น", keywords: ["evaporator", "คอยล์เย็น", "ตู้"] },
  { key: "condenser", label: "คอยล์ร้อน", keywords: ["condenser", "คอยล์ร้อน", "แผง"] },
  { key: "radiator", label: "หม้อน้ำ", keywords: ["radiator", "หม้อน้ำ"] },
  { key: "blower", label: "โบเวอร์", keywords: ["blower", "โบเวอร์", "พัดลม"] },
  { key: "valve", label: "วาล์ว", keywords: ["valve", "วาล์ว", "expansion"] },
  { key: "dryer", label: "ดรายเออร์", keywords: ["dryer", "drier", "ดราย"] },
  {
    key: "wrench",
    label: "เครื่องมือ/อะไหล่ทั่วไป",
    keywords: ["อะไหล่อื่น", "อื่น", "ท่อ", "สายแอร์", "hose", "pipe", "tool"],
  },
  { key: "droplets", label: "น้ำยา/ของเหลว", keywords: ["น้ำยา", "oil", "fluid"] },
  { key: "gear", label: "เฟือง/ทั่วไป", keywords: [] },
] as const;

export const CATEGORY_TONE_OPTIONS = [
  { key: "neutral", label: "เทากลาง" },
  { key: "ice", label: "ฟ้าเย็น" },
  { key: "heat", label: "ส้มร้อน" },
  { key: "water", label: "แดงหม้อน้ำ" },
  { key: "electric", label: "เหลืองไฟฟ้า" },
  { key: "air", label: "เขียวลม" },
] as const;

export const CATEGORY_MOTION_OPTIONS = [
  { key: "lift", label: "ยกขึ้นเบาๆ" },
  { key: "spin", label: "หมุน" },
  { key: "breeze", label: "เลื่อนลม" },
  { key: "pulse", label: "ขยายเล็กน้อย" },
  { key: "heat", label: "สั่นร้อน" },
  { key: "swing", label: "โยกเครื่องมือ" },
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_OPTIONS)[number]["key"];
export type CategoryToneKey = (typeof CATEGORY_TONE_OPTIONS)[number]["key"];
export type CategoryMotionKey = (typeof CATEGORY_MOTION_OPTIONS)[number]["key"];

export type CategoryVisualSetting = {
  iconKey: CategoryIconKey;
  toneKey: CategoryToneKey;
  motionKey: CategoryMotionKey;
};

export const DEFAULT_CATEGORY_VISUAL: CategoryVisualSetting = {
  iconKey: "gear",
  toneKey: "neutral",
  motionKey: "lift",
};

export const inferCategoryVisual = (input: {
  name: string;
  slug?: string | null;
}): CategoryVisualSetting => {
  const haystack = `${input.slug ?? ""} ${input.name}`.toLowerCase();
  const iconOption = CATEGORY_ICON_OPTIONS.find((option) =>
    option.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())),
  );

  switch (iconOption?.key) {
    case "evaporator":
      return { iconKey: "evaporator", toneKey: "ice", motionKey: "breeze" };
    case "condenser":
      return { iconKey: "condenser", toneKey: "heat", motionKey: "heat" };
    case "radiator":
      return { iconKey: "radiator", toneKey: "water", motionKey: "pulse" };
    case "blower":
      return { iconKey: "blower", toneKey: "air", motionKey: "spin" };
    case "valve":
      return { iconKey: "valve", toneKey: "electric", motionKey: "pulse" };
    case "dryer":
      return { iconKey: "dryer", toneKey: "neutral", motionKey: "lift" };
    case "compressor":
      return { iconKey: "compressor", toneKey: "neutral", motionKey: "spin" };
    case "droplets":
      return { iconKey: "droplets", toneKey: "ice", motionKey: "breeze" };
    case "wrench":
      return { iconKey: "wrench", toneKey: "neutral", motionKey: "swing" };
    default:
      return DEFAULT_CATEGORY_VISUAL;
  }
};
