import type { PermissionKey } from "@/lib/access-control";

export type KnowledgeAdminTabId =
  | "library"
  | "approval"
  | "sync"
  | "test"
  | "quality";

export const KNOWLEDGE_ADMIN_TABS: readonly {
  id: KnowledgeAdminTabId;
  label: string;
  href: string;
  permission: PermissionKey;
  keywords: string;
}[] = [
  {
    id: "library",
    label: "คลังความรู้",
    href: "/admin/knowledge",
    permission: "knowledge.view",
    keywords: "knowledge rag คลังความรู้",
  },
  {
    id: "approval",
    label: "รออนุมัติคลังความรู้",
    href: "/admin/knowledge/approval",
    permission: "knowledge.view",
    keywords: "knowledge approval อนุมัติ",
  },
  {
    id: "sync",
    label: "สถานะ Sync คลังความรู้",
    href: "/admin/knowledge/sync",
    permission: "knowledge.view",
    keywords: "knowledge sync embedding status",
  },
  {
    id: "test",
    label: "ทดลองถาม Knowledge RAG",
    href: "/admin/knowledge/test",
    permission: "knowledge.sync",
    keywords: "knowledge rag test ทดลองถาม ai",
  },
  {
    id: "quality",
    label: "คุณภาพ Knowledge RAG",
    href: "/admin/knowledge/quality",
    permission: "knowledge.view",
    keywords: "knowledge rag quality dashboard feedback gap coverage latency handoff",
  },
] as const;
