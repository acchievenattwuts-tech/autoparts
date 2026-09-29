import type { DeliveryLineEvent } from "@/lib/line-delivery-card";

export type DeliveryNotificationSale = {
  status: string; fulfillmentType: string; shippingMethod: string; shippingStatus: string;
  customerId: string | null;
  customer: { id: string; isActive: boolean; lineUserId: string | null; lineLinkedAt: Date | null; phone: string | null } | null;
};

export const getDeliveryNotificationSkipReason = (input: {
  enabled: boolean; sale: DeliveryNotificationSale; eventStatus: DeliveryLineEvent;
  customerId?: string | null; recipientLineUserId?: string | null;
}): string | null => {
  const { sale } = input;
  if (!input.enabled) return "SETTING_DISABLED";
  if (sale.status !== "ACTIVE") return "SALE_INACTIVE";
  if (sale.fulfillmentType !== "DELIVERY" || sale.shippingMethod !== "SELF") return "NOT_SELF_DELIVERY";
  if (!sale.customerId || !sale.customer?.isActive || !sale.customer.lineUserId || !sale.customer.lineLinkedAt || !sale.customer.phone) {
    return "CUSTOMER_NOT_LINKED";
  }
  if (input.customerId !== undefined && (sale.customerId !== input.customerId || sale.customer.lineUserId !== input.recipientLineUserId)) {
    return "RECIPIENT_CHANGED";
  }
  if (sale.shippingStatus !== input.eventStatus) return "STALE_STATUS";
  return null;
};
