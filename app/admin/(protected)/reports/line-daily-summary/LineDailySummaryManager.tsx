"use client";

import { useMemo, useState, useTransition } from "react";
import { LineDailySummaryTargetMode, LineRecipientType } from "@/lib/generated/prisma";
import { formatDateTimeThai } from "@/lib/th-date";
import {
  linkAdminLineRecipientAction,
  saveLineDailySummarySettingsAction,
  sendLineDailySummaryTestAction,
  unlinkAdminLineRecipientAction,
} from "@/app/admin/(protected)/reports/line-daily-summary/actions";

type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  lineRecipient: {
    id: string;
    lineId: string;
    displayName: string | null;
  } | null;
};

type RecipientRow = {
  id: string;
  lineId: string;
  type: LineRecipientType;
  displayName: string | null;
  sourceName: string | null;
  lastWebhookAt: string | null;
  linkedUserName: string | null;
};

type DispatchRow = {
  id: string;
  reportDayKey: string;
  dispatchKind: string;
  status: string;
  targetMode: string;
  recipientCount: number;
  sentCount: number;
  errorMessage: string | null;
  createdAt: string;
};

const inputCls =
  "h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#1e3a5f] dark:border-white/10 dark:bg-slate-950/80 dark:text-slate-100";
const RECIPIENTS_PER_PAGE = 10;

const targetModeLabels: Record<LineDailySummaryTargetMode, string> = {
  ENV_IDS: "ส่งตาม LINE_DAILY_SUMMARY_TO_IDS",
  ADMIN_USERS: "ส่งหา ADMIN ที่ผูก LINE แล้ว",
};

