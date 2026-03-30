export const SHIPPING_STATUS_LABEL: Record<string, string> = {
  PENDING:          "รอจัดส่ง",
  OUT_FOR_DELIVERY: "กำลังส่ง",
  DELIVERED:        "ส่งแล้ว",
};

export const SHIPPING_STATUS_BADGE: Record<string, string> = {
  PENDING:          "bg-yellow-100 text-yellow-700",
  OUT_FOR_DELIVERY: "bg-blue-100 text-blue-700",
  DELIVERED:        "bg-green-100 text-green-700",
};

export const SHIPPING_METHOD_LABEL: Record<string, string> = {
  NONE:  "-",
  SELF:  "ส่งเอง",
  KERRY: "Kerry",
  FLASH: "Flash",
  JT:    "J&T",
  OTHER: "อื่นๆ",
};

/** For select/dropdown UI — NONE shows "ไม่ระบุ" instead of "-" */
export const SHIPPING_METHOD_OPTIONS: Record<string, string> = {
  NONE:  "ไม่ระบุ",
  SELF:  "ส่งเอง",
  KERRY: "Kerry",
  FLASH: "Flash",
  JT:    "J&T",
  OTHER: "อื่นๆ",
};
