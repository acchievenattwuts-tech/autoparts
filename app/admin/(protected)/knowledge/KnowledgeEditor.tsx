"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { GripVertical, Plus, Save, Trash2 } from "lucide-react";
import AdminSectionCard from "@/components/shared/AdminSectionCard";
import type { KnowledgeContent, KnowledgeSection } from "@/lib/knowledge-cms-types";
import { createKnowledgeDraft, updateKnowledgeDraft } from "./actions";

type EditorValue = {
  revisionId?: string;
  sourceId?: string;
  type: "ARTICLE" | "FAQ" | "POLICY";
  slug: string;
  title: string;
  description: string;
  category: string;
  content: KnowledgeContent;
  answerScope: string;
  riskLevel: "LOW" | "MEDIUM";
  ragEnabled: boolean;
  sourceUrls: string[];
  updatedAt?: string;
};

const inputClass = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-200 dark:border-white/10 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-orange-400 dark:focus:ring-orange-500/20";
const labelClass = "mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300";

const emptySection = (): KnowledgeSection => ({ heading: "", body: [""], format: "PARAGRAPHS", aiEnabled: true });

export default function KnowledgeEditor({ initial }: { initial?: EditorValue }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [type, setType] = useState<EditorValue["type"]>(initial?.type ?? "FAQ");
  const [ragEnabled, setRagEnabled] = useState(initial?.ragEnabled ?? true);
  const [riskLevel, setRiskLevel] = useState<"LOW" | "MEDIUM">(initial?.riskLevel ?? "LOW");
  const [intro, setIntro] = useState(initial?.content.intro ?? "");
  const [highlights, setHighlights] = useState((initial?.content.highlights ?? []).join("\n"));
  const [sections, setSections] = useState<KnowledgeSection[]>(initial?.content.sections ?? [emptySection()]);
  const [relatedSearches, setRelatedSearches] = useState((initial?.content.relatedSearches ?? []).join("\n"));
  const [sourceUrls, setSourceUrls] = useState((initial?.sourceUrls ?? []).join("\n"));

  const updateSection = (index: number, value: Partial<KnowledgeSection>) => {
    setSections((current) => current.map((section, itemIndex) => itemIndex === index ? { ...section, ...value } : section));
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    const lines = (value: string) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const content: KnowledgeContent = {
      intro: intro.trim(),
      highlights: lines(highlights),
      sections: sections.map((section) => ({ ...section, heading: section.heading.trim(), body: section.body.map((item) => item.trim()).filter(Boolean) })),
      relatedSearches: lines(relatedSearches),
      internalLinks: initial?.content.internalLinks ?? [],
      readingMinutes: Math.max(1, Number(formData.get("readingMinutes")) || 3),
      publishedAt: initial?.content.publishedAt,
    };
    formData.set("type", type);
    formData.set("riskLevel", riskLevel);
    formData.set("ragEnabled", String(ragEnabled));
    formData.set("content", JSON.stringify(content));
    formData.set("sourceUrls", JSON.stringify(lines(sourceUrls)));
    if (initial?.updatedAt) formData.set("expectedUpdatedAt", initial.updatedAt);
    startTransition(async () => {
      const result = initial?.revisionId
        ? await updateKnowledgeDraft(initial.revisionId, formData)
        : await createKnowledgeDraft(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(`/admin/knowledge/${result.id}`);
      router.refresh();
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5">
      <AdminSectionCard title="ข้อมูลหลัก" description="ชื่อและ URL ส่วนนี้จะใช้ทั้งหน้าเว็บและแหล่งอ้างอิงของ AI">
        <div className="grid gap-4 md:grid-cols-2">
          <div><label className={labelClass}>ประเภท</label><select value={type} disabled={Boolean(initial)} onChange={(e) => setType(e.target.value as EditorValue["type"])} className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}><option value="FAQ">FAQ</option><option value="ARTICLE">บทความ</option><option value="POLICY">นโยบาย</option></select></div>
          <div>
            <label className={labelClass}>Slug หน้าเว็บ {type === "ARTICLE" ? "*" : ""}</label>
            <input name="slug" defaultValue={initial?.slug ?? ""} readOnly={Boolean(initial)} className={`${inputClass} read-only:cursor-not-allowed read-only:opacity-60`} placeholder="เช่น how-to-check-part-number" />
            {initial && <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">ประเภทและ Slug ถูกล็อกหลังสร้าง เพื่อให้ URL เดิมไม่เปลี่ยนก่อนเนื้อหาใหม่เผยแพร่สำเร็จ</p>}
          </div>
          <div className="md:col-span-2"><label className={labelClass}>ชื่อเรื่อง / คำถาม *</label><input name="title" defaultValue={initial?.title ?? ""} required className={inputClass} /></div>
          <div className="md:col-span-2"><label className={labelClass}>คำอธิบายสำหรับ SEO</label><textarea name="description" defaultValue={initial?.description ?? ""} rows={3} className={inputClass} /></div>
          <div><label className={labelClass}>หมวดหมู่</label><input name="category" defaultValue={initial?.category ?? ""} className={inputClass} /></div>
          <div><label className={labelClass}>เวลาอ่านโดยประมาณ (นาที)</label><input name="readingMinutes" type="number" min={1} max={60} defaultValue={initial?.content.readingMinutes ?? 3} className={inputClass} /></div>
        </div>
      </AdminSectionCard>

      <AdminSectionCard title="เนื้อหา" description="แต่ละบรรทัดในช่องรายการจะถูกแสดงเป็นหนึ่งข้อ">
        <div className="space-y-4">
          <div><label className={labelClass}>บทนำ / คำตอบหลัก *</label><textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={5} required className={inputClass} /></div>
          <div><label className={labelClass}>ประเด็นสำคัญ</label><textarea value={highlights} onChange={(e) => setHighlights(e.target.value)} rows={4} className={inputClass} placeholder="หนึ่งข้อต่อหนึ่งบรรทัด" /></div>
          <div className="space-y-3">
            {sections.map((section, index) => (
              <div key={index} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-white/10 dark:bg-white/5">
                <div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200"><GripVertical className="h-4 w-4 text-slate-400" />ส่วนที่ {index + 1}</div>{sections.length > 1 && <button type="button" onClick={() => setSections((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10"><Trash2 className="h-4 w-4" /></button>}</div>
                <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                  <input value={section.heading} onChange={(e) => updateSection(index, { heading: e.target.value })} className={inputClass} placeholder="หัวข้อ" />
                  <select value={section.format} onChange={(e) => updateSection(index, { format: e.target.value as KnowledgeSection["format"] })} className={inputClass}><option value="PARAGRAPHS">ย่อหน้า</option><option value="BULLETS">รายการหัวข้อ</option><option value="STEPS">ลำดับขั้นตอน</option><option value="TABLE">ตาราง (ชื่อ | ค่า)</option></select>
                </div>
                <textarea value={section.body.join("\n")} onChange={(e) => updateSection(index, { body: e.target.value.split(/\r?\n/) })} rows={5} className={`${inputClass} mt-3`} placeholder="หนึ่งย่อหน้าหรือหนึ่งรายการต่อบรรทัด" />
                <label className="mt-3 flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300"><input type="checkbox" checked={section.aiEnabled} onChange={(e) => updateSection(index, { aiEnabled: e.target.checked })} /> อนุญาตให้ AI ใช้ส่วนนี้ตอบลูกค้า</label>
              </div>
            ))}
            <button type="button" onClick={() => setSections((current) => [...current, emptySection()])} className="inline-flex items-center gap-2 rounded-xl border border-dashed border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:border-orange-400 hover:text-orange-600 dark:border-white/20 dark:text-slate-300"><Plus className="h-4 w-4" />เพิ่มหัวข้อ</button>
          </div>
          <div><label className={labelClass}>คำค้นที่เกี่ยวข้อง</label><textarea value={relatedSearches} onChange={(e) => setRelatedSearches(e.target.value)} rows={3} className={inputClass} placeholder="หนึ่งคำค้นต่อหนึ่งบรรทัด" /></div>
        </div>
      </AdminSectionCard>

      <AdminSectionCard title="ขอบเขต AI และแหล่งอ้างอิง" description="Product Search ยังคงแยกจากส่วนนี้ ระบบจะไม่ใช้เนื้อหานี้ยืนยันราคา สต็อก หรือความตรงรุ่น">
        <div className="space-y-4">
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4 dark:border-white/10"><input type="checkbox" checked={ragEnabled} onChange={(e) => setRagEnabled(e.target.checked)} className="mt-1" /><span><span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">ใช้ตอบใน LINE และ Facebook Messenger</span><span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">ปิดได้สำหรับบทความหน้าเว็บที่ยังไม่ผ่านการทบทวนเพื่อใช้กับ AI</span></span></label>
          <div className="grid gap-4 md:grid-cols-2"><div><label className={labelClass}>ระดับความเสี่ยง</label><select value={riskLevel} onChange={(e) => setRiskLevel(e.target.value as "LOW" | "MEDIUM")} className={inputClass}><option value="LOW">LOW — ข้อมูลทั่วไป</option><option value="MEDIUM">MEDIUM — นโยบาย/เงื่อนไข</option></select></div><div><label className={labelClass}>URL แหล่งอ้างอิง</label><textarea value={sourceUrls} onChange={(e) => setSourceUrls(e.target.value)} rows={3} className={inputClass} placeholder="https://... หนึ่ง URL ต่อบรรทัด" /></div></div>
          <div><label className={labelClass}>ขอบเขตที่ AI อนุญาตให้ตอบ *</label><textarea name="answerScope" defaultValue={initial?.answerScope ?? "ตอบได้เฉพาะข้อมูลทั่วไปในเอกสารนี้ ห้ามยืนยันราคา สต็อก ความตรงรุ่น การชำระเงิน หรือผลเคลม"} rows={4} required className={inputClass} /></div>
        </div>
      </AdminSectionCard>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">{error}</div>}
      <div className="sticky bottom-4 z-10 flex justify-end"><button type="submit" disabled={pending} className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-5 py-3 font-semibold text-white shadow-lg transition hover:bg-orange-600 disabled:opacity-60"><Save className="h-4 w-4" />{pending ? "กำลังบันทึก..." : "บันทึกร่าง"}</button></div>
    </form>
  );
}
