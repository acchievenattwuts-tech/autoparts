"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface Tab {
  path: string;
  label: string;
}

interface TabStore {
  tabs: Tab[];
  addTab: (tab: Tab) => void;
  removeTab: (path: string) => void;
  clearAll: () => void;
}

export const useTabStore = create<TabStore>()(
  persist(
    (set) => ({
      tabs: [],
      addTab: (tab) =>
        set((state) => {
          const existingIndex = state.tabs.findIndex((t) => t.path === tab.path);
          if (existingIndex >= 0) {
            if (state.tabs[existingIndex]?.label === tab.label) return state;
            const nextTabs = [...state.tabs];
            nextTabs[existingIndex] = tab;
            return { tabs: nextTabs };
          }
          return { tabs: [...state.tabs, tab] };
        }),
      removeTab: (path) =>
        set((state) => ({ tabs: state.tabs.filter((t) => t.path !== path) })),
      clearAll: () => set({ tabs: [] }),
    }),
    {
      name: "admin-tabs",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? sessionStorage : ({} as Storage)
      ),
    }
  )
);
