"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import {
  ADMIN_THEME_COOKIE_MAX_AGE,
  type AdminTheme,
  getAdminThemeCookieName,
} from "@/lib/admin-theme";

type AdminThemeContextValue = {
  isDark: boolean;
  theme: AdminTheme;
  setTheme: (nextTheme: AdminTheme) => void;
  toggleTheme: () => void;
};

const AdminThemeContext = createContext<AdminThemeContextValue | null>(null);

function persistAdminTheme(userId: string, theme: AdminTheme) {
  if (typeof document === "undefined") {
    return;
  }

  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie =
    `${getAdminThemeCookieName(userId)}=${theme}; path=/; max-age=${ADMIN_THEME_COOKIE_MAX_AGE}; samesite=lax${secure}`;
}

export function AdminThemeProvider({
  children,
  initialTheme,
  userId,
}: {
  children: ReactNode;
  initialTheme: AdminTheme;
  userId: string;
}) {
  const [theme, setThemeState] = useState<AdminTheme>(initialTheme);

  useEffect(() => {
    document.body.dataset.adminTheme = theme;
    document.documentElement.style.colorScheme = theme;

    return () => {
      delete document.body.dataset.adminTheme;
      document.documentElement.style.colorScheme = "";
    };
  }, [theme]);

  const setTheme = (nextTheme: AdminTheme) => {
    setThemeState(nextTheme);
    persistAdminTheme(userId, nextTheme);
  };

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    setTheme(nextTheme);
  };

  return (
    <AdminThemeContext.Provider
      value={{
        isDark: theme === "dark",
        theme,
        setTheme,
        toggleTheme,
      }}
    >
      {children}
    </AdminThemeContext.Provider>
  );
}

export function useAdminTheme() {
  const context = useOptionalAdminTheme();

  if (!context) {
    throw new Error("useAdminTheme must be used within AdminThemeProvider");
  }

  return context;
}

export function useOptionalAdminTheme() {
  return useContext(AdminThemeContext);
}

export default AdminThemeProvider;
