export const PRODUCT_FITMENT_TYPES = ["DIRECT", "COMPATIBLE"] as const;

export type ProductFitmentTypeValue = (typeof PRODUCT_FITMENT_TYPES)[number];

export type ProductFitmentFormRow = {
  carModelId: string;
  submodel: string | null;
  yearStart: number | null;
  yearEnd: number | null;
  engineCode: string | null;
  engineSize: string | null;
  note: string | null;
};

export const createEmptyProductFitmentRow = (): ProductFitmentFormRow => ({
  carModelId: "",
  submodel: null,
  yearStart: null,
  yearEnd: null,
  engineCode: null,
  engineSize: null,
  note: null,
});

export const normalizeProductFitmentType = (
  value?: string | null,
): ProductFitmentTypeValue => (value === "COMPATIBLE" ? "COMPATIBLE" : "DIRECT");

export function partitionProductFitments<T extends { fitmentType?: string | null }>(
  rows: T[],
) {
  const direct: T[] = [];
  const compatible: T[] = [];

  for (const row of rows) {
    if (normalizeProductFitmentType(row.fitmentType) === "COMPATIBLE") {
      compatible.push(row);
      continue;
    }

    direct.push(row);
  }

  return { direct, compatible };
}

type ProductFitmentSectionCopy = {
  adminTitle: string;
  adminDescription: string;
  adminEmptyState: string;
  adminAddLabel: string;
  storefrontTitle: string;
  storefrontDescription: string;
};

export const PRODUCT_FITMENT_SECTION_COPY: Record<
  ProductFitmentTypeValue,
  ProductFitmentSectionCopy
> = {
  DIRECT: {
    adminTitle: "ความเข้ากันได้กับรถยนต์",
    adminDescription:
      'ระบุรุ่นรถ พร้อมโฉม/ปีเริ่ม/ปีจบ/รหัสเครื่อง เพื่อใช้ค้นหาแบบละเอียด เช่น "วีออส 2010"',
    adminEmptyState: "ยังไม่มีรายการ กดปุ่มด้านล่างเพื่อเพิ่ม",
    adminAddLabel: "เพิ่มรุ่นรถที่ใช้ได้",
    storefrontTitle: "ใช้กับรถรุ่นไหนได้บ้าง",
    storefrontDescription:
      "ตัวนี้ใส่ได้กับรถรุ่นต่อไปนี้ ถ้าไม่แน่ใจทักร้านก่อนสั่งได้เลยค่ะ",
  },
  COMPATIBLE: {
    adminTitle: "อาจใช้ร่วมกันได้บางรุ่น ต้องเทียบอะไหล่เดิมก่อน",
    adminDescription:
      "ใช้สำหรับอะไหล่ที่บางรุ่นรถอาจใช้แทนกันได้ แต่ต้องเทียบชิ้นงานเดิม รหัส และจุดยึดก่อนทุกครั้ง",
    adminEmptyState: "ยังไม่มีรายการรุ่นเทียบ กดปุ่มด้านล่างเพื่อเพิ่ม",
    adminAddLabel: "เพิ่มรุ่นรถที่อาจใช้แทนกันได้",
    storefrontTitle: "อาจใช้ร่วมกันได้บางรุ่น ต้องเทียบอะไหล่เดิมก่อน",
    storefrontDescription:
      "กลุ่มนี้เป็นรุ่นรถที่อาจใช้แทนกันได้บางคัน ควรส่งรูปอะไหล่เดิมและข้อมูลรถให้ร้านช่วยยืนยันก่อนสั่งทุกครั้ง",
  },
};
