import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/require-auth";
import KnowledgeEditor from "../KnowledgeEditor";

export default async function NewKnowledgePage() {
  await ensureAccessControlSetupOnce();
  const session = await requirePermission("knowledge.create");
  const ownerOptions = await db.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return (
    <div>
      <AdminPageHeader
        eyebrow="คลังความรู้ AI"
        title="เพิ่มความรู้ใหม่"
        description="บันทึกเป็นร่างก่อน เนื้อหาจะยังไม่ขึ้นหน้าเว็บหรือถูก AI ใช้จนกว่าจะอนุมัติและ Sync สำเร็จ"
      />
      <KnowledgeEditor
        ownerOptions={ownerOptions}
        currentUserId={session.user.id}
      />
    </div>
  );
}
