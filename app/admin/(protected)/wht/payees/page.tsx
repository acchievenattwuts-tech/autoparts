export const dynamic = "force-dynamic";

import Link from "next/link";
import { db } from "@/lib/db";
import { Prisma } from "@/lib/generated/prisma";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminFilterToolbar from "@/components/shared/AdminFilterToolbar";
import AdminSearchForm from "@/components/shared/AdminSearchForm";
import AdminSearchSubmitButton from "@/components/shared/AdminSearchSubmitButton";
import AdminTableSection from "@/components/shared/AdminTableSection";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import Pagination from "@/components/shared/Pagination";
import { hasPermissionAccess } from "@/lib/access-control";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import WhtPayeeEditor, { type WhtPayeeProfileValue } from "./WhtPayeeEditor";

const PAGE_SIZE = 30;

interface PageProps {
  searchParams: Promise<{ q?: string; profile?: string; page?: string }>;
}

const WhtPayeesPage = async ({ searchParams }: PageProps) => {
  await requirePermission("wht.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canEdit = hasPermissionAccess(role, permissions, "wht.update");

  const { q, profile, page } = await searchParams;
  const pageNum = Math.max(1, parseInt(page ?? "1", 10));
  const profileFilter = profile ?? "";

  const whereCondition: Prisma.SupplierWhereInput = {
    AND: [
      { isActive: true },
      profileFilter === "MISSING"
        ? { whtPayeeProfile: { is: null } }
        : profileFilter === "READY"
          ? { whtPayeeProfile: { isNot: null } }
          : {},
      q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { code: { contains: q, mode: "insensitive" as const } },
              { taxId: { contains: q, mode: "insensitive" as const } },
            ],
          }
        : {},
    ],
  };

  const [suppliers, totalCount, missingCount] = await Promise.all([
    db.supplier.findMany({
      where: whereCondition,
      orderBy: [{ code: "asc" }, { name: "asc" }],
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      select: {
        id: true,
        code: true,
        name: true,
        taxId: true,
        whtPayeeProfile: true,
      },
    }),
    db.supplier.count({ where: whereCondition }),
    db.supplier.count({ where: { isActive: true, whtPayeeProfile: { is: null } } }),
  ]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const paginationParams: Record<string, string> = {};
  if (q) paginationParams.q = q;
  if (profileFilter) paginationParams.profile = profileFilter;

  return (
    <div className="space-y-4">
      <AdminPageHeader
        title="ข้อมูลภาษีผู้ถูกหัก"
        description="ชื่อและที่อยู่แบบแยกช่องของผู้รับเงิน ใช้พิมพ์หนังสือรับรอง 50 ทวิ และสร้างไฟล์นำส่งกรมสรรพากร"
        actions={
          <Link
            href="/admin/wht/certificates"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-[#1e3a5f] hover:text-[#1e3a5f] dark:border-white/10 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:text-sky-300"
          >
            หนังสือรับรอง 50 ทวิ
          </Link>
        }
      />

      {missingCount > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/5 dark:text-amber-300">
          มีผู้จำหน่าย <span className="font-semibold">{missingCount}</span> รายที่ยังไม่มีข้อมูลภาษี —
          ออกหนังสือรับรอง 50 ทวิ ให้รายเหล่านี้ไม่ได้จนกว่าจะกรอกครบ
        </div>
      )}

      <AdminFilterToolbar
        className="mb-0"
        summary={
          <span className="font-medium text-slate-700 dark:text-slate-200">
            ทั้งหมด <span className="font-semibold text-slate-900 dark:text-slate-100">{totalCount} ราย</span>
          </span>
        }
      >
        <AdminSearchForm method="GET" className="flex flex-col gap-3 xl:flex-row xl:items-end">
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="ค้นหาชื่อ, รหัส, เลขผู้เสียภาษี..."
            className="min-w-48 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:ring-sky-400/20"
          />
          <select
            name="profile"
            defaultValue={profileFilter}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]/20 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-sky-400/20"
          >
            <option value="">ทั้งหมด</option>
            <option value="MISSING">ยังไม่มีข้อมูลภาษี</option>
            <option value="READY">มีข้อมูลภาษีแล้ว</option>
          </select>
          <div className="flex flex-wrap items-center gap-2">
            <AdminSearchSubmitButton className="rounded-xl bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055]">
              ค้นหา
            </AdminSearchSubmitButton>
            {(q || profileFilter) && (
              <Link
                href="/admin/wht/payees"
                className="rounded-xl bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-200 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10"
              >
                ล้าง
              </Link>
            )}
          </div>
        </AdminSearchForm>
      </AdminFilterToolbar>

      <AdminTableSection>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 dark:bg-white/5 dark:text-slate-300">
            <tr>
              <th className="px-4 py-3 text-left font-medium">รหัส</th>
              <th className="px-4 py-3 text-left font-medium">ผู้จำหน่าย</th>
              <th className="px-4 py-3 text-left font-medium">ประเภท</th>
              <th className="px-4 py-3 text-left font-medium">เลขผู้เสียภาษี</th>
              <th className="px-4 py-3 text-center font-medium">สถานะข้อมูลภาษี</th>
              <th className="px-4 py-3 text-right font-medium">จัดการ</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">
                  ไม่พบผู้จำหน่าย
                </td>
              </tr>
            ) : (
              suppliers.map((supplier) => {
                const profileValue: WhtPayeeProfileValue | null = supplier.whtPayeeProfile
                  ? {
                      payeeType: supplier.whtPayeeProfile.payeeType,
                      taxId13: supplier.whtPayeeProfile.taxId13,
                      taxId10: supplier.whtPayeeProfile.taxId10 ?? "",
                      titleName: supplier.whtPayeeProfile.titleName ?? "",
                      firstName: supplier.whtPayeeProfile.firstName,
                      lastName: supplier.whtPayeeProfile.lastName ?? "",
                      branchNo: supplier.whtPayeeProfile.branchNo,
                      addrNo: supplier.whtPayeeProfile.addrNo ?? "",
                      addrRoad: supplier.whtPayeeProfile.addrRoad ?? "",
                      addrSubdistrict: supplier.whtPayeeProfile.addrSubdistrict ?? "",
                      addrDistrict: supplier.whtPayeeProfile.addrDistrict ?? "",
                      addrProvince: supplier.whtPayeeProfile.addrProvince ?? "",
                      addrPostcode: supplier.whtPayeeProfile.addrPostcode ?? "",
                      isActive: supplier.whtPayeeProfile.isActive,
                    }
                  : null;

                return (
                  <tr key={supplier.id} className="border-t border-slate-100 align-top dark:border-white/5">
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">{supplier.code ?? "-"}</td>
                    <td className="px-4 py-3 text-slate-800 dark:text-slate-100">{supplier.name}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">
                      {profileValue
                        ? profileValue.payeeType === "INDIVIDUAL"
                          ? "บุคคลธรรมดา (ภ.ง.ด.3)"
                          : "นิติบุคคล (ภ.ง.ด.53)"
                        : "-"}
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600 dark:text-slate-300">
                      {profileValue?.taxId13 || supplier.taxId || "-"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {profileValue ? (
                        profileValue.isActive ? (
                          <AdminStatusBadge tone="success">พร้อมออก 50 ทวิ</AdminStatusBadge>
                        ) : (
                          <AdminStatusBadge tone="neutral">ปิดใช้งาน</AdminStatusBadge>
                        )
                      ) : (
                        <AdminStatusBadge tone="warning">ยังไม่มีข้อมูล</AdminStatusBadge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end">
                        <WhtPayeeEditor
                          supplierId={supplier.id}
                          supplierName={supplier.name}
                          supplierTaxId={supplier.taxId}
                          profile={profileValue}
                          canEdit={canEdit}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminTableSection>

      {totalPages > 1 && (
        <Pagination
          currentPage={pageNum}
          totalPages={totalPages}
          basePath="/admin/wht/payees"
          searchParams={paginationParams}
        />
      )}
    </div>
  );
};

export default WhtPayeesPage;
