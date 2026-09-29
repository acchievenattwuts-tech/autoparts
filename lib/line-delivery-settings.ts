export const LINE_DELIVERY_NOTIFICATIONS_KEY = "line_delivery_notifications_enabled";
export const LINE_DELIVERY_NOTIFICATIONS_DISABLED_AT_KEY = "line_delivery_notifications_disabled_at";

// Opt-in only: absent, malformed and legacy settings must never send cards.
export const parseLineDeliveryNotificationsEnabled = (value: string | null | undefined): boolean =>
  value === "true";
