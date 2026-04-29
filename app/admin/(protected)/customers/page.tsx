export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { Plus, Pencil, Eye } from "lucide-react";
import ToggleCustomerButton from "./DeleteCustomerButton";
import Pagination from "@/components/shared/Pagination";

const PAGE_SIZE = 50;

const CustomersPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string }>;
}) => {
  await requirePermission("customers.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const canCreate = hasPermissionAccess(role, permissions, "customers.create");
  const canUpdate = hasPermissionAccess(role, permissions, "customers.update");
  const canCancel = hasPermissionAccess(role, permissions, "customers.cancel");

  const { search, page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10));
  const skip = (page - 1) * PAGE_SIZE;

  const whereClause = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search } },
          { code: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : undefined;

  const [customers, total] = await Promise.all([
    db.customer.findMany({
      where: whereClause,
      include: { _count: { select: { sales: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    db.customer.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-kanit text-2xl font-bold text-gray-900">รายการลูกค้า</h1>
        {canCreate && (
          <Link
            href="/admin/customers/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
          >
            <Plus size={16} /> เพิ่มลูกค้า
          </Link>
        )}
      </div>

      <form method="GET" className="mb-4">
        <div className="flex max-w-md gap-2">
          <input
            type="text"
            name="search"
            defaultValue={search ?? ""}
            placeholder="ค้นหาชื่อ รหัส หรือเบอร์โทร"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]"
          />
          <button
            type="submit"
            className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#162d4a]"
          >
            ค้นหา
          </button>
          {search && (
            <Link
              href="/admin/customers"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
            >
              ล้าง
            </Link>
          )}
        </div>
      </form>

      <p className="text-sm text-gray-500">
        {total} รายการ
      </p>

      <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">รหัส</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">ชื่อลูกค้า</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">เบอร์โทร</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">ที่อยู่</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600">ยอดซื้อ</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-gray-400">
                    {search ? "ไม่พบลูกค้าที่ตรงกับการค้นหา" : "ยังไม่มีข้อมูลลูกค้า"}
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr
                    key={customer.id}
                    className={`border-t border-gray-50 transition-colors ${
                      customer.isActive ? "hover:bg-gray-50" : "bg-gray-50 opacity-60"
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{customer.code ?? "-"}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{customer.name}</td>
                    <td className="px-4 py-3 text-gray-600">{customer.phone ?? "-"}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-gray-500">{customer.address ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-gray-600">{customer._count.sales} ครั้ง</td>
                    <td className="px-4 py-3 text-center">
                      {customer.isActive ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">ใช้งาน</span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">ยกเลิก</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/admin/customers/${customer.id}`}
                          className="inline-flex items-center gap-1 text-xs text-[#1e3a5f] transition-colors hover:text-blue-700"
                        >
                          <Eye size={13} /> ดู
                        </Link>
                        {canUpdate && (
                          <Link
                            href={`/admin/customers/${customer.id}/edit`}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#162d4a]"
                          >
                            <Pencil size={12} /> แก้ไข
                          </Link>
                        )}
                        {canCancel && (
                          <ToggleCustomerButton
                            id={customer.id}
                            name={customer.name}
                            isActive={customer.isActive}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Pagination
        currentPage={page}
        totalPages={totalPages}
        basePath="/admin/customers"
        searchParams={search ? { search } : undefined}
      />
    </div>
  );
};

export default CustomersPage;
