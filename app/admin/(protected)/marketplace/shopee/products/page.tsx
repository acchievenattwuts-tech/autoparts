export const dynamic = "force-dynamic";

import Link from "next/link";
import { ArrowLeft, Store } from "lucide-react";

import { ensureAccessControlSetup, hasPermissionAccess } from "@/lib/access-control";
import { db } from "@/lib/db";
import { ShopeeAuthStatus } from "@/lib/generated/prisma";
import { getSessionPermissionContext, requirePermission } from "@/lib/require-auth";
import { listShopeeMappings } from "@/lib/shopee/services/mapping";

import MappingManager from "./MappingManager";

const INITIAL_PRODUCT_PICKER_LIMIT = 50;

const ShopeeProductMappingPage = async () => {
  await ensureAccessControlSetup();
  await requirePermission("marketplace.view");
  const { role, permissions } = await getSessionPermissionContext();
  const canManage = hasPermissionAccess(role, permissions, "marketplace.manage");

  const shop = await db.shopeeShop.findFirst({
    where: { authStatus: ShopeeAuthStatus.AUTHORIZED },
    orderBy: { authorizedAt: "desc" },
    select: { id: true, shopId: true, shopName: true },
  });

  const data = shop
    ? {
        mappings: await listShopeeMappings(shop.id),
        products: await db.product.findMany({
          where: { isActive: true },
          orderBy: { code: "asc" },
          select: { id: true, code: true, name: true },
          take: INITIAL_PRODUCT_PICKER_LIMIT,
        }),
      }
    : null;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-orange-200 bg-orange-50 text-orange-600 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-300">
            <Store size={22} />
          </span>
          <div>
            <h1 className="font-kanit text-xl font-bold text-slate-900 dark:text-slate-100">จับคู่สินค้า Shopee</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              map สินค้าในระบบกับ Shopee item/model/SKU — ยังไม่ตัดสต็อก (read-only)
            </p>
          </div>
        </div>
        <Link
          href="/admin/marketplace/shopee"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <ArrowLeft size={15} />
          กลับ
        </Link>
      </div>

      {!shop || !data ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-6 text-sm text-amber-900 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100">
          <p className="font-medium">ยังไม่มีร้าน Shopee ที่เชื่อมต่อ</p>
          <p className="mt-1">
            ต้อง{" "}
            <Link href="/admin/marketplace/shopee" className="underline">
              เชื่อมต่อร้าน Shopee
            </Link>{" "}
            ก่อนจึงจะ map สินค้าได้
          </p>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            ร้าน: <span className="font-medium text-slate-700 dark:text-slate-200">{shop.shopName ?? shop.shopId}</span>
          </p>
          <MappingManager
            shopRecordId={shop.id}
            canManage={canManage}
            products={data.products}
            mappings={data.mappings}
          />
        </>
      )}
    </div>
  );
};

export default ShopeeProductMappingPage;
