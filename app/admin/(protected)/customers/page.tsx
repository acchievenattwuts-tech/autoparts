export const dynamic = "force-dynamic";

import { auth } from "@/auth";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { Plus, Pencil, Eye, Filter } from "lucide-react";
import ToggleCustomerButton from "./DeleteCustomerButton";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import Pagination from "@/components/shared/Pagination";
import type { Prisma } from "@/lib/generated/prisma";
import { normalizeCustomerPhone } from "@/lib/customer-phone";

const PAGE_SIZE = 50;

const CustomersPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; source?: string }>;
}) => {
  await requirePermission("customers.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);

  const canCreate = hasPermissionAccess(role, permissions, "customers.create");
  const canUpdate = hasPermissionAccess(role, permissions, "customers.update");
  const canCancel = hasPermissionAccess(role, permissions, "customers.cancel");

  const { search, page: pageParam, source } = await searchParams;
  const page = Math.max(1, parseInt(pageParam ?? "1", 10));
  const skip = (page - 1) * PAGE_SIZE;
  const sourceFilter = source === "LINE_LIFF" ? "LINE_LIFF" : undefined;
  const normalizedSearchPhone = (() => {
    try {
      return normalizeCustomerPhone(search);
    } catch {
      return undefined;
    }
  })();

  const whereClause: Prisma.CustomerWhereInput = {
    ...(sourceFilter ? { source: sourceFilter } : {}),
    ...(search
      ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search } },
          ...(normalizedSearchPhone ? [{ phone: { contains: normalizedSearchPhone } }] : []),
          { code: { contains: search, mode: "insensitive" as const } },
        ],
      }
      : {}),
  };

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

      <AdminSearchForm method="GET" className="mb-4">
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            name="search"
            defaultValue={search ?? ""}
            placeholder="ค้นหาชื่อ รหัส หรือเบอร์โทร"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] md:max-w-md"
          />
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600">
            <Filter size={14} />
            <select
              name="source"
              defaultValue={sourceFilter ?? ""}
              className="bg-transparent text-sm outline-none"
            >
              <option value="">ลูกค้าทั้งหมด</option>
              <option value="LINE_LIFF">ลูกค้าจาก LINE</option>
            </select>
          </label>
          <AdminSearchSubmitButton
            className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#162d4a]"
          >
            ค้นหา
          </AdminSearchSubmitButton>
          {(search || sourceFilter) && (
            <Link
              href="/admin/customers"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50"
            >
              ล้าง
            </Link>
          )}
        </div>
      </AdminSearchForm>

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
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{customer.name}</span>
                        {customer.source === "LINE_LIFF" ? (
                          <span className="inline-flex items-center rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                            สมัครผ่าน LINE
                          </span>
                        ) : null}
                        {customer.lineUserId ? (
                          <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            ผูก LINE แล้ว
                          </span>
                        ) : null}
                        {customer.source === "LINE_LIFF" &&
                        (!customer.shippingAddress || !customer.taxId) ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            ข้อมูลยังไม่ครบ
                          </span>
                        ) : null}
                      </div>
                    </td>
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
        searchParams={{
          ...(search ? { search } : {}),
          ...(sourceFilter ? { source: sourceFilter } : {}),
        }}
      />
    </div>
  );
};

export default CustomersPage;
