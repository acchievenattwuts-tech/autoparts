import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import KnowledgeEditor from "../KnowledgeEditor";

export default async function NewKnowledgePage() {
  await ensureAccessControlSetupOnce();
  await requirePermission("knowledge.create");
  return <div><AdminPageHeader eyebrow="คลังความรู้ AI" title="เพิ่มความรู้ใหม่" description="บันทึกเป็นร่างก่อน เนื้อหาจะยังไม่ขึ้นหน้าเว็บหรือถูก AI ใช้จนกว่าจะอนุมัติและ Sync สำเร็จ" /><KnowledgeEditor /></div>;
}
