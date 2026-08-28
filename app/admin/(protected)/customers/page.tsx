export const dynamic = "force-dynamic";

import { getSession } from "@/lib/auth-session";
import { db } from "@/lib/db";
import {
  getAllPermissionKeys,
  hasPermissionAccess,
} from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import Link from "next/link";
import { Plus, Pencil, Eye, Filter, MapPin } from "lucide-react";
import ToggleCustomerButton from "./DeleteCustomerButton";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import Pagination from "@/components/shared/Pagination";
import type { Prisma } from "@/lib/generated/prisma";

const priceListBadgeClass = (code: string) => {
  if (code === "WHOLESALE") return "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-300";
  if (code === "MEMBER") return "bg-sky-100 text-sky-700 dark:bg-sky-400/20 dark:text-sky-300";
  if (code === "SHOPEE") return "bg-orange-100 text-orange-700 dark:bg-orange-400/20 dark:text-orange-300";
  if (code === "LAZADA") return "bg-blue-100 text-blue-700 dark:bg-blue-400/20 dark:text-blue-300";
  if (code === "RETAIL") return "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-slate-300";
  return "bg-violet-100 text-violet-700 dark:bg-violet-400/20 dark:text-violet-300";
};
import { normalizeCustomerPhone } from "@/lib/customer-phone";
import AdminActionGroup from "@/components/shared/AdminActionGroup";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import AdminTableSection from "@/components/shared/AdminTableSection";
import { isLineCustomerProfileIncomplete } from "@/lib/line-customer-profile";
import { getAdminActiveBadgeTone, getAdminMasterRowClass } from "@/lib/admin-status-presentation";

const PAGE_SIZE = 50;

const CustomersPage = async ({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; page?: string; source?: string }>;
}) => {
  await requirePermission("customers.view");

  const session = await getSession();
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
      include: {
        _count: { select: { sales: true } },
        customerType: {
          select: {
            name: true,
            priceTier: true,
            priceList: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: PAGE_SIZE,
    }),
    db.customer.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="รายการลูกค้า"
        description="ค้นหา ตรวจสอบแหล่งที่มา และจัดการข้อมูลลูกค้า"
        actions={
          canCreate ? (
          <Link
            href="/admin/customers/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-orange-600"
          >
            <Plus size={16} /> เพิ่มลูกค้า
          </Link>
          ) : null
        }
      />

      <AdminFilterToolbar
        className="mb-0"
        summary={<span>{total.toLocaleString("th-TH")} รายการ</span>}
      >
      <AdminSearchForm method="GET">
        <div className="flex flex-col gap-2 md:flex-row">
          <input
            type="text"
            name="search"
            defaultValue={search ?? ""}
            placeholder="ค้นหาชื่อ รหัส หรือเบอร์โทร"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 md:max-w-md"
          />
          <label className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-600 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200">
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
      </AdminFilterToolbar>

      <AdminTableSection>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">รหัส</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ชื่อลูกค้า</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">เบอร์โทร</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ประเภท / ระดับราคา</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-slate-300">ที่อยู่</th>
                <th className="px-4 py-3 text-right font-medium text-gray-600 dark:text-slate-300">ยอดซื้อ</th>
                <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-slate-300">สถานะ</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {customers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-gray-400 dark:text-slate-500">
                    {search ? "ไม่พบลูกค้าที่ตรงกับการค้นหา" : "ยังไม่มีข้อมูลลูกค้า"}
                  </td>
                </tr>
              ) : (
                customers.map((customer) => (
                  <tr
                    key={customer.id}
                    className={`border-t border-gray-50 transition-colors dark:border-white/10 ${
                      getAdminMasterRowClass(customer.isActive)
                    }`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-slate-400">{customer.code ?? "-"}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-slate-100">
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
                        {isLineCustomerProfileIncomplete(customer) ? (
                          <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            ข้อมูลยังไม่ครบ
                          </span>
                        ) : null}
                        {customer.defaultLatitude !== null && customer.defaultLongitude !== null ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:bg-blue-400/20 dark:text-blue-300">
                            <MapPin size={10} />
                            ปักหมุดแล้ว
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">{customer.phone ?? "-"}</td>
                    <td className="px-4 py-3">
                      {customer.customerType ? (
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            priceListBadgeClass(customer.customerType.priceList?.code ?? customer.customerType.priceTier)
                          }`}
                        >
                          {customer.customerType.name}
                          <span className="font-normal opacity-75">
                            · {customer.customerType.priceList?.name ?? `Compatibility: ${customer.customerType.priceTier}`}
                          </span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-400 dark:text-slate-500">ทั่วไป</span>
                      )}
                    </td>
                    <td className="max-w-xs truncate px-4 py-3 text-gray-500 dark:text-slate-400">{customer.address ?? "-"}</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-slate-300">{customer._count.sales} ครั้ง</td>
                    <td className="px-4 py-3 text-center">
                      {customer.isActive ? (
                        <AdminStatusBadge tone={getAdminActiveBadgeTone(customer.isActive)}>ใช้งาน</AdminStatusBadge>
                      ) : (
                        <AdminStatusBadge tone={getAdminActiveBadgeTone(customer.isActive)}>ยกเลิก</AdminStatusBadge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <AdminActionGroup align="end">
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
                      </AdminActionGroup>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
      </AdminTableSection>

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
