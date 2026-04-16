"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type {
  ContentApprovalStatus,
  ContentPostStatus,
  ContentScheduledJobStatus,
} from "@/lib/generated/prisma";
import {
  autoGenerateTopicAndDraftsAction,
  generateContentDraftsAction,
  suggestContentTopicsAction,
} from "@/app/admin/(protected)/content/actions";
import { formatThaiDateTime, truncateText } from "@/lib/content-utils";

type ContentListRow = {
  id: string;
  title: string | null;
  caption: string;
  status: ContentPostStatus;
  scheduledAt: string | null;
  postedAt: string | null;
  createdAt: string;
  variantGroupId: string | null;
  variantNo: number | null;
  isSelectedVariant: boolean;
  createdByUser: { id: string; name: string };
  approvedByUser: { id: string; name: string } | null;
  approvals: Array<{
    id: string;
    status: ContentApprovalStatus;
    approverUser: { id: string; name: string };
  }>;
  scheduledJobs: Array<{
    id: string;
    status: ContentScheduledJobStatus;
    runAt: string;
  }>;
};

type RuntimeStatus = {
  appBaseUrlReady: boolean;
  openAiReady: boolean;
  qstashReady: boolean;
  facebookReady: boolean;
  appBaseUrl: string | null;
  openAiModel: string;
  approverCount: number;
};

type TopicSuggestion = {
  topic: string;
  angle: string;
};

const goalOptions = ["ขาย", "ให้ความรู้", "โปรโมชัน", "ปิดการขาย"] as const;

const inputCls =
  "h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

const textareaCls =
  "min-h-28 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1e3a5f]";

