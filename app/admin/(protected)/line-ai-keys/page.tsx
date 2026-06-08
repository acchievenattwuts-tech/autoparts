export const dynamic = "force-dynamic";

import { KeyRound } from "lucide-react";

import AdminAiKeyResetButton from "@/components/shared/AdminAiKeyResetButton";
import { hasPermissionAccess } from "@/lib/access-control";
import { AiApiKeyStatus } from "@/lib/generated/prisma";
import { listAiApiKeyStates, type AiApiKeyStateView } from "@/lib/google-ai-keys";
import { requirePermission } from "@/lib/require-auth";
import { formatDateTimeThai } from "@/lib/th-date";

type EffectiveStatus = "AVAILABLE" | "COOLING_DOWN" | "DISABLED" | "UNCONFIGURED";

function effectiveStatus(row: AiApiKeyStateView, now: Date): EffectiveStatus {
  if (!row.configured) return "UNCONFIGURED";
  if (row.status === AiApiKeyStatus.DISABLED) return "DISABLED";
  if (row.status === AiApiKeyStatus.COOLING_DOWN && row.cooldownUntil && row.cooldownUntil > now) {
    return "COOLING_DOWN";
  }
  return "AVAILABLE";
}

const statusMeta: Record<EffectiveStatus, { label: string; badge: string }> = {
  AVAILABLE: {
    label: "พร้อมใช้",
    badge: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  },
  COOLING_DOWN: {
    label: "พักชั่วคราว",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
  },
  DISABLED: {
    label: "ปิดใช้ (key เสีย)",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-200",
  },
  UNCONFIGURED: {
    label: "ไม่ได้ตั้งค่า env",
    badge: "bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-slate-300",
  },
};

export default async function LineAiKeysPage() {
  const session = await requirePermission("line_ai_keys.view");
  const canManage = hasPermissionAccess(
    session.user.role,
    session.user.permissions,
    "line_ai_keys.manage",
  );

  const rows = await listAiApiKeyStates();
  const now = new Date();
  const withStatus = rows.map((row) => ({ row, status: effectiveStatus(row, now) }));

  const availableCount = withStatus.filter((item) => item.status === "AVAILABLE").length;
  const coolingCount = withStatus.filter((item) => item.status === "COOLING_DOWN").length;
  const disabledCount = withStatus.filter((item) => item.status === "DISABLED").length;
  const configuredCount = rows.filter((row) => row.configured).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#1e3a5f]/10 text-[#1e3a5f] dark:bg-sky-500/10 dark:text-sky-200">
          <KeyRound size={21} />
        </div>
        <div>
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            AI Keys (Gemini)
          </h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            สถานะ Google Gemini API key สำหรับ LINE OA AI Agent — ระบบสลับ key สำรองอัตโนมัติเมื่อถึงลิมิต
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "ตั้งค่าแล้ว", value: `${configuredCount} / 10`, tone: "text-gray-900 dark:text-slate-100" },
          { label: "พร้อมใช้", value: availableCount, tone: "text-emerald-600 dark:text-emerald-300" },
          { label: "พักชั่วคราว", value: coolingCount, tone: "text-amber-600 dark:text-amber-300" },
          { label: "ปิดใช้", value: disabledCount, tone: "text-red-600 dark:text-red-300" },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-gray-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-slate-950/70"
          >
            <p className="text-xs text-gray-500 dark:text-slate-400">{card.label}</p>
            <p className={`mt-1 font-kanit text-2xl font-bold ${card.tone}`}>{card.value}</p>
          </div>
        ))}
      </div>

      {configuredCount === 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
          ยังไม่ได้ตั้งค่า <code className="font-mono">GOOGLE_AI_API_KEY_1..10</code> ใน environment — AI agent
          จะใช้คำตอบสำรองแบบ rule-based จนกว่าจะใส่ key
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-slate-950/70">
        <table className="min-w-full divide-y divide-gray-100 text-sm dark:divide-white/10">
          <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-white/5 dark:text-slate-400">
            <tr>
              <th className="px-4 py-3 font-medium">Key</th>
              <th className="px-4 py-3 font-medium">สถานะ</th>
              <th className="px-4 py-3 font-medium text-right">สำเร็จ</th>
              <th className="px-4 py-3 font-medium text-right">ติดลิมิต</th>
              <th className="px-4 py-3 font-medium text-right">error</th>
              <th className="px-4 py-3 font-medium">พักถึง</th>
              <th className="px-4 py-3 font-medium">ใช้ล่าสุด</th>
              <th className="px-4 py-3 font-medium">error ล่าสุด</th>
              {canManage ? <th className="px-4 py-3 font-medium text-right">จัดการ</th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-white/10">
            {withStatus.length === 0 ? (
              <tr>
                <td
                  colSpan={canManage ? 9 : 8}
                  className="px-4 py-10 text-center text-gray-500 dark:text-slate-400"
                >
                  ยังไม่มีข้อมูล key — จะถูกสร้างอัตโนมัติเมื่อ AI agent ถูกเรียกครั้งแรก
                </td>
              </tr>
            ) : (
              withStatus.map(({ row, status }) => {
                const meta = statusMeta[status];
                return (
                  <tr key={row.keyRef} className="text-gray-800 dark:text-slate-200">
                    <td className="px-4 py-3 font-mono text-xs">{row.keyRef}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${meta.badge}`}>
                        {meta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.successCount.toLocaleString("th-TH")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.rateLimitCount.toLocaleString("th-TH")}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {row.errorCount.toLocaleString("th-TH")}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                      {status === "COOLING_DOWN" && row.cooldownUntil
                        ? formatDateTimeThai(row.cooldownUntil, { dateStyle: "short", timeStyle: "short" })
                        : "-"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                      {row.lastUsedAt
                        ? formatDateTimeThai(row.lastUsedAt, { dateStyle: "short", timeStyle: "short" })
                        : "-"}
                    </td>
                    <td className="max-w-[18rem] truncate px-4 py-3 text-xs text-gray-500 dark:text-slate-400">
                      {row.lastError ?? "-"}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-3">
                        {status === "DISABLED" || status === "COOLING_DOWN" ? (
                          <AdminAiKeyResetButton keyRef={row.keyRef} />
                        ) : (
                          <span className="block text-right text-xs text-gray-400 dark:text-slate-500">-</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-500 dark:text-slate-400">
        ระบบเลือก key ที่ว่างนานสุดก่อน และสลับไป key ถัดไปอัตโนมัติเมื่อเจอ rate limit (429) —
        secret ของ key เก็บใน environment เท่านั้น ไม่เคยบันทึกลงฐานข้อมูล
      </p>
    </div>
  );
}
