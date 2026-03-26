export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import Link from "next/link";
import { ShieldCheck, Plus, AlertTriangle, CheckCircle, XCircle } from "lucide-react";

interface WarrantyPageProps {
  searchParams: Promise<{ status?: string; q?: string }>;
}

const WarrantyPage = async ({ searchParams }: WarrantyPageProps) => {
  const { status, q } = await searchParams;
  const now = new Date();
  const soonDate = new Date();
  soonDate.setDate(now.getDate() + 30);

  const warranties = await db.warranty.findMany({
    orderBy: { endDate: "asc" },
    take: 200,
    select: {
      id: true,
      warrantyMonths: true,
      startDate: true,
      endDate: true,
      note: true,
      product: { select: { code: true, name: true } },
      sale: { select: { saleNo: true, saleDate: true, customerName: true } },
    },
  });

  // Classify status
  const withStatus = warranties.map((w) => {
    const isExpired = w.endDate < now;
    const isSoon    = !isExpired && w.endDate <= soonDate;
    const wStatus   = isExpired ? "expired" : isSoon ? "soon" : "active";
    return { ...w, wStatus };
  });

  // Filter
  const filtered = withStatus.filter((w) => {
    const matchStatus = !status || w.wStatus === status;
    const matchQ = !q || w.product.name.toLowerCase().includes(q.toLowerCase()) ||
      w.product.code.toLowerCase().includes(q.toLowerCase()) ||
      (w.sale.customerName?.toLowerCase().includes(q.toLowerCase()) ?? false) ||
      w.sale.saleNo.toLowerCase().includes(q.toLowerCase());
    return matchStatus && matchQ;
  });

  const counts = {
    active:  withStatus.filter((w) => w.wStatus === "active").length,
    soon:    withStatus.filter((w) => w.wStatus === "soon").length,
    expired: withStatus.filter((w) => w.wStatus === "expired").length,
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ShieldCheck size={22} className="text-[#1e3a5f]" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900">ประกันสินค้า</h1>
        </div>
        <Link
          href="/admin/warranties/new"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Plus size={16} />
          บันทึกประกันใหม่
        </Link>
      </div>

      {/* Status summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {[
          { key: "active",  label: "ยังมีประกัน",         count: counts.active,  icon: CheckCircle,    color: "text-green-600 bg-green-50 border-green-100" },
          { key: "soon",    label: "กำลังจะหมด (<30 วัน)", count: counts.soon,   icon: AlertTriangle,  color: "text-yellow-600 bg-yellow-50 border-yellow-100" },
          { key: "expired", label: "หมดประกันแล้ว",        count: counts.expired, icon: XCircle,       color: "text-red-500 bg-red-50 border-red-100" },
        ].map(({ key, label, count, icon: Icon, color }) => (
          <Link
            key={key}
            href={`/admin/warranties?status=${status === key ? "" : key}`}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
              status === key ? color + " ring-2 ring-offset-1 ring-current/20" : "bg-white border-gray-100 hover:border-gray-200"
            }`}
          >
            <Icon size={20} className={status === key ? "" : "text-gray-400"} />
            <div>
              <p className={`text-xl font-bold ${status === key ? "" : "text-gray-800"}`}>{count}</p>
              <p className={`text-xs ${status === key ? "" : "text-gray-500"}`}>{label}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-4">
        <form method="GET" className="flex gap-3 flex-wrap">
          {status && <input type="hidden" name="status" value={status} />}
          <input
            type="text"
            name="q"
            defaultValue={q ?? ""}
            placeholder="ค้นหาสินค้า, ลูกค้า, เลขที่ใบขาย..."
            className="flex-1 min-w-48 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] text-sm"
          />
          <button
            type="submit"
            className="px-4 py-2 bg-[#1e3a5f] hover:bg-[#163055] text-white text-sm font-medium rounded-lg transition-colors"
          >
            ค้นหา
          </button>
          {q && (
            <Link
              href={status ? `/admin/warranties?status=${status}` : "/admin/warranties"}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium rounded-lg transition-colors"
            >
              ล้าง
            </Link>
          )}
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <p className="text-sm text-gray-500">
            แสดง <span className="font-medium text-gray-700">{filtered.length} รายการ</span>
            {status && <span className="ml-1 text-xs text-blue-600">(กรอง: {status === "active" ? "ยังมีประกัน" : status === "soon" ? "กำลังจะหมด" : "หมดแล้ว"})</span>}
          </p>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">ไม่พบรายการประกัน</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left py-3 px-4 font-medium text-gray-600 w-8">#</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">สินค้า</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">ใบขาย / ลูกค้า</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">ระยะประกัน</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">วันเริ่มต้น</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">วันหมดประกัน</th>
                  <th className="text-center py-3 px-4 font-medium text-gray-600">สถานะ</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">หมายเหตุ</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((w, idx) => {
                  const daysLeft = Math.ceil((w.endDate.getTime() - now.getTime()) / 86400000);
                  return (
                    <tr key={w.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="py-2.5 px-4 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="py-2.5 px-4">
                        <p className="font-medium text-gray-800">{w.product.name}</p>
                        <p className="text-xs text-gray-400">[{w.product.code}]</p>
                      </td>
                      <td className="py-2.5 px-4">
                        <p className="font-mono text-xs text-[#1e3a5f]">{w.sale.saleNo}</p>
                        <p className="text-xs text-gray-500">{w.sale.customerName ?? "—"}</p>
                      </td>
                      <td className="py-2.5 px-4 text-center text-gray-700 font-medium">
                        {w.warrantyMonths} เดือน
                      </td>
                      <td className="py-2.5 px-4 text-gray-600 whitespace-nowrap">
                        {new Date(w.startDate).toLocaleDateString("th-TH")}
                      </td>
                      <td className="py-2.5 px-4 text-gray-600 whitespace-nowrap">
                        {new Date(w.endDate).toLocaleDateString("th-TH")}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        {w.wStatus === "expired" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600">
                            <XCircle size={11} /> หมดประกัน
                          </span>
                        )}
                        {w.wStatus === "soon" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">
                            <AlertTriangle size={11} /> อีก {daysLeft} วัน
                          </span>
                        )}
                        {w.wStatus === "active" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            <CheckCircle size={11} /> ยังมีประกัน
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-gray-500 text-xs max-w-32 truncate">
                        {w.note ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default WarrantyPage;
