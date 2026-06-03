export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import { auth } from "@/auth";
import { notFound } from "next/navigation";
import NavLink from "@/components/shared/NavLink";
import { ChevronLeft, Pencil, Package, Tag, MapPin, ShieldCheck, Layers, BarChart2, AlertTriangle, CheckCircle2 } from "lucide-react";
import ProductImagePreview from "@/app/admin/(protected)/products/ProductImagePreview";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import AdminStatusBadge from "@/components/shared/AdminStatusBadge";
import { getAllPermissionKeys, hasPermissionAccess } from "@/lib/access-control";
import { buildAdminProductFitmentSummary } from "@/lib/admin-product-fitment";
import { INVENTORY_TRACKING_NON_TRACKED } from "@/lib/inventory-tracking";
import { formatDateThai, formatDateTimeThai } from "@/lib/th-date";

interface Props {
  params: Promise<{ id: string }>;
}

const ProductPreviewPage = async ({ params }: Props) => {
  await requirePermission("products.view");

  const session = await auth();
  const role = session?.user?.role;
  const permissions =
    role === "ADMIN" ? getAllPermissionKeys() : (session?.user?.permissions ?? []);
  const canUpdate = hasPermissionAccess(role, permissions, "products.update");

  const { id } = await params;

  const product = await db.product.findUnique({
    where: { id },
    select: {
      id: true,
      code: true,
      name: true,
      description: true,
      imageUrl: true,
      isActive: true,
      salePrice: true,
      costPrice: true,
      purchaseLastPrice: true,
      purchaseLastDate: true,
      avgCost: true,
      stock: true,
      minStock: true,
      shelfLocation: true,
      warrantyDays: true,
      reportUnitName: true,
      saleUnitName: true,
      purchaseUnitName: true,
      inventoryTracking: true,
      isLotControl: true,
      lotIssueMethod: true,
      requireExpiryDate: true,
      createdAt: true,
      updatedAt: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
      preferredSupplier: { select: { name: true } },
      images: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { url: true, alt: true },
      },
      aliases: { select: { alias: true } },
      carModels: {
        select: {
          fitmentType: true,
          yearStart: true,
          yearEnd: true,
          carModel: {
            select: {
              name: true,
              carBrand: { select: { name: true } },
            },
          },
        },
        orderBy: [{ fitmentType: "asc" }, { carModelId: "asc" }, { yearStart: "asc" }],
      },
    },
  });

  if (!product) notFound();

  const hasImage = !!product.imageUrl || product.images.length > 0;
  const directFitments = product.carModels.filter((f) => f.fitmentType === "DIRECT");
  const compatibleFitments = product.carModels.filter((f) => f.fitmentType === "COMPATIBLE");
  const directSummary = buildAdminProductFitmentSummary(directFitments);
  const compatibleSummary = buildAdminProductFitmentSummary(compatibleFitments);

  const stockNum = Number(product.stock);
  const minNum = Number(product.minStock);
  const stockStatus =
    stockNum <= 0 ? "out" : stockNum <= minNum ? "low" : "ok";

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title="ดูข้อมูลสินค้า"
        description={`รหัส ${product.code}`}
        actions={
          <div className="flex items-center gap-2">
            <NavLink
              href="/admin/products"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 dark:border-white/10 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-white/5"
            >
              <ChevronLeft size={15} />
              กลับ
            </NavLink>
            {canUpdate && (
              <NavLink
                href={`/admin/products/${product.id}/edit`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#163055]"
              >
                <Pencil size={14} />
                แก้ไข
              </NavLink>
            )}
          </div>
        }
      />

      {/* Hero card — image + primary info */}
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm dark:border-white/10 dark:bg-slate-900">
        <div className="flex flex-col gap-6 sm:flex-row">
          {/* Image — clickable gallery (same logic as list page) */}
          <div className="flex-shrink-0">
            {hasImage ? (
              <ProductImagePreview
                imageUrl={product.imageUrl}
                images={product.images}
                alt={product.name}
                size="lg"
              />
            ) : (
              <div className="flex h-40 w-40 items-center justify-center rounded-xl border border-gray-100 bg-gray-50 dark:border-white/10 dark:bg-slate-800">
                <Package size={40} className="text-gray-300 dark:text-slate-600" />
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-gray-500 dark:text-slate-400">{product.code}</span>
              {product.isActive ? (
                <AdminStatusBadge tone="success">ใช้งาน</AdminStatusBadge>
              ) : (
                <AdminStatusBadge tone="muted">ปิดใช้งาน</AdminStatusBadge>
              )}
              {product.inventoryTracking === INVENTORY_TRACKING_NON_TRACKED ? (
                <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
                  ไม่คำนวณสต็อก
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-sky-100 px-2.5 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">
                  คำนวณสต็อก
                </span>
              )}
            </div>
            <h1 className="text-xl font-semibold text-gray-900 dark:text-slate-50">{product.name}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-slate-400">
              <span className="flex items-center gap-1">
                <Tag size={13} />
                {product.category.name}
              </span>
              {product.brand && (
                <span className="flex items-center gap-1">
                  <Layers size={13} />
                  {product.brand.name}
                </span>
              )}
              {product.shelfLocation && (
                <span className="flex items-center gap-1">
                  <MapPin size={13} />
                  {product.shelfLocation}
                </span>
              )}
              {product.warrantyDays > 0 && (
                <span className="flex items-center gap-1">
                  <ShieldCheck size={13} />
                  ประกัน {product.warrantyDays} วัน
                </span>
              )}
            </div>
            {product.description && (
              <p className="whitespace-pre-line text-sm text-gray-600 dark:text-slate-300">
                {product.description}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <MetricCard label="ราคาขาย">
          <span className="text-lg font-bold text-[#f97316]">
            ฿{Number(product.salePrice).toLocaleString("th-TH-u-ca-gregory", { minimumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-gray-400 dark:text-slate-500">/{product.saleUnitName}</span>
        </MetricCard>

        <MetricCard label="ราคาซื้อ (ล่าสุด)">
          <span className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            ฿{Number(product.purchaseLastPrice ?? 0).toLocaleString("th-TH-u-ca-gregory", { minimumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-gray-400 dark:text-slate-500">/{product.purchaseUnitName}</span>
          {product.purchaseLastDate && (
            <span className="basis-full text-xs text-gray-500 dark:text-slate-400">
              {formatDateThai(product.purchaseLastDate)}
            </span>
          )}
        </MetricCard>

        <MetricCard label="ต้นทุนเฉลี่ย (MAVG)">
          <span className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            ฿{Number(product.avgCost).toLocaleString("th-TH-u-ca-gregory", { minimumFractionDigits: 2 })}
          </span>
        </MetricCard>

        <MetricCard label="คงเหลือ">
          <span
            className={`text-lg font-bold ${
              stockStatus === "out"
                ? "text-red-600 dark:text-red-400"
                : stockStatus === "low"
                ? "text-amber-600 dark:text-amber-400"
                : "text-green-600 dark:text-green-400"
            }`}
          >
            {stockNum.toLocaleString("en-US")}
          </span>
          <span className="text-xs text-gray-400 dark:text-slate-500"> {product.reportUnitName}</span>
          {stockStatus === "out" && (
            <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-500/10 dark:text-red-300">
              หมด
            </span>
          )}
          {stockStatus === "low" && (
            <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              ต่ำ
            </span>
          )}
        </MetricCard>

        <MetricCard label="สต็อกขั้นต่ำ">
          <span className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            {minNum.toLocaleString("en-US")}
          </span>
          <span className="text-xs text-gray-400 dark:text-slate-500"> {product.reportUnitName}</span>
        </MetricCard>

        <MetricCard label="หน่วยซื้อ / ขาย / รายงาน">
          <span className="text-sm font-medium text-gray-800 dark:text-slate-100">
            {product.purchaseUnitName} / {product.saleUnitName} / {product.reportUnitName}
          </span>
        </MetricCard>

        {product.preferredSupplier && (
          <MetricCard label="ผู้จัดจำหน่ายหลัก">
            <span className="text-sm font-medium text-gray-800 dark:text-slate-100">
              {product.preferredSupplier.name}
            </span>
          </MetricCard>
        )}

        <MetricCard label="อัปเดตล่าสุด">
          <span className="text-sm text-gray-600 dark:text-slate-300">
            {formatDateTimeThai(product.updatedAt)}
          </span>
        </MetricCard>
      </div>

      {/* Lot control info */}
      {product.isLotControl && (
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <SectionTitle icon={<BarChart2 size={15} />} title="การควบคุม Lot" />
          <div className="mt-3 flex flex-wrap gap-3 text-sm">
            <InfoPill label="วิธีจ่าย" value={product.lotIssueMethod} />
            <InfoPill label="กำหนดวันหมดอายุ" value={product.requireExpiryDate ? "ใช่" : "ไม่ใช่"} />
          </div>
        </div>
      )}

      {/* Aliases */}
      {product.aliases.length > 0 && (
        <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
          <SectionTitle title="ชื่อเรียกอื่น / OEM Codes" />
          <div className="mt-3 flex flex-wrap gap-2">
            {product.aliases.map((a, i) => (
              <span
                key={`${a.alias}-${i}`}
                className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 font-mono text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
              >
                {a.alias}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Fitment — DIRECT (left) + COMPATIBLE (right) */}
      {(directSummary.lines.length > 0 || compatibleSummary.lines.length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* DIRECT — รุ่นรถที่รองรับ */}
          {directSummary.lines.length > 0 && (
            <div className="rounded-xl border border-gray-100 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 size={15} />
                รุ่นรถที่รองรับ
                <span className="ml-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                  {directSummary.lines.length}
                </span>
              </h2>
              <ul className="mt-3 space-y-1">
                {directSummary.lines.map((line) => (
                  <li key={line} className="text-sm text-gray-700 dark:text-slate-300">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* COMPATIBLE — อาจใช้ร่วมกันได้บางรุ่น */}
          {compatibleSummary.lines.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-5 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-amber-800 dark:text-amber-200">
                <AlertTriangle size={15} />
                อาจใช้ร่วมกันได้บางรุ่น
                <span className="ml-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
                  {compatibleSummary.lines.length}
                </span>
              </h2>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-200/80">
                ต้องเทียบอะไหล่เดิมก่อนสั่งซื้อทุกครั้ง
              </p>
              <ul className="mt-3 space-y-1">
                {compatibleSummary.lines.map((line) => (
                  <li key={line} className="text-sm text-amber-900 dark:text-amber-100">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

    </div>
  );
};

// --- Sub-components (local, no need to extract) ---

const MetricCard = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-900">
    <p className="mb-1 text-xs text-gray-400 dark:text-slate-500">{label}</p>
    <div className="flex flex-wrap items-baseline gap-0.5">{children}</div>
  </div>
);

const SectionTitle = ({ title, icon }: { title: string; icon?: React.ReactNode }) => (
  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-gray-700 dark:text-slate-200">
    {icon}
    {title}
  </h2>
);

const InfoPill = ({ label, value }: { label: string; value: string }) => (
  <span className="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
    {label}: <span className="font-medium">{value}</span>
  </span>
);

export default ProductPreviewPage;