function formatDateTime(value: string | null) {
  if (!value) return "-";
  return formatDateTimeThai(value, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function getDispatchKindLabel(value: string) {
  if (value === "SCHEDULED") return "อัตโนมัติ";
  if (value === "TEST") return "ทดสอบ";
  return value;
}

function getDispatchReasonLabel(value: string | null) {
  if (!value) return null;

  if (value === "QSTASH_INVOKED" || value === "CRON_INVOKED") {
    return value === "QSTASH_INVOKED"
      ? "QStash เรียกเข้ามาแล้ว กำลังประมวลผล"
      : "cron เรียกเข้ามาแล้ว กำลังประมวลผล";
  }

  if (value.startsWith("UNHANDLED_EXCEPTION:")) {
    return `เกิดข้อผิดพลาดก่อนส่งจริง: ${value.replace("UNHANDLED_EXCEPTION:", "").trim()}`;
  }

  if (value.startsWith("SUMMARY_QUERY_FAILED:")) {
    const detail = value.replace("SUMMARY_QUERY_FAILED:", "").trim();
    return `ดึงข้อมูลสรุปรายวันไม่สำเร็จ: ${detail}`;
  }

  if (value === "ALREADY_SENT" || value === "ALREADY_DISPATCHED") {
    return "ข้ามเพราะส่งแล้ววันนี้";
  }

  if (value === "DISABLED") {
    return "ข้ามเพราะปิดใช้งาน";
  }

  if (value === "TOO_EARLY") {
    return "ข้ามเพราะยังไม่ถึงเวลาส่ง";
  }

  if (value.startsWith("CONFIG_INCOMPLETE:")) {
    const missing = value.replace("CONFIG_INCOMPLETE:", "").trim();
    return missing ? `ตั้งค่าไม่ครบ: ${missing}` : "ตั้งค่าการส่งไม่ครบ";
  }

  return value;
}

function getDispatchStatusLabel(dispatch: DispatchRow) {
  if (dispatch.status === "SENT") return "ส่งแล้ว";
  if (dispatch.status === "PROCESSING") return "กำลังส่ง";
  if (dispatch.status === "SKIPPED") {
    return getDispatchReasonLabel(dispatch.errorMessage) ?? "ข้ามการส่ง";
  }
  if (dispatch.status === "FAILED") {
    return getDispatchReasonLabel(dispatch.errorMessage) ?? "ส่งไม่สำเร็จ";
  }

  return dispatch.status;
}

function getLatestScheduleStatusLabel(params: {
  settings: {
    enabled: boolean;
    lastSentDayKey: string | null;
  };
  reportDayKey: string;
  recentDispatches: DispatchRow[];
}) {
  const latestScheduled = params.recentDispatches.find(
    (dispatch) => dispatch.dispatchKind === "SCHEDULED"
  );

  if (!params.settings.enabled) {
    return "ปิดใช้งาน";
  }

  if (latestScheduled && latestScheduled.reportDayKey === params.reportDayKey) {
    return getDispatchStatusLabel(latestScheduled);
  }

  if (params.settings.lastSentDayKey === params.reportDayKey) {
    return "ส่งแล้ว";
  }

  return "รอรอบส่งวันนี้";
}

function isRecipientVisibleWithin90Days(recipient: RecipientRow) {
  if (recipient.linkedUserName) {
    return true;
  }

  if (!recipient.lastWebhookAt) {
    return false;
  }

  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  return new Date(recipient.lastWebhookAt).getTime() >= ninetyDaysAgo;
}

export default function LineDailySummaryManager(props: {
  reportDayKey: string;
  settings: {
    enabled: boolean;
    sendTime: string;
    targetMode: LineDailySummaryTargetMode;
    compactMode: boolean;
    lastSentDayKey: string | null;
    lastSentAt: string | null;
  };
  adminUsers: AdminUserRow[];
  availableUserRecipients: RecipientRow[];
  otherRecipients: RecipientRow[];
  recentDispatches: DispatchRow[];
}) {
  const {
    reportDayKey,
    settings,
    adminUsers,
    availableUserRecipients,
    otherRecipients,
    recentDispatches,
  } = props;
  const [settingsMessage, setSettingsMessage] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [mappingMessage, setMappingMessage] = useState("");
  const [settingsPending, startSettingsTransition] = useTransition();
  const [testPending, startTestTransition] = useTransition();
  const [mappingPending, startMappingTransition] = useTransition();
  const [showOlderRecipients, setShowOlderRecipients] = useState(false);
  const [recipientPage, setRecipientPage] = useState(1);

  const latestScheduleStatus = getLatestScheduleStatusLabel({
    settings,
    reportDayKey,
    recentDispatches,
  });

  const visibleUserRecipients = useMemo(
    () =>
      showOlderRecipients
        ? availableUserRecipients
        : availableUserRecipients.filter(isRecipientVisibleWithin90Days),
    [availableUserRecipients, showOlderRecipients]
  );

  const hiddenRecipientCount = Math.max(
    availableUserRecipients.length - visibleUserRecipients.length,
    0
  );
  const recipientPageCount = Math.max(
    1,
    Math.ceil(visibleUserRecipients.length / RECIPIENTS_PER_PAGE)
  );
  const safeRecipientPage = Math.min(recipientPage, recipientPageCount);
  const paginatedUserRecipients = useMemo(() => {
    const start = (safeRecipientPage - 1) * RECIPIENTS_PER_PAGE;
    return visibleUserRecipients.slice(start, start + RECIPIENTS_PER_PAGE);
  }, [safeRecipientPage, visibleUserRecipients]);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ตั้งเวลาส่งจากในระบบ</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            ระบบจะซิงก์เวลาในหน้านี้ไปยัง QStash โดยแปลงจากเวลาไทย (Asia/Bangkok)
            ไปเป็น schedule รายวันให้อัตโนมัติ
          </p>
        </div>

        <form
          className="mt-4 grid gap-3 lg:grid-cols-[1fr_1.2fr_1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setSettingsMessage("");
            startSettingsTransition(async () => {
              const result = await saveLineDailySummarySettingsAction(formData);
              setSettingsMessage(result.success ? "บันทึกการตั้งค่าสำเร็จ" : result.error ?? "บันทึกไม่สำเร็จ");
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-slate-300">
            เปิดใช้งาน
            <select
              name="enabled"
              defaultValue={settings.enabled ? "true" : "false"}
              className={inputCls}
            >
              <option value="true">เปิด</option>
              <option value="false">ปิด</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-slate-300">
            เวลาส่งตามเวลาไทย
            <input
              type="time"
              name="sendTime"
              defaultValue={settings.sendTime}
              className={inputCls}
              step={60}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-slate-300">
            ปลายทางหลัก
            <select name="targetMode" defaultValue={settings.targetMode} className={inputCls}>
              <option value={LineDailySummaryTargetMode.ENV_IDS}>{targetModeLabels.ENV_IDS}</option>
              <option value={LineDailySummaryTargetMode.ADMIN_USERS}>
                {targetModeLabels.ADMIN_USERS}
              </option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-slate-300">
            รูปแบบข้อความ
            <select
              name="compactMode"
              defaultValue={settings.compactMode ? "true" : "false"}
              className={inputCls}
            >
              <option value="false">แสดงครบทุกแถว</option>
              <option value="true">Compact mode ซ่อนค่า 0</option>
            </select>
          </label>

          <button
            type="submit"
            disabled={settingsPending}
            className="h-10 rounded-lg bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
          >
            {settingsPending ? "กำลังบันทึก..." : "บันทึกเวลา"}
          </button>
        </form>

          <div className="mt-3 grid gap-3 text-sm text-gray-600 dark:text-slate-400 md:grid-cols-4">
            <p>ปลายทางปัจจุบัน: {targetModeLabels[settings.targetMode]}</p>
            <p>รอบส่งประจำ: {settings.sendTime} น. ทุกวัน</p>
            <p>รูปแบบข้อความ: {settings.compactMode ? "Compact mode" : "แสดงครบทุกแถว"}</p>
            <p>ส่งล่าสุด: {latestScheduleStatus} ({formatDateTime(settings.lastSentAt)})</p>
          </div>

        {settingsMessage && <p className="mt-3 text-sm text-[#1e3a5f] dark:text-sky-300">{settingsMessage}</p>}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">Test Send</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            ส่งข้อความจริงจากหน้า admin โดยยึดวันที่ preview และ target mode ที่เลือก
          </p>
        </div>

        <form
          className="mt-4 flex flex-col gap-3 md:flex-row md:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            setTestMessage("");
            startTestTransition(async () => {
              const result = await sendLineDailySummaryTestAction(formData);
              if (result.success) {
                setTestMessage(`ส่งทดสอบสำเร็จ ${result.sentCount} ปลายทาง`);
                return;
              }

              const missing = result.missingDeliveryEnv?.length
                ? ` (${result.missingDeliveryEnv.join(", ")})`
                : "";
              setTestMessage(`${result.error ?? "ส่งทดสอบไม่สำเร็จ"}${missing}`);
            });
          }}
        >
          <input type="hidden" name="date" value={reportDayKey} />
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-slate-300">
            วันที่ข้อความ
            <input
              type="date"
              value={reportDayKey}
              readOnly
              className={`${inputCls} bg-gray-50 dark:bg-slate-900/80`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-slate-300">
            ปลายทางที่ใช้ทดสอบ
            <select name="targetMode" defaultValue={settings.targetMode} className={inputCls}>
              <option value={LineDailySummaryTargetMode.ENV_IDS}>{targetModeLabels.ENV_IDS}</option>
              <option value={LineDailySummaryTargetMode.ADMIN_USERS}>
                {targetModeLabels.ADMIN_USERS}
              </option>
            </select>
          </label>
          <button
            type="submit"
            disabled={testPending}
            className="h-10 rounded-lg bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
          >
            {testPending ? "กำลังส่ง..." : "ส่งทดสอบ"}
          </button>
        </form>

        {testMessage && <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{testMessage}</p>}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ผูก LINE กับ ADMIN</h3>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            webhook จะเก็บ userId/groupId/roomId อัตโนมัติ ส่วนการส่งหา ADMIN จะใช้เฉพาะ recipient แบบ
            USER ที่ผูกกับผู้ใช้ admin แล้ว
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {adminUsers.map((user) => (
            <form
              key={user.id}
              className="grid gap-3 rounded-xl border border-gray-200 p-4 dark:border-white/10 lg:grid-cols-[1.2fr_1.4fr_auto_auto]"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                setMappingMessage("");
                startMappingTransition(async () => {
                  const result = await linkAdminLineRecipientAction(formData);
                  setMappingMessage(result.success ? "อัปเดต mapping สำเร็จ" : result.error ?? "อัปเดต mapping ไม่สำเร็จ");
                });
              }}
            >
              <input type="hidden" name="userId" value={user.id} />
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{user.name}</p>
                <p className="text-xs text-gray-500 dark:text-slate-400">{user.email}</p>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  ผูกอยู่: {user.lineRecipient?.displayName ?? user.lineRecipient?.lineId ?? "-"}
                </p>
              </div>

              <label className="flex flex-col gap-1 text-sm text-gray-700 dark:text-slate-300">
                LINE userId ที่จะใช้ส่ง
                <select name="recipientId" defaultValue={user.lineRecipient?.id ?? ""} className={inputCls}>
                  <option value="" disabled>
                    เลือก LINE userId
                  </option>
                  {visibleUserRecipients.map((recipient) => (
                    <option key={recipient.id} value={recipient.id}>
                      {(recipient.displayName ?? recipient.lineId) +
                        (recipient.linkedUserName ? ` (ผูกกับ ${recipient.linkedUserName})` : "")}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="submit"
                disabled={mappingPending}
                className="h-10 rounded-lg bg-[#1e3a5f] px-4 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
              >
                ผูกผู้ใช้
              </button>

              <button
                type="button"
                disabled={mappingPending || !user.lineRecipient}
                onClick={() => {
                  const formData = new FormData();
                  formData.append("userId", user.id);
                  setMappingMessage("");
                  startMappingTransition(async () => {
                    const result = await unlinkAdminLineRecipientAction(formData);
                    setMappingMessage(result.success ? "ยกเลิกการผูกสำเร็จ" : result.error ?? "ยกเลิกการผูกไม่สำเร็จ");
                  });
                }}
                className="h-10 rounded-lg bg-gray-100 px-4 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60 dark:bg-white/10 dark:text-slate-300 dark:hover:bg-white/15"
              >
                ยกเลิก
              </button>
            </form>
          ))}
        </div>

        {mappingMessage && <p className="mt-3 text-sm text-[#1e3a5f] dark:text-sky-300">{mappingMessage}</p>}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">Recipient จาก webhook</h3>
              <p className="text-sm text-gray-500 dark:text-slate-400">
                ซ่อนรายการที่ยังไม่ผูกและไม่มี webhook ใหม่เกิน 90 วันโดยค่าเริ่มต้น แต่ยังไม่ลบข้อมูลออกจากระบบ
              </p>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
              <input
                type="checkbox"
                checked={showOlderRecipients}
                onChange={(event) => {
                  setShowOlderRecipients(event.target.checked);
                  setRecipientPage(1);
                }}
                className="h-4 w-4 rounded border-gray-300 text-[#1e3a5f] focus:ring-[#1e3a5f] dark:border-white/20 dark:bg-slate-900"
              />
              แสดงรายการเก่าเกิน 90 วัน
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-gray-500 dark:text-slate-400">
            <span>แสดงอยู่ {visibleUserRecipients.length} รายการ</span>
            {hiddenRecipientCount > 0 && <span>ซ่อนอยู่ {hiddenRecipientCount} รายการ</span>}
            {visibleUserRecipients.length > 0 && (
              <span>
                หน้า {safeRecipientPage}/{recipientPageCount}
              </span>
            )}
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">LINE ID</th>
                  <th className="px-3 py-2 font-medium">ประเภท</th>
                  <th className="px-3 py-2 font-medium">ผูกกับ</th>
                  <th className="px-3 py-2 font-medium">ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUserRecipients.map((recipient) => (
                  <tr key={recipient.id} className="border-t border-gray-100 dark:border-white/10">
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-200">{recipient.displayName ?? recipient.lineId}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{recipient.type}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{recipient.linkedUserName ?? "-"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{formatDateTime(recipient.lastWebhookAt)}</td>
                  </tr>
                ))}
                {visibleUserRecipients.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-gray-500 dark:text-slate-400">
                      {availableUserRecipients.length === 0
                        ? "ยังไม่มี LINE userId จาก webhook"
                        : "ไม่มีรายการที่ตรงเงื่อนไขการแสดงผลตอนนี้"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {visibleUserRecipients.length > RECIPIENTS_PER_PAGE && (
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-gray-500 dark:text-slate-400">แสดงทีละ {RECIPIENTS_PER_PAGE} รายการต่อหน้า</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setRecipientPage((current) => Math.max(1, current - 1))}
                  disabled={safeRecipientPage === 1}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                >
                  ก่อนหน้า
                </button>
                <span className="text-sm text-gray-600 dark:text-slate-400">
                  หน้า {safeRecipientPage} / {recipientPageCount}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setRecipientPage((current) => Math.min(recipientPageCount, current + 1))
                  }
                  disabled={safeRecipientPage === recipientPageCount}
                  className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
          <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">Group / Room ที่เก็บได้</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500 dark:bg-white/5 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">LINE ID</th>
                  <th className="px-3 py-2 font-medium">ประเภท</th>
                  <th className="px-3 py-2 font-medium">ที่มา</th>
                  <th className="px-3 py-2 font-medium">ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {otherRecipients.map((recipient) => (
                  <tr key={recipient.id} className="border-t border-gray-100 dark:border-white/10">
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-200">{recipient.lineId}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{recipient.type}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{recipient.sourceName ?? "-"}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{formatDateTime(recipient.lastWebhookAt)}</td>
                  </tr>
                ))}
                {otherRecipients.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-gray-500 dark:text-slate-400">
                      ยังไม่มี groupId / roomId ที่ webhook เก็บมา
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-slate-950/80">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-kanit text-lg font-semibold text-gray-900 dark:text-slate-100">ประวัติการส่งล่าสุด</h3>
          <p className="text-xs text-gray-500 dark:text-slate-400">แสดง 10 รายการล่าสุด</p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500 dark:bg-white/5 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">วันรายงาน</th>
                <th className="px-3 py-2 font-medium">ประเภท</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
                <th className="px-3 py-2 font-medium">ปลายทาง</th>
                <th className="px-3 py-2 font-medium">ส่งแล้ว</th>
                <th className="px-3 py-2 font-medium">เวลา</th>
              </tr>
            </thead>
            <tbody>
              {recentDispatches.map((dispatch) => (
                <tr key={dispatch.id} className="border-t border-gray-100 align-top dark:border-white/10">
                  <td className="px-3 py-2 text-gray-700 dark:text-slate-200">{dispatch.reportDayKey}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{getDispatchKindLabel(dispatch.dispatchKind)}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                    <div className="space-y-1">
                      <p>{getDispatchStatusLabel(dispatch)}</p>
                      {dispatch.errorMessage && (
                          <p className="text-xs text-gray-400 dark:text-slate-500">{dispatch.errorMessage}</p>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                    {targetModeLabels[dispatch.targetMode as LineDailySummaryTargetMode] ??
                      dispatch.targetMode}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-400">
                    {dispatch.sentCount}/{dispatch.recipientCount}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-slate-400">{formatDateTime(dispatch.createdAt)}</td>
                </tr>
              ))}
              {recentDispatches.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-gray-500 dark:text-slate-400">
                    ยังไม่มีประวัติการส่ง
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
