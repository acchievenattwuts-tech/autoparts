export const dynamic = "force-dynamic";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import CustomerForm from "../CustomerForm";

const NewCustomerPage = async () => {
  return (
    <div>
      <div className="flex items-center gap-2 mb-6">
        <Link
          href="/admin/customers"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#1e3a5f] transition-colors"
        >
          <ChevronLeft size={16} /> รายการลูกค้า
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-medium text-gray-700">เพิ่มลูกค้า</span>
      </div>
      <h1 className="font-kanit text-2xl font-bold text-gray-900 mb-6">เพิ่มลูกค้าใหม่</h1>
      <CustomerForm />
    </div>
  );
};

export default NewCustomerPage;
