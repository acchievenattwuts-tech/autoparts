import { unstable_cache } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  CATEGORY_ICON_OPTIONS,
  CATEGORY_MOTION_OPTIONS,
  CATEGORY_TONE_OPTIONS,
  CATEGORY_VISUAL_SITE_CONTENT_KEY,
  normalizeCategoryVisualSetting,
  type CategoryVisualSetting,
} from "@/lib/category-visual-config";

const iconKeys = CATEGORY_ICON_OPTIONS.map((option) => option.key) as [
  (typeof CATEGORY_ICON_OPTIONS)[number]["key"],
  ...(typeof CATEGORY_ICON_OPTIONS)[number]["key"][],
];
const toneKeys = CATEGORY_TONE_OPTIONS.map((option) => option.key) as [
  (typeof CATEGORY_TONE_OPTIONS)[number]["key"],
  ...(typeof CATEGORY_TONE_OPTIONS)[number]["key"][],
];
const motionKeys = CATEGORY_MOTION_OPTIONS.map((option) => option.key) as [
  (typeof CATEGORY_MOTION_OPTIONS)[number]["key"],
  ...(typeof CATEGORY_MOTION_OPTIONS)[number]["key"][],
];

export const categoryVisualInputSchema = z.object({
  iconKey: z.enum(iconKeys),
  toneKey: z.enum(toneKeys),
  motionKey: z.enum(motionKeys),
});

const categoryVisualMapSchema = z.record(
  z.string(),
  categoryVisualInputSchema.partial(),
);

const readCategoryVisualSettings = async (): Promise<Record<string, CategoryVisualSetting>> => {
  const row = await db.siteContent.findUnique({
    where: { key: CATEGORY_VISUAL_SITE_CONTENT_KEY },
    select: { value: true },
  });

  if (!row?.value) {
    return {};
  }

  try {
    const parsedJson: unknown = JSON.parse(row.value);
    const parsed = categoryVisualMapSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed.data).map(([categoryId, visual]) => [
        categoryId,
        normalizeCategoryVisualSetting(visual),
      ]),
    );
  } catch {
    return {};
  }
};

export const getCategoryVisualSettings = unstable_cache(
  readCategoryVisualSettings,
  ["category-visual-settings"],
  { tags: ["storefront:categories"] },
);

export const saveCategoryVisualSetting = async (
  categoryId: string,
  visual: CategoryVisualSetting,
): Promise<void> => {
  const current = await readCategoryVisualSettings();
  const next = {
    ...current,
    [categoryId]: normalizeCategoryVisualSetting(visual),
  };

  await db.siteContent.upsert({
    where: { key: CATEGORY_VISUAL_SITE_CONTENT_KEY },
    update: { value: JSON.stringify(next) },
    create: { key: CATEGORY_VISUAL_SITE_CONTENT_KEY, value: JSON.stringify(next) },
  });
};
