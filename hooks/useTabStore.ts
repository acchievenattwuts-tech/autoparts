"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

import { normalizeAdminTabPath } from "@/lib/admin-tabs";

export interface Tab {
  path: string;
  label: string;
}

function normalizeTab(tab: Tab): Tab {
  return {
    ...tab,
    path: normalizeAdminTabPath(tab.path),
  };
}

function mergeUniqueTabs(tabs: Tab[]): Tab[] {
  const merged = new Map<string, Tab>();

  for (const tab of tabs) {
    const normalizedTab = normalizeTab(tab);
    merged.set(normalizedTab.path, normalizedTab);
  }

  return Array.from(merged.values());
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
          const normalizedTab = normalizeTab(tab);
          const existingIndex = state.tabs.findIndex((t) => t.path === normalizedTab.path);
          if (existingIndex >= 0) {
            if (state.tabs[existingIndex]?.label === normalizedTab.label) return state;
            const nextTabs = [...state.tabs];
            nextTabs[existingIndex] = normalizedTab;
            return { tabs: nextTabs };
          }
          return { tabs: [...state.tabs, normalizedTab] };
        }),
      removeTab: (path) =>
        set((state) => {
          const normalizedPath = normalizeAdminTabPath(path);
          return { tabs: state.tabs.filter((t) => t.path !== normalizedPath) };
        }),
      clearAll: () => set({ tabs: [] }),
    }),
    {
      name: "admin-tabs",
      storage: createJSONStorage(() =>
        typeof window !== "undefined" ? sessionStorage : ({} as Storage)
      ),
      merge: (persistedState, currentState) => {
        const typedState = persistedState as Partial<TabStore> | undefined;

        return {
          ...currentState,
          ...typedState,
          tabs: mergeUniqueTabs(typedState?.tabs ?? []),
        };
      },
    }
  )
);
