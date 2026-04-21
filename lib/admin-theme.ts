export type AdminTheme = "light" | "dark";

export const DEFAULT_ADMIN_THEME: AdminTheme = "light";
export const ADMIN_THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isAdminTheme(value: string | null | undefined): value is AdminTheme {
  return value === "light" || value === "dark";
}

export function parseAdminTheme(value: string | null | undefined): AdminTheme {
  return isAdminTheme(value) ? value : DEFAULT_ADMIN_THEME;
}

export function getAdminThemeCookieName(userId: string): string {
  return `admin-theme-${userId}`;
}
