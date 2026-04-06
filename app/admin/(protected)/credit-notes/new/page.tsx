export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { getSiteConfig } from "@/lib/site-config";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import CreditNoteForm from "./CreditNoteForm";

const NewCreditNotePage = async () => {
  await requirePermission("credit_notes.create");

  const config = await getSiteConfig();

  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/credit-notes"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> รายการ Credit Note
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">สร้าง CN ใหม่</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">สร้างใบลดหนี้ (Credit Note)</h1>
      <CreditNoteForm products={[]} customers={[]} defaultVatType={config.vatType} defaultVatRate={config.vatRate} />
    </div>
  );
};

export default NewCreditNotePage;
