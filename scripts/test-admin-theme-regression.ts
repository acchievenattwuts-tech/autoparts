import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..");

function readRepoFile(relativePath: string) {
  return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function expectIncludes(source: string, needle: string, message: string) {
  assert.ok(source.includes(needle), message);
}

function expectExcludes(source: string, needle: string, message: string) {
  assert.ok(!source.includes(needle), message);
}

function runAdminThemeRegressionChecks() {
  const adminShell = readRepoFile("components/shared/AdminShell.tsx");
  const adminThemeProvider = readRepoFile("components/shared/AdminThemeProvider.tsx");
  const adminLayout = readRepoFile("app/admin/(protected)/layout.tsx");
  const adminThemeLib = readRepoFile("lib/admin-theme.ts");
  const globalsCss = readRepoFile("app/globals.css");
  const searchableSelect = readRepoFile("components/shared/SearchableSelect.tsx");
  const productSearchSelect = readRepoFile("components/shared/ProductSearchSelect.tsx");
  const loginPage = readRepoFile("app/admin/login/page.tsx");
  const loginForm = readRepoFile("app/admin/login/LoginForm.tsx");

  expectIncludes(adminShell, "AdminThemeToggle", "Admin shell must keep the top-right theme toggle");
  expectIncludes(adminShell, "admin-theme-root", "Admin shell must keep the admin theme root wrapper");
  expectIncludes(adminThemeProvider, "useOptionalAdminTheme", "Theme provider must expose the optional theme hook");
  expectIncludes(
    adminThemeProvider,
    "document.body.dataset.adminTheme = theme",
    "Theme provider must write the active admin theme to document.body",
  );
  expectIncludes(adminLayout, "getAdminThemeCookieName", "Protected admin layout must read the theme cookie");
  expectIncludes(adminLayout, "parseAdminTheme", "Protected admin layout must parse the initial admin theme");
  expectIncludes(adminThemeLib, "admin-theme-", "Theme cookie naming must remain user-scoped");
  expectIncludes(
    globalsCss,
    '.admin-theme-root[data-admin-theme="dark"]',
    "Global CSS must include the admin dark-mode root selector",
  );
  expectIncludes(
    globalsCss,
    'body[data-admin-theme="dark"]',
    "Global CSS must include the body-based dark-mode selector for portal surfaces",
  );
  expectIncludes(searchableSelect, "useOptionalAdminTheme", "SearchableSelect must stay theme-aware for portal dropdowns");
  expectIncludes(searchableSelect, "createPortal", "SearchableSelect must remain portal-based");
  expectIncludes(
    productSearchSelect,
    "useOptionalAdminTheme",
    "ProductSearchSelect must stay theme-aware for portal dropdowns",
  );
  expectIncludes(productSearchSelect, "createPortal", "ProductSearchSelect must remain portal-based");
  expectExcludes(loginPage, "AdminThemeToggle", "Admin login page must not import the admin theme toggle");
  expectExcludes(loginForm, "AdminThemeToggle", "Admin login form must not render the admin theme toggle");
}

runAdminThemeRegressionChecks();

console.log("Admin theme regression checks passed");
