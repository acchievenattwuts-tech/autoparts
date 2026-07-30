import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { ensureAccessControlSetupOnce } from "@/lib/access-control";
import { requirePermission } from "@/lib/require-auth";
import KnowledgeTabs from "../KnowledgeTabs";
import KnowledgeTestClient from "./KnowledgeTestClient";

export default async function KnowledgeTestPage() {
  await ensureAccessControlSetupOnce();
  await requirePermission("knowledge.sync");
  return <div><AdminPageHeader eyebrow="คลังความรู้ AI" title="ทดลองถาม AI" description="ตรวจทั้งผลค้นคืนและการตัดสินใจตอบจริง เพื่อไม่ให้ตีความคะแนน embedding ผิด" /><KnowledgeTabs active="test" /><KnowledgeTestClient /></div>;
}
