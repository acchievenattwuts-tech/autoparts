"use client";

import { useState, useTransition } from "react";
import { LineDailySummaryTargetMode, LineRecipientType } from "@/lib/generated/prisma";
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
  createdAt: string;
};

const inputCls =
  "h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

const targetModeLabels: Record<LineDailySummaryTargetMode, string> = {
  ENV_IDS: "ส่งตาม LINE_DAILY_SUMMARY_TO_IDS",
  ADMIN_USERS: "ส่งหา ADMIN ที่ผูก LINE แล้ว",
};

function formatDateTime(value: string | null) {
  if (!value) return "-";

  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function LineDailySummaryManager(props: {
  reportDayKey: string;
  settings: {
    enabled: boolean;
    sendTime: string;
    targetMode: LineDailySummaryTargetMode;
    lastSentDayKey: string | null;
    lastSentAt: string | null;
  };
  adminUsers: AdminUserRow[];
  availableUserRecipients: RecipientRow[];
  otherRecipients: RecipientRow[];
  recentDispatches: DispatchRow[];
}) {
  const { reportDayKey, settings, adminUsers, availableUserRecipients, otherRecipients, recentDispatches } = props;
  const [settingsMessage, setSettingsMessage] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [mappingMessage, setMappingMessage] = useState("");
  const [settingsPending, startSettingsTransition] = useTransition();
  const [testPending, startTestTransition] = useTransition();
  const [mappingPending, startMappingTransition] = useTransition();

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900">ตั้งเวลาส่งจากในระบบ</h3>
          <p className="text-sm text-gray-500">
            Cron จะวิ่งถี่เป็นรอบ ๆ และ route จะเช็กเวลาที่ตั้งไว้ใน DB ก่อนส่งจริง พร้อมกันส่งซ้ำด้วย dispatch log
          </p>
        </div>

        <form
          className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]"
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
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            เปิดใช้งาน
            <select name="enabled" defaultValue={settings.enabled ? "true" : "false"} className={inputCls}>
              <option value="true">เปิด</option>
              <option value="false">ปิด</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700">
            เวลาส่ง (Asia/Bangkok)
            <input type="time" name="sendTime" defaultValue={settings.sendTime} className={inputCls} />
          </label>

          <label className="flex flex-col gap-1 text-sm text-gray-700">
            ปลายทางหลัก
            <select name="targetMode" defaultValue={settings.targetMode} className={inputCls}>
              <option value={LineDailySummaryTargetMode.ENV_IDS}>{targetModeLabels.ENV_IDS}</option>
              <option value={LineDailySummaryTargetMode.ADMIN_USERS}>{targetModeLabels.ADMIN_USERS}</option>
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

        <div className="mt-3 grid gap-3 text-sm text-gray-600 md:grid-cols-3">
          <p>ปลายทางปัจจุบัน: {targetModeLabels[settings.targetMode]}</p>
          <p>ส่งล่าสุด: {settings.lastSentDayKey ?? "-"}</p>
          <p>เวลา send ล่าสุด: {formatDateTime(settings.lastSentAt)}</p>
        </div>

        {settingsMessage && <p className="mt-3 text-sm text-[#1e3a5f]">{settingsMessage}</p>}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900">Test Send</h3>
          <p className="text-sm text-gray-500">
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
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            วันที่ข้อความ
            <input type="date" value={reportDayKey} readOnly className={`${inputCls} bg-gray-50`} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            ปลายทางที่ใช้ทดสอบ
            <select name="targetMode" defaultValue={settings.targetMode} className={inputCls}>
              <option value={LineDailySummaryTargetMode.ENV_IDS}>{targetModeLabels.ENV_IDS}</option>
              <option value={LineDailySummaryTargetMode.ADMIN_USERS}>{targetModeLabels.ADMIN_USERS}</option>
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

        {testMessage && <p className="mt-3 text-sm text-emerald-700">{testMessage}</p>}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900">ผูก LINE กับ ADMIN</h3>
          <p className="text-sm text-gray-500">
            webhook จะเก็บ `userId/groupId/roomId` อัตโนมัติ ส่วนการส่งหา ADMIN จะใช้เฉพาะ recipient แบบ `USER` ที่ผูกกับผู้ใช้ admin แล้ว
          </p>
        </div>

        <div className="mt-4 space-y-3">
          {adminUsers.map((user) => (
            <form
              key={user.id}
              className="grid gap-3 rounded-xl border border-gray-200 p-4 lg:grid-cols-[1.2fr_1.4fr_auto_auto]"
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
                <p className="text-sm font-medium text-gray-900">{user.name}</p>
                <p className="text-xs text-gray-500">{user.email}</p>
                <p className="mt-1 text-xs text-gray-500">
                  ผูกอยู่: {user.lineRecipient?.displayName ?? user.lineRecipient?.lineId ?? "-"}
                </p>
              </div>

              <label className="flex flex-col gap-1 text-sm text-gray-700">
                LINE userId ที่จะใช้ส่ง
                <select name="recipientId" defaultValue={user.lineRecipient?.id ?? ""} className={inputCls}>
                  <option value="" disabled>
                    เลือก LINE userId
                  </option>
                  {availableUserRecipients.map((recipient) => (
                    <option key={recipient.id} value={recipient.id}>
                      {(recipient.displayName ?? recipient.lineId) + (recipient.linkedUserName ? ` (ผูกกับ ${recipient.linkedUserName})` : "")}
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
                className="h-10 rounded-lg bg-gray-100 px-4 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-60"
              >
                ยกเลิก
              </button>
            </form>
          ))}
        </div>

        {mappingMessage && <p className="mt-3 text-sm text-[#1e3a5f]">{mappingMessage}</p>}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="font-kanit text-lg font-semibold text-gray-900">Recipient จาก webhook</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">LINE ID</th>
                  <th className="px-3 py-2 font-medium">ประเภท</th>
                  <th className="px-3 py-2 font-medium">ผูกกับ</th>
                  <th className="px-3 py-2 font-medium">ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {availableUserRecipients.map((recipient) => (
                  <tr key={recipient.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-700">{recipient.displayName ?? recipient.lineId}</td>
                    <td className="px-3 py-2 text-gray-600">{recipient.type}</td>
                    <td className="px-3 py-2 text-gray-600">{recipient.linkedUserName ?? "-"}</td>
                    <td className="px-3 py-2 text-gray-600">{formatDateTime(recipient.lastWebhookAt)}</td>
                  </tr>
                ))}
                {availableUserRecipients.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                      ยังไม่มี LINE userId จาก webhook
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5">
          <h3 className="font-kanit text-lg font-semibold text-gray-900">Group / Room ที่เก็บได้</h3>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-gray-500">
                <tr>
                  <th className="px-3 py-2 font-medium">LINE ID</th>
                  <th className="px-3 py-2 font-medium">ประเภท</th>
                  <th className="px-3 py-2 font-medium">ที่มา</th>
                  <th className="px-3 py-2 font-medium">ล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {otherRecipients.map((recipient) => (
                  <tr key={recipient.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-700">{recipient.lineId}</td>
                    <td className="px-3 py-2 text-gray-600">{recipient.type}</td>
                    <td className="px-3 py-2 text-gray-600">{recipient.sourceName ?? "-"}</td>
                    <td className="px-3 py-2 text-gray-600">{formatDateTime(recipient.lastWebhookAt)}</td>
                  </tr>
                ))}
                {otherRecipients.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                      ยังไม่มี groupId / roomId ที่ webhook เก็บมา
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5">
        <h3 className="font-kanit text-lg font-semibold text-gray-900">ประวัติการส่งล่าสุด</h3>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
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
                <tr key={dispatch.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-700">{dispatch.reportDayKey}</td>
                  <td className="px-3 py-2 text-gray-600">{dispatch.dispatchKind}</td>
                  <td className="px-3 py-2 text-gray-600">{dispatch.status}</td>
                  <td className="px-3 py-2 text-gray-600">{targetModeLabels[dispatch.targetMode as LineDailySummaryTargetMode] ?? dispatch.targetMode}</td>
                  <td className="px-3 py-2 text-gray-600">
                    {dispatch.sentCount}/{dispatch.recipientCount}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{formatDateTime(dispatch.createdAt)}</td>
                </tr>
              ))}
              {recentDispatches.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-gray-500">
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
