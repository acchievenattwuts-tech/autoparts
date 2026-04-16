"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import type {
  ContentApprovalStatus,
  ContentNotificationType,
  ContentPostStatus,
  ContentScheduledJobStatus,
  Role,
} from "@/lib/generated/prisma";
import {
  approveAndPublishNowAction,
  approveAndScheduleContentAction,
  cancelContentPostAction,
  requestContentApprovalAction,
  requestRevisionContentAction,
  retryFailedScheduledPublishAction,
  selectContentVariantAction,
  updateContentDraftAction,
} from "@/app/admin/(protected)/content/actions";
import { formatDateTimeLocal, formatThaiDateTime, truncateText } from "@/lib/content-utils";

type VariantRow = {
  id: string;
  title: string | null;
  caption: string;
  status: ContentPostStatus;
  variantNo: number | null;
  isSelectedVariant: boolean;
};

type ApproverOption = {
  id: string;
  name: string;
  email: string;
  role: Role;
  lineId: string;
};

type ContentDetailData = {
  id: string;
  title: string | null;
  caption: string;
  imageUrl: string | null;
  linkUrl: string | null;
  status: ContentPostStatus;
  scheduledAt: string | null;
  postedAt: string | null;
  approvedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  createdByUser: { id: string; name: string; email: string };
  approvedByUser: { id: string; name: string; email: string } | null;
  approvals: Array<{
    id: string;
    status: ContentApprovalStatus;
    requestNote: string | null;
    decisionNote: string | null;
    requestedAt: string;
    actedAt: string | null;
    approverUser: { id: string; name: string; email: string };
    requestedByUser: { id: string; name: string; email: string };
  }>;
  scheduledJobs: Array<{
    id: string;
    status: ContentScheduledJobStatus;
    runAt: string;
    attemptCount: number;
    lastError: string | null;
  }>;
  auditLogs: Array<{
    id: string;
    action: string;
    detail: string | null;
    notificationType: ContentNotificationType | null;
    createdAt: string;
    actorUser: { id: string; name: string; email: string } | null;
  }>;
};

const inputCls =
  "h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";
const textareaCls =
  "min-h-28 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

function toFriendlyMessage(message: string) {
  switch (message) {
    case "APP_BASE_URL_NOT_CONFIGURED":
      return "ยังไม่ได้ตั้งค่า APP_BASE_URL";
    case "FACEBOOK_PUBLISH_NOT_CONFIGURED":
      return "ยังไม่ได้ตั้งค่า Facebook Page ID หรือ Access Token";
    case "QSTASH_NOT_CONFIGURED":
      return "ยังไม่ได้ตั้งค่า QStash token/signing keys";
    case "ACTIVE_SCHEDULE_ALREADY_EXISTS":
      return "มีงาน schedule ที่ยัง active อยู่แล้วสำหรับโพสต์นี้";
    case "POST_NOT_FOUND":
      return "ไม่พบโพสต์ที่ต้องการทำรายการ";
    case "REQUEUE_PUBLISH_FAILED":
      return "requeue งาน publish ไม่สำเร็จ";
    case "SCHEDULE_TIME_MUST_BE_IN_THE_FUTURE":
      return "เวลา schedule ใหม่ต้องมากกว่าปัจจุบัน";
    default:
      return message;
  }
}

