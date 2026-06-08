import type { ReactNode } from "react";

export type AdminNotificationSection = {
  key: string;
  title: string;
  description?: string;
  unreadCount: number;
  summaryError: boolean;
  markAllLabel?: string;
  onMarkAllRead?: (() => void) | null;
  isMarkAllDisabled?: boolean;
  content: ReactNode;
};
