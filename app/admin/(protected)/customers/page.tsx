export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { Plus, Pencil, Eye } from "lucide-react";
import DeleteCustomerButton from "./DeleteCustomerButton";

const CustomersPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ search?: string }>;
}) => {
  const { search } = await searchParams;

  const customers = await db.customer.findMany({
    where: search
      ? {
          OR: [
            { name:  { contains: search, mode: "insensitive" } },
            { phone: { contains: search } },
            { code:  { contains: search, mode: "insensitive" } },
          ],
        }
      : undefined,
    include: { _count: { select: { sales: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">รายการลูกค้า</h1>
        <Link
          href="/admin/customers/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#f97316] hover:bg-orange-600 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} /> เพิ่มลูกค้า
        </Link>
      </div>

      {/* Search bar */}
      <form method="GET" className="mb-4">
        <div className="flex gap-2 max-w-md">
          <input
            type="text"
            name="search"
            defaultValue={search ?? ""}
            placeholder="ค้นหาชื่อ, รหัส, เบอร์โทร..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#162d4a] text-white text-sm font-medium rounded-lg transition-colors"
          >
            ค้นหา
          </button>
          {search && (
            <Link
              href="/admin/customers"
              className="px-4 py-2 border border-gray-300 hover:bg-gray-50 text-gray-600 text-sm rounded-lg transition-colors"
            >
              ล้าง
            </Link>
          )}
        </div>
      </form>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left py-3 px-4 font-medium text-gray-600">รหัส</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ชื่อลูกค้า</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">เบอร์โทร</th>
                <th className="text-left py-3 px-4 font-medium text-gray-600">ที่อยู่</th>
                <th className="text-right py-3 px-4 font-medium text-gray-600">ยอดซื้อ</th>
                <th className="py-3 px-4" />
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400">
                    {search ? "ไม่พบลูกค้าที่ตรงกับการค้นหา" : "ยังไม่มีข้อมูลลูกค้า"}
                  </td>
                </tr>
              ) : (
                customers.map((c) => (
                  <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="py-3 px-4 text-gray-500 font-mono text-xs">{c.code ?? "-"}</td>
                    <td className="py-3 px-4 font-medium text-gray-900">{c.name}</td>
                    <td className="py-3 px-4 text-gray-600">{c.phone ?? "-"}</td>
                    <td className="py-3 px-4 text-gray-500 max-w-xs truncate">{c.address ?? "-"}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{c._count.sales} ครั้ง</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/customers/${c.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] hover:text-blue-700 transition-colors"
                        >
                          <Eye size={13} /> ดู
                        </Link>
                        <Link
                          href={`/admin/customers/${c.id}/edit`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#1e3a5f] hover:bg-[#162d4a] text-white text-xs font-medium rounded-lg transition-colors"
                        >
                          <Pencil size={12} /> แก้ไข
                        </Link>
                        <DeleteCustomerButton id={c.id} name={c.name} />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CustomersPage;
