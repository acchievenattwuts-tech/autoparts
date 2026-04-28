"use client";

import { useEffect } from "react";

type ShortcutOptions = {
  key: string;
  withMod?: boolean;
  force?: boolean;
  enabled?: boolean;
  onTrigger: (event: KeyboardEvent) => void;
};

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const matchesShortcutKey = (event: KeyboardEvent, key: string): boolean => {
  const normalizedKey = normalizeKey(key);
  const eventKey = normalizeKey(event.key);

  if (eventKey === normalizedKey) return true;

  // Use the physical key position for single-character shortcuts so they still
  // work when the active keyboard layout changes (for example Thai vs English).
  if (/^[a-z0-9]$/.test(normalizedKey)) {
    return event.code.toLowerCase() === `key${normalizedKey}` || event.code.toLowerCase() === `digit${normalizedKey}`;
  }

  return false;
};

const detectIsMac = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const platform = navigator.platform ?? "";
  if (platform) return /Mac|iPod|iPhone|iPad/.test(platform);
  return /Mac|iPod|iPhone|iPad/.test(navigator.userAgent ?? "");
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
};

export const useGlobalShortcut = ({
  key,
  withMod = true,
  force = false,
  enabled = true,
  onTrigger,
}: ShortcutOptions): void => {
  useEffect(() => {
    if (!enabled) return;
    const isMac = detectIsMac();

    const handler = (event: KeyboardEvent): void => {
      if (!matchesShortcutKey(event, key)) return;
      if (withMod) {
        const modPressed = isMac ? event.metaKey : event.ctrlKey;
        if (!modPressed) return;
      }
      if (!force && isEditableTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      onTrigger(event);
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, force, key, onTrigger, withMod]);
};

export const getPlatformShortcutLabel = (key: string): string => {
  if (typeof window === "undefined") return `Ctrl+${key.toUpperCase()}`;
  return detectIsMac() ? `⌘${key.toUpperCase()}` : `Ctrl+${key.toUpperCase()}`;
};
