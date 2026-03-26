"use client";

import { useRouter } from "next/navigation";
import CancelDocButton from "@/components/shared/CancelDocButton";
import { cancelBF } from "./actions";

interface BfDoc {
  id:              string;
  docNo:           string;
  docDate:         string;
  unitName:        string;
  qtyInBase:       number;
  costPerBaseUnit: number;
  note:            string | null;
  status:          string;
  cancelledAt:     string | null;
  cancelNote:      string | null;
  product:         { code: string; name: string };
}

const BfHistoryTable = ({ docs }: { docs: BfDoc[] }) => {
  const router = useRouter();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left py-3 px-4 font-medium text-gray-600">เลขที่เอกสาร</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">วันที่</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">สินค้า</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600">จำนวน (base)</th>
              <th className="text-right py-3 px-4 font-medium text-gray-600">ราคาทุน/หน่วย</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">สถานะ</th>
              <th className="text-left py-3 px-4 font-medium text-gray-600">หมายเหตุ</th>
              <th className="py-3 px-4" />
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-10 text-gray-400">
                  ยังไม่มีประวัติการบันทึกยอดยกมา
                </td>
              </tr>
            ) : (
              docs.map((d) => (
                <tr
                  key={d.id}
                  className={`border-t border-gray-50 transition-colors ${
                    d.status === "CANCELLED" ? "opacity-50 bg-red-50" : "hover:bg-gray-50"
                  }`}
                >
                  <td className="py-3 px-4 font-mono text-[#1e3a5f] font-medium">{d.docNo}</td>
                  <td className="py-3 px-4 text-gray-600">
                    {new Date(d.docDate).toLocaleDateString("th-TH")}
                  </td>
                  <td className="py-3 px-4 text-gray-700">
                    <span className="font-mono text-xs text-gray-400">[{d.product.code}]</span>{" "}
                    {d.product.name}
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-gray-900">
                    {d.qtyInBase.toLocaleString("th-TH", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                  </td>
                  <td className="py-3 px-4 text-right text-gray-700">
                    {d.costPerBaseUnit.toLocaleString("th-TH", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}
                  </td>
                  <td className="py-3 px-4">
                    {d.status === "CANCELLED" ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">
                        ยกเลิกแล้ว
                      </span>
                    ) : (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        ใช้งาน
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-500 text-xs">
                    {d.status === "CANCELLED" && d.cancelNote
                      ? <span className="text-red-500">ยกเลิก: {d.cancelNote}</span>
                      : (d.note ?? "-")}
                  </td>
                  <td className="py-3 px-4 text-right">
                    {d.status === "ACTIVE" && (
                      <CancelDocButton
                        docId={d.id}
                        idFieldName="bfId"
                        cancelAction={cancelBF}
                        onSuccess={() => router.refresh()}
                      />
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default BfHistoryTable;