export default function ContentManager({
  posts,
  runtimeStatus,
}: {
  posts: ContentListRow[];
  runtimeStatus: RuntimeStatus;
}) {
  const [message, setMessage] = useState("");
  const [topicSuggestions, setTopicSuggestions] = useState<TopicSuggestion[]>([]);
  const [formValues, setFormValues] = useState({
    topic: "",
    businessType: "อะไหล่แอร์รถยนต์",
    audience: "",
    goal: "ขาย",
    seasonOrFestival: "",
    callToAction: "",
    notes: "",
  });
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const statusTone = (ready: boolean) =>
    ready
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : "border-amber-200 bg-amber-50 text-amber-900";

  const updateField = (name: keyof typeof formValues, value: string) => {
    setFormValues((current) => ({ ...current, [name]: value }));
  };

  const buildFormData = (includeTopic: boolean) => {
    const formData = new FormData();
    if (includeTopic) {
      formData.set("topic", formValues.topic);
    }
    formData.set("businessType", formValues.businessType);
    formData.set("audience", formValues.audience);
    formData.set("goal", formValues.goal);
    formData.set("seasonOrFestival", formValues.seasonOrFestival);
    formData.set("callToAction", formValues.callToAction);
    formData.set("notes", formValues.notes);
    return formData;
  };

  const resetTopicState = () => {
    setFormValues((current) => ({ ...current, topic: "" }));
    setTopicSuggestions([]);
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="font-kanit text-lg font-semibold text-gray-900">สถานะพร้อมใช้งานของระบบโพส</h2>
          <p className="text-sm text-gray-500">
            ใช้เช็กความพร้อมก่อน generate, approve, schedule และ auto post บน production
          </p>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <div className={`rounded-xl border p-4 ${statusTone(runtimeStatus.openAiReady)}`}>
            <p className="text-xs font-medium">OpenAI draft</p>
            <p className="mt-1 font-kanit text-lg font-semibold">
              {runtimeStatus.openAiReady ? "พร้อมใช้งาน" : "ใช้ fallback"}
            </p>
            <p className="mt-1 text-xs">model: {runtimeStatus.openAiModel}</p>
          </div>
          <div className={`rounded-xl border p-4 ${statusTone(runtimeStatus.qstashReady)}`}>
            <p className="text-xs font-medium">QStash schedule</p>
            <p className="mt-1 font-kanit text-lg font-semibold">
              {runtimeStatus.qstashReady ? "พร้อมใช้งาน" : "ยังไม่ครบ"}
            </p>
          </div>
          <div className={`rounded-xl border p-4 ${statusTone(runtimeStatus.facebookReady)}`}>
            <p className="text-xs font-medium">Facebook publish</p>
            <p className="mt-1 font-kanit text-lg font-semibold">
              {runtimeStatus.facebookReady ? "พร้อมใช้งาน" : "ยังไม่ครบ"}
            </p>
          </div>
          <div className={`rounded-xl border p-4 ${statusTone(runtimeStatus.appBaseUrlReady)}`}>
            <p className="text-xs font-medium">App base URL</p>
            <p className="mt-1 font-kanit text-lg font-semibold">
              {runtimeStatus.appBaseUrlReady ? "พร้อมใช้งาน" : "ยังไม่ครบ"}
            </p>
          </div>
          <div className={`rounded-xl border p-4 ${statusTone(runtimeStatus.approverCount > 0)}`}>
            <p className="text-xs font-medium">Approver ที่ผูก LINE</p>
            <p className="mt-1 font-kanit text-lg font-semibold">{runtimeStatus.approverCount} คน</p>
          </div>
        </div>

        {(!runtimeStatus.qstashReady ||
          !runtimeStatus.facebookReady ||
          !runtimeStatus.appBaseUrlReady ||
          runtimeStatus.approverCount === 0) && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            ยังมี config บางส่วนไม่ครบ จึงอาจ generate draft ได้แต่ยัง schedule หรือโพสจริงไม่ได้ครบทุก flow
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-1">
          <h2 className="font-kanit text-lg font-semibold text-gray-900">สร้างหัวข้อและ draft ด้วย AI</h2>
          <p className="text-sm text-gray-500">
            รองรับ 2 แบบ: ให้ AI เสนอหัวข้อก่อนแล้วค่อยสร้าง draft 3 แบบ หรือให้ AI คิดหัวข้อและสร้าง draft 3 แบบทันที โดยไม่ใช้ web search
          </p>
        </div>

        <form
          className="mt-4 grid gap-3 lg:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage("");
            startTransition(async () => {
              const result = await generateContentDraftsAction(buildFormData(true));
              setMessage(result.success ? "สร้าง draft 3 ตัวเลือกสำเร็จ" : result.error ?? "สร้าง draft ไม่สำเร็จ");
              if (result.success) {
                resetTopicState();
                router.refresh();
              }
            });
          }}
        >
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            ประเภทธุรกิจ/สินค้า
            <input
              name="businessType"
              className={inputCls}
              value={formValues.businessType}
              onChange={(event) => updateField("businessType", event.target.value)}
              placeholder="เช่น อะไหล่แอร์รถยนต์"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            กลุ่มลูกค้า
            <input
              name="audience"
              className={inputCls}
              value={formValues.audience}
              onChange={(event) => updateField("audience", event.target.value)}
              placeholder="เช่น เจ้าของรถเก๋งและอู่ซ่อมรถ"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            เป้าหมายโพส
            <select
              name="goal"
              className={inputCls}
              value={formValues.goal}
              onChange={(event) => updateField("goal", event.target.value)}
            >
              {goalOptions.map((goal) => (
                <option key={goal} value={goal}>
                  {goal}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            ช่วงเวลา/เทศกาล
            <input
              name="seasonOrFestival"
              className={inputCls}
              value={formValues.seasonOrFestival}
              onChange={(event) => updateField("seasonOrFestival", event.target.value)}
              placeholder="เช่น หน้าร้อน, สงกรานต์, เปิดเทอม"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 lg:col-span-2">
            หัวข้อโพส
            <input
              name="topic"
              required
              className={inputCls}
              value={formValues.topic}
              onChange={(event) => updateField("topic", event.target.value)}
              placeholder="เช่น โปรเช็กรถแอร์ไม่เย็นก่อนสงกรานต์"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700">
            Call to action
            <input
              name="callToAction"
              className={inputCls}
              value={formValues.callToAction}
              onChange={(event) => updateField("callToAction", event.target.value)}
              placeholder="เช่น ทักแชทพร้อมแจ้งรุ่นรถได้เลย"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-gray-700 lg:col-span-2">
            หมายเหตุเพิ่มเติม
            <textarea
              name="notes"
              className={textareaCls}
              value={formValues.notes}
              onChange={(event) => updateField("notes", event.target.value)}
              placeholder="เช่น เน้นว่าร้านช่วยเช็กรุ่นให้ก่อนสั่ง และต้องการสื่อสารแบบเข้าใจง่าย"
            />
          </label>
          <div className="lg:col-span-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={pending}
              className="rounded-lg border border-[#1e3a5f] px-4 py-2 text-sm font-medium text-[#1e3a5f] hover:bg-[#eef4fb] disabled:opacity-60"
              onClick={() => {
                setMessage("");
                startTransition(async () => {
                  const result = await suggestContentTopicsAction(buildFormData(false));
                  if (result.success) {
                    setTopicSuggestions(result.topics ?? []);
                    setMessage("AI เสนอหัวข้อให้แล้ว เลือก 1 หัวข้อแล้วค่อยสร้าง draft 3 แบบ");
                  } else {
                    setTopicSuggestions([]);
                    setMessage(result.error ?? "AI คิดหัวข้อไม่สำเร็จ");
                  }
                });
              }}
            >
              ให้ AI คิดหัวข้อ
            </button>
            <button
              type="button"
              disabled={pending}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60"
              onClick={() => {
                setMessage("");
                startTransition(async () => {
                  const result = await autoGenerateTopicAndDraftsAction(buildFormData(false));
                  if (result.success) {
                    setTopicSuggestions(result.topics ?? []);
                    if (result.selectedTopic) {
                      updateField("topic", result.selectedTopic);
                    }
                    setMessage(`AI เลือกหัวข้อ \"${result.selectedTopic}\" และสร้าง draft 3 แบบสำเร็จ`);
                    router.refresh();
                  } else {
                    setMessage(result.error ?? "AI คิดหัวข้อและสร้าง draft ไม่สำเร็จ");
                  }
                });
              }}
            >
              ให้ AI คิดหัวข้อ + ร่าง draft เลย
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[#1e3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#163055] disabled:opacity-60"
            >
              {pending ? "กำลังประมวลผล..." : "สร้าง draft 3 แบบจากหัวข้อ"}
            </button>
            {message && <p className="text-sm text-[#1e3a5f]">{message}</p>}
          </div>
        </form>

        {topicSuggestions.length > 0 && (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {topicSuggestions.map((suggestion, index) => (
              <button
                key={`${suggestion.topic}-${index}`}
                type="button"
                className={`rounded-xl border p-4 text-left transition ${
                  formValues.topic === suggestion.topic
                    ? "border-[#1e3a5f] bg-[#eef4fb]"
                    : "border-gray-200 bg-gray-50 hover:border-[#1e3a5f]"
                }`}
                onClick={() => updateField("topic", suggestion.topic)}
              >
                <p className="font-kanit text-base font-semibold text-gray-900">{suggestion.topic}</p>
                <p className="mt-1 text-sm text-gray-600">{suggestion.angle}</p>
                <p className="mt-2 text-xs text-[#1e3a5f]">
                  {formValues.topic === suggestion.topic ? "เลือกหัวข้อนี้แล้ว" : "กดเพื่อใช้หัวข้อนี้"}
                </p>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-kanit text-lg font-semibold text-gray-900">รายการโพสล่าสุด</h2>
            <p className="text-sm text-gray-500">แสดง draft ล่าสุดและสถานะ approval/schedule/post</p>
          </div>
          <Link
            href="/admin/content/approval-queue"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            เปิดคิวอนุมัติ
          </Link>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium">หัวข้อ / พรีวิว</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
                <th className="px-3 py-2 font-medium">ผู้สร้าง</th>
                <th className="px-3 py-2 font-medium">ผู้อนุมัติ</th>
                <th className="px-3 py-2 font-medium">เวลาโพส</th>
                <th className="px-3 py-2 font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => {
                const latestApproval = post.approvals[0];
                const latestJob = post.scheduledJobs[0];
                return (
                  <tr key={post.id} className="border-t border-gray-100 align-top">
                    <td className="px-3 py-2 text-gray-700">
                      <div className="space-y-1">
                        <p className="font-medium">
                          {post.title || `ตัวเลือกโพส ${post.variantNo ?? "-"}`}
                          {post.variantNo ? ` · แบบที่ ${post.variantNo}` : ""}
                          {post.isSelectedVariant ? " · เลือกใช้งาน" : ""}
                        </p>
                        <p className="text-xs text-gray-500">{truncateText(post.caption.replace(/\s+/g, " ").trim(), 140)}</p>
                        {post.variantGroupId && <p className="text-[11px] text-gray-400">ชุด draft: {post.variantGroupId}</p>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      <div className="space-y-1">
                        <p>{post.status}</p>
                        {latestJob ? <p className="text-xs text-gray-400">job: {latestJob.status}</p> : null}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{post.createdByUser.name}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {latestApproval ? latestApproval.approverUser.name : post.approvedByUser?.name ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-gray-600">
                      {post.scheduledAt ? formatThaiDateTime(post.scheduledAt) : post.postedAt ? formatThaiDateTime(post.postedAt) : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/content/${post.id}`}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
                      >
                        เปิดรายละเอียด
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {posts.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-gray-500">
                    ยังไม่มี draft คอนเทนต์ Facebook
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
