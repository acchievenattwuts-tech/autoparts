import AdminPageHeader from "@/components/shared/AdminPageHeader";
import LotTabNav from "./LotTabNav";

export default function LotsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="สต็อก"
        title="Stock Card Lot"
        description="ติดตามคงเหลือต่อ lot, trace การเคลื่อนไหว, lot ใกล้หมดอายุ และ slow-moving"
      />
      <LotTabNav />
      {children}
    </div>
  );
}