export default function ContentDetailManager({
  post,
  variants,
  approvers,
  canUpdate,
  canManage,
}: {
  post: ContentDetailData;
  variants: VariantRow[];
  approvers: ApproverOption[];
  canUpdate: boolean;
  canManage: boolean;
}) {
  const [message, setMessage] = useState("");
  const [savePending, startSaveTransition] = useTransition();
  const [selectPending, startSelectTransition] = useTransition();
  const [approvalPending, startApprovalTransition] = useTransition();
  const [decisionPending, startDecisionTransition] = useTransition();
  const router = useRouter();

  const currentPendingApproval = useMemo(
    () => post.approvals.find((approval) => approval.status === "PENDING") ?? null,
    [post.approvals]
  );
  const failedScheduledJob = useMemo(
    () => post.scheduledJobs.find((job) => job.status === "FAILED") ?? null,
    [post.scheduledJobs]
  );

  const runAction = async (
    runner: () => Promise<{ success?: boolean; error?: string }>,
    successMessage: string
  ) => {
    setMessage("");
    const result = await runner();
    setMessage(
      result.success ? successMessage : toFriendlyMessage(result.error ?? "ทำรายการไม่สำเร็จ")
    );
    if (result.success) {
      router.refresh();
    }
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="font-kanit text-lg font-semibold text-gray-900">
              {post.title || "รายละเอียดคอนเทนต์ Facebook"}
            </h2>
            <p className="text-sm text-gray-500">
              สถานะปัจจุบัน: {post.status} | ผู้สร้าง: {post.createdByUser.name}
            </p>
          </div>
          <Link
            href="/admin/content"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            กลับไปหน้ารายการ
          </Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-500">สร้างเมื่อ</p>
            <p className="mt-1 font-kanit text-base text-gray-900">{formatThaiDateTime(post.createdAt)}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-500">เวลาโพสต์</p>
            <p className="mt-1 font-kanit text-base text-gray-900">
              {post.scheduledAt ? formatThaiDateTime(post.scheduledAt) : "-"}
            </p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-500">อนุมัติโดย</p>
            <p className="mt-1 font-kanit text-base text-gray-900">{post.approvedByUser?.name ?? "-"}</p>
          </div>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <p className="text-xs font-medium text-gray-500">โพสต์จริงเมื่อ</p>
            <p className="mt-1 font-kanit text-base text-gray-900">
              {post.postedAt ? formatThaiDateTime(post.postedAt) : "-"}
            </p>
          </div>
        </div>

        {post.lastError && (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <p className="font-medium">ข้อผิดพลาดล่าสุด</p>
            <p className="mt-1 whitespace-pre-wrap break-words">{post.lastError}</p>
          </div>
        )}

        {message && (
          <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
            {message}
          </div>
        )}
      </section>

      {variants.length > 1 && (
        <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <h3 className="font-kanit text-lg font-semibold text-gray-900">ชุด draft 3 ตัวเลือก</h3>
            <p className="text-sm text-gray-500">เลือกตัวที่ต้องการใช้ก่อนส่งอนุมัติหรือโพสต์จริง</p>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {variants.map((variant) => (
              <div
                key={variant.id}
                className={`rounded-2xl border p-4 ${
                  variant.isSelectedVariant
                    ? "border-[#1e3a5f] bg-[#1e3a5f]/5"
                    : "border-gray-200 bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gray-900">
                      แบบที่ {variant.variantNo ?? "-"} {variant.title ? `| ${variant.title}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">สถานะ: {variant.status}</p>
                  </div>
                  {variant.isSelectedVariant && (
                    <span className="rounded-full bg-[#1e3a5f] px-2.5 py-1 text-xs font-medium text-white">
                      ตัวหลัก
                    </span>
                  )}
                </div>
                <p className="mt-3 text-sm text-gray-600">
                  {truncateText(variant.caption.replace(/\s+/g, " ").trim(), 180)}
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {variant.id !== post.id && (
                    <Link
                      href={`/admin/content/${variant.id}`}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      เปิดแบบนี้
                    </Link>
                  )}
                  {canUpdate && !variant.isSelectedVariant && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const formData = new FormData();
                        formData.set("postId", variant.id);
                        startSelectTransition(() =>
                          runAction(() => selectContentVariantAction(formData), "เลือก draft ตัวนี้แล้ว")
                        );
                      }}
                    >
                      <button
                        type="submit"
                        disabled={selectPending}
                        className="rounded-lg bg-[#1e3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
                      >
                        เลือกเป็นตัวหลัก
                      </button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <h3 className="font-kanit text-lg font-semibold text-gray-900">แก้ไข draft</h3>
          <p className="text-sm text-gray-500">ปรับข้อความ รูป และเวลาที่ต้องการก่อนส่งอนุมัติ</p>
        </div>

        <form
          className="mt-4 grid gap-3 lg:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            const formData = new FormData(event.currentTarget);
            formData.set("id", post.id);
            startSaveTransition(() =>
              runAction(() => updateContentDraftAction(formData), "บันทึก draft เรียบร้อย")
            );
          }}
        >
          <label className="flex flex-col gap-1 text-sm text-gray-700 lg:col-span-2">
            หัวข้อโพสต์
            <input
              name="title"
              defaultValue={post.title ?? ""}
              className={inputCls}
              disabled={!canUpdate || savePending}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 lg:col-span-2">
            แคปชัน
            <textarea
              name="caption"
              defaultValue={post.caption}
              className={textareaCls}
              disabled={!canUpdate || savePending}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            รูปภาพ URL
            <input
              name="imageUrl"
              defaultValue={post.imageUrl ?? ""}
              className={inputCls}
              disabled={!canUpdate || savePending}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            ลิงก์แนบ
            <input
              name="linkUrl"
              defaultValue={post.linkUrl ?? ""}
              className={inputCls}
              disabled={!canUpdate || savePending}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            เวลาโพสต์ที่ต้องการ
            <input
              type="datetime-local"
              name="scheduledAt"
              defaultValue={formatDateTimeLocal(post.scheduledAt)}
              className={inputCls}
              disabled={!canUpdate || savePending}
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={!canUpdate || savePending}
              className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
            >
              {savePending ? "กำลังบันทึก..." : "บันทึก draft"}
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="grid gap-5 xl:grid-cols-2">
          <div>
            <h3 className="font-kanit text-lg font-semibold text-gray-900">ส่งอนุมัติ</h3>
            <p className="mt-1 text-sm text-gray-500">
              ระบบจะ reuse LINE OA เดิม แล้วส่งข้อความไปยังผู้อนุมัติที่ผูก LINE ไว้แล้ว
            </p>

            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                formData.set("postId", post.id);
                startApprovalTransition(() =>
                  runAction(
                    () => requestContentApprovalAction(formData),
                    "ส่งคำขออนุมัติและแจ้ง LINE เรียบร้อย"
                  )
                );
              }}
            >
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                ผู้อนุมัติ
                <select
                  name="approverUserId"
                  className={inputCls}
                  defaultValue={currentPendingApproval?.approverUser.id ?? approvers[0]?.id ?? ""}
                  disabled={!canUpdate || approvalPending}
                >
                  {approvers.map((approver) => (
                    <option key={approver.id} value={approver.id}>
                      {approver.name} ({approver.email})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={!canUpdate || approvalPending || approvers.length === 0}
                className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
              >
                {approvalPending ? "กำลังส่งอนุมัติ..." : "ส่งขออนุมัติ"}
              </button>
            </form>
          </div>

          <div>
            <h3 className="font-kanit text-lg font-semibold text-gray-900">ตัดสินใจอนุมัติ</h3>
            <p className="mt-1 text-sm text-gray-500">
              ใช้สำหรับผู้อนุมัติ schedule โพสต์ หรือโพสต์ทันทีเมื่อพร้อม
            </p>

            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                const formData = new FormData(event.currentTarget);
                formData.set("postId", post.id);
                startDecisionTransition(() =>
                  runAction(
                    () => approveAndScheduleContentAction(formData),
                    "อนุมัติและตั้งเวลาโพสต์เรียบร้อย"
                  )
                );
              }}
            >
              <label className="flex flex-col gap-1 text-sm text-gray-700">
                เวลาโพสต์
                <input
                  type="datetime-local"
                  name="scheduledAt"
                  defaultValue={formatDateTimeLocal(post.scheduledAt)}
                  className={inputCls}
                  disabled={!canManage || decisionPending}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={!canManage || decisionPending}
                  className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
                >
                  {decisionPending ? "กำลังตั้งเวลา..." : "อนุมัติและตั้งเวลา"}
                </button>
                <button
                  type="button"
                  disabled={!canManage || decisionPending}
                  onClick={() => {
                    const formData = new FormData();
                    formData.set("postId", post.id);
                    startDecisionTransition(() =>
                      runAction(
                        () => approveAndPublishNowAction(formData),
                        "อนุมัติและโพสต์เข้า Facebook แล้ว"
                      )
                    );
                  }}
                  className="rounded-lg border border-emerald-300 px-4 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                >
                  โพสต์ทันที
                </button>
                <button
                  type="button"
                  disabled={!canManage || decisionPending}
                  onClick={() => {
                    const note = window.prompt("ระบุเหตุผลที่ตีกลับ draft", "") ?? "";
                    const formData = new FormData();
                    formData.set("postId", post.id);
                    formData.set("decisionNote", note);
                    startDecisionTransition(() =>
                      runAction(
                        () => requestRevisionContentAction(formData),
                        "ตีกลับ draft เพื่อให้แก้ไขแล้ว"
                      )
                    );
                  }}
                  className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                >
                  ขอแก้ไข
                </button>
                <button
                  type="button"
                  disabled={!canUpdate || decisionPending}
                  onClick={() => {
                    const formData = new FormData();
                    formData.set("postId", post.id);
                    startDecisionTransition(() =>
                      runAction(() => cancelContentPostAction(formData), "ยกเลิกโพสต์แล้ว")
                    );
                  }}
                  className="rounded-lg border border-rose-300 px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                >
                  ยกเลิกโพสต์
                </button>
                {failedScheduledJob && (
                  <button
                    type="button"
                    disabled={!canManage || decisionPending}
                    onClick={() => {
                      const formData = new FormData();
                      formData.set("postId", post.id);
                      if (post.scheduledAt) {
                        formData.set("scheduledAt", formatDateTimeLocal(post.scheduledAt));
                      }
                      startDecisionTransition(() =>
                        runAction(
                          () => retryFailedScheduledPublishAction(formData),
                          "requeue งาน publish แล้ว"
                        )
                      );
                    }}
                    className="rounded-lg border border-sky-300 px-4 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-60"
                  >
                    Requeue งานที่ fail
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-2">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="font-kanit text-lg font-semibold text-gray-900">ประวัติการอนุมัติ</h3>
          <div className="mt-4 space-y-3">
            {post.approvals.map((approval) => (
              <div key={approval.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="font-medium text-gray-900">
                  {approval.status} | ผู้อนุมัติ {approval.approverUser.name}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  ขออนุมัติโดย {approval.requestedByUser.name} เมื่อ {formatThaiDateTime(approval.requestedAt)}
                </p>
                {approval.actedAt && (
                  <p className="mt-1 text-sm text-gray-500">
                    ตัดสินใจเมื่อ {formatThaiDateTime(approval.actedAt)}
                  </p>
                )}
                {approval.decisionNote && (
                  <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{approval.decisionNote}</p>
                )}
              </div>
            ))}
            {post.approvals.length === 0 && <p className="text-sm text-gray-500">ยังไม่มีประวัติการอนุมัติ</p>}
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="font-kanit text-lg font-semibold text-gray-900">งาน schedule และ audit log</h3>
          <div className="mt-4 space-y-3">
            {post.scheduledJobs.map((job) => (
              <div key={job.id} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <p className="font-medium text-gray-900">
                  {job.status} | {formatThaiDateTime(job.runAt)}
                </p>
                <p className="mt-1 text-sm text-gray-500">พยายามส่งแล้ว {job.attemptCount} ครั้ง</p>
                {job.lastError && <p className="mt-2 whitespace-pre-wrap text-sm text-rose-700">{job.lastError}</p>}
              </div>
            ))}
            {post.auditLogs.map((log) => (
              <div key={log.id} className="rounded-xl border border-dashed border-gray-200 p-4">
                <p className="font-medium text-gray-900">{log.action}</p>
                <p className="mt-1 text-sm text-gray-500">
                  {formatThaiDateTime(log.createdAt)}
                  {log.actorUser ? ` | ${log.actorUser.name}` : ""}
                </p>
                {log.detail && <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{log.detail}</p>}
              </div>
            ))}
            {post.scheduledJobs.length === 0 && post.auditLogs.length === 0 && (
              <p className="text-sm text-gray-500">ยังไม่มีงาน schedule หรือ audit log</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
