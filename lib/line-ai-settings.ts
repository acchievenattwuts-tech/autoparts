import { db } from "@/lib/db";

/**
 * Runtime toggles for the LINE OA AI agent. These are stored in the SiteContent
 * key-value table and managed from the admin shop-settings page (no longer env
 * vars), so admins can flip them without a redeploy.
 */
export const LINE_AI_AUTO_REPLY_KEY = "line_ai_auto_reply_enabled";
export const LINE_AI_DRY_RUN_KEY = "line_ai_dry_run";
export const LINE_AI_IMAGE_SEARCH_KEY = "line_ai_image_search_enabled";

export type LineAiSettings = {
  autoReplyEnabled: boolean;
  dryRun: boolean;
  imageSearchEnabled: boolean;
};

/** Safe defaults when no row exists yet: AI off, and dry-run on if later enabled. */
export const LINE_AI_SETTINGS_DEFAULTS: LineAiSettings = {
  autoReplyEnabled: false,
  dryRun: true,
  imageSearchEnabled: false,
};

export function parseBoolSetting(value: string | undefined | null, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return value.trim().toLowerCase() === "true";
}

/**
 * Reads the current AI toggles directly (uncached) so admin changes take effect
 * on the very next inbound LINE event without waiting for cache revalidation.
 */
export async function getLineAiSettings(): Promise<LineAiSettings> {
  const rows = await db.siteContent.findMany({
    where: { key: { in: [LINE_AI_AUTO_REPLY_KEY, LINE_AI_DRY_RUN_KEY, LINE_AI_IMAGE_SEARCH_KEY] } },
    select: { key: true, value: true },
  });
  const map = Object.fromEntries(rows.map((row) => [row.key, row.value]));

  return {
    autoReplyEnabled: parseBoolSetting(map[LINE_AI_AUTO_REPLY_KEY], LINE_AI_SETTINGS_DEFAULTS.autoReplyEnabled),
    dryRun: parseBoolSetting(map[LINE_AI_DRY_RUN_KEY], LINE_AI_SETTINGS_DEFAULTS.dryRun),
    imageSearchEnabled: parseBoolSetting(
      map[LINE_AI_IMAGE_SEARCH_KEY],
      LINE_AI_SETTINGS_DEFAULTS.imageSearchEnabled,
    ),
  };
}
