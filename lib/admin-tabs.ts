const ADMIN_TAB_PATH_ALIASES: Record<string, string> = {
  "/admin": "/admin/workboard",
};

export function normalizeAdminTabPath(path: string): string {
  return ADMIN_TAB_PATH_ALIASES[path] ?? path;
}
