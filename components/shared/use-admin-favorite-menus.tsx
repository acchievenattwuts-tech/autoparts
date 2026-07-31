"use client";

import { useCallback, useState, useTransition } from "react";

import { reorderFavoriteMenus, toggleFavoriteMenu } from "@/app/admin/(protected)/favorite-menu-actions";

export type FavoriteMenusController = {
  favorites: string[];
  isFavorite: (href: string) => boolean;
  isPending: boolean;
  error: string | null;
  toggle: (href: string) => void;
  move: (href: string, direction: "up" | "down") => void;
};

/** สลับตำแหน่งสองรายการในลิสต์ — คืนลิสต์ใหม่ (ไม่แก้ของเดิม) */
const swap = (items: string[], from: number, to: number): string[] => {
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
};

/**
 * จัดการเมนูโปรดของผู้ใช้ที่ล็อกอินอยู่ — อัปเดต UI ทันที (optimistic)
 * แล้วบันทึกลง DB; ถ้าล้มเหลวจะย้อนกลับค่าเดิมพร้อมข้อความภาษาไทย
 */
export const useAdminFavoriteMenus = (initialFavorites: string[]): FavoriteMenusController => {
  const [favorites, setFavorites] = useState<string[]>(initialFavorites);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const runUpdate = useCallback(
    (optimistic: string[], persist: () => Promise<{ favorites?: string[]; error?: string }>) => {
      const previous = favorites;
      setFavorites(optimistic);
      setError(null);
      startTransition(async () => {
        const result = await persist();
        if (result.error) {
          setFavorites(result.favorites ?? previous);
          setError(result.error);
          return;
        }
        if (result.favorites) setFavorites(result.favorites);
      });
    },
    [favorites],
  );

  const toggle = useCallback(
    (href: string) => {
      const optimistic = favorites.includes(href)
        ? favorites.filter((item) => item !== href)
        : [...favorites, href];
      runUpdate(optimistic, () => toggleFavoriteMenu(href));
    },
    [favorites, runUpdate],
  );

  const move = useCallback(
    (href: string, direction: "up" | "down") => {
      const index = favorites.indexOf(href);
      const target = direction === "up" ? index - 1 : index + 1;
      if (index < 0 || target < 0 || target >= favorites.length) return;
      const optimistic = swap(favorites, index, target);
      runUpdate(optimistic, () => reorderFavoriteMenus(optimistic));
    },
    [favorites, runUpdate],
  );

  const isFavorite = useCallback((href: string) => favorites.includes(href), [favorites]);

  return { favorites, isFavorite, isPending, error, toggle, move };
};
