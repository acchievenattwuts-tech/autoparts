import type { CSSProperties } from "react";

import {
  PARCEL_LABEL_SIZE_CONFIG,
  resolveRecipientTextScale,
  type ParcelLabelSize,
} from "./print/parcel-label";

export type ParcelLabelParty = {
  name: string;
  address: string;
  phone: string;
};

type ParcelLabelDocumentProps = {
  sender: ParcelLabelParty;
  recipient: ParcelLabelParty;
  /** ใบแรกของชุด — ไม่ขึ้นหน้าใหม่ก่อนหน้าตัวเอง กันหน้าว่างใบแรก */
  isLead?: boolean;
};

/**
 * CSS ของใบปะหน้ากล่อง — หน้าพิมพ์เป็นคนใส่ลง `<style>` ครั้งเดียวต่อหน้า
 * ทุกระยะกำหนดเป็น `em` จาก `font-size` ของ `.pl-sheet` ใบจึงขยายทั้งใบ
 * พร้อมกันเมื่อสลับ A5 → A4 โดยไม่มีอะไรขยับตำแหน่ง
 */
export const buildParcelLabelCss = (size: ParcelLabelSize) => {
  const { widthMm, heightMm, baseFontMm, pageSize } = PARCEL_LABEL_SIZE_CONFIG[size];

  return `
        @page { size: ${pageSize}; margin: 0; }

        .pl-sheet {
          width: ${widthMm}mm;
          /* ต่ำกว่าความสูงกระดาษเล็กน้อย — ถ้าสูงเท่ากันเป๊ะ การปัดเศษของ
             เบราว์เซอร์อาจดันใบล้นไปอีกหน้าแล้วเกิดหน้าว่างคั่นระหว่างใบ */
          height: calc(${heightMm}mm - 0.4mm);
          /* body ของ layout หลักเป็น flex column — ถ้าไม่ล็อกไว้ ใบจะถูกบีบ
             ให้เตี้ยลงตอนพิมพ์เพราะ flex-shrink ปริยายเป็น 1 */
          flex: none;
          font-size: ${baseFontMm}mm;
          line-height: 1.35;
          color: #101418;
          background: #ffffff;
          padding: 1.6em;
          display: flex;
          flex-direction: column;
          gap: 1.35em;
          overflow: hidden;
          box-sizing: border-box;
        }
        .pl-frame {
          border: 0.14em solid #2b3440;
          border-radius: 1.15em;
          padding: 1.25em 1.6em;
          display: flex;
          flex-direction: column;
          gap: 0.3em;
          box-sizing: border-box;
        }
        .pl-frame--to {
          flex: 1;
          font-size: calc(1.2em * var(--pl-to-scale, 1));
        }
        .pl-head { display: flex; align-items: center; gap: 0.5em; }
        .pl-head-title { font-family: var(--font-kanit), "Kanit", sans-serif; font-weight: 700; font-size: 1.5em; }
        .pl-frame--to .pl-head-title { font-size: 1.7em; }
        .pl-phone {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 0.45em;
          min-width: 40%;
          min-height: 1.9em;
          padding: 0.15em 1em 0.15em 0.5em;
          border: 0.11em solid #2b3440;
          border-radius: 999px;
          font-weight: 600;
          letter-spacing: 0.03em;
        }
        .pl-phone svg { width: 1.25em; height: 1.25em; flex: none; }
        .pl-line { display: flex; align-items: baseline; gap: 0.4em; }
        .pl-key { flex: none; color: #5c6675; }
        .pl-val { font-weight: 600; }
        .pl-rule { flex: 1; align-self: flex-end; height: 1em; border-bottom: 0.06em dotted #8b95a5; }

        /* บรรทัดที่อยู่จัดชิดบนแทน baseline เพราะเป็นบล็อกหลายบรรทัด — ตั้ง
           line-height ของหัวข้อให้เท่ากับเนื้อที่อยู่ ฐานอักษรบรรทัดแรกจึงตรงกัน */
        .pl-line--addr { align-items: stretch; }
        .pl-line--addr .pl-key { line-height: 1.6; }
        .pl-addr {
          flex: 1;
          font-weight: 600;
          line-height: 1.6;
          white-space: pre-line;
          overflow-wrap: anywhere;
          background-image: radial-gradient(circle at 0.1em calc(1.6em - 0.18em), #8b95a5 0.045em, transparent 0.05em);
          background-size: 0.55em 1.6em;
          background-repeat: repeat;
        }
        /* เส้นประไล่ลงไปจนสุดกรอบเหมือนใบสำเร็จรูป — ที่อยู่สั้นจะได้ไม่เหลือ
           พื้นที่ว่างเปล่า และยังมีที่ให้พนักงานเขียนหมายเหตุด้วยปากกา */
        .pl-frame--to .pl-line--addr { flex: 1; }
        .pl-frame:not(.pl-frame--to) .pl-addr { min-height: 3.2em; }

        @media print {
          .pl-sheet, .pl-sheet * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .pl-sheet:not(.pl-lead) { page-break-before: always; break-before: page; }
        }
`;
};

const PhoneIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);

const PartyFrame = ({
  party,
  title,
  nameLabel,
  variant,
  style,
}: {
  party: ParcelLabelParty;
  title: string;
  nameLabel: string;
  variant: "from" | "to";
  style?: CSSProperties;
}) => (
  <div className={variant === "to" ? "pl-frame pl-frame--to" : "pl-frame"} style={style}>
    <div className="pl-head">
      <span className="pl-head-title">{title}</span>
      <span className="pl-phone">
        <PhoneIcon />
        <span>{party.phone}</span>
      </span>
    </div>

    <div className="pl-line">
      <span className="pl-key">{nameLabel} :</span>
      <span className="pl-val">{party.name}</span>
      <span className="pl-rule" />
    </div>

    <div className="pl-line pl-line--addr">
      <span className="pl-key">ที่อยู่ :</span>
      <span className="pl-addr">{party.address}</span>
    </div>
  </div>
);

/**
 * ใบปะหน้ากล่องพัสดุ — หนึ่งบิลหนึ่งใบ เต็มแผ่นพอดี
 *
 * มีเฉพาะผู้ส่งกับผู้รับตามที่เจ้าของร้านกำหนด ไม่มีเลขที่ใบขาย วันที่ ขนส่ง
 * เลขพัสดุ หรือยอดเก็บเงินปลายทาง (ร้านไม่ได้ส่งแบบ COD)
 */
const ParcelLabelDocument = ({ sender, recipient, isLead = false }: ParcelLabelDocumentProps) => {
  const recipientScale = resolveRecipientTextScale({
    name: recipient.name,
    address: recipient.address,
  });
  const recipientStyle = { "--pl-to-scale": String(recipientScale) } as CSSProperties;

  return (
    <div className={isLead ? "pl-sheet pl-lead" : "pl-sheet"}>
      <PartyFrame party={sender} title="ผู้ส่ง From." nameLabel="ชื่อผู้ส่ง" variant="from" />
      <PartyFrame
        party={recipient}
        title="ผู้รับ To."
        nameLabel="ชื่อผู้รับ"
        variant="to"
        style={recipientStyle}
      />
    </div>
  );
};

export default ParcelLabelDocument;
