"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import {
  diffEntity,
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { requirePermission } from "@/lib/require-auth";
import { MAX_SYNONYMS_PER_TERM, SEARCH_SYNONYM_CACHE_TAG } from "@/lib/search-synonyms";

const ADMIN_PATH = "/admin/master/search-synonyms";

const synonymSchema = z.object({
  term: z
    .string()
    .min(1, "กรุณากรอกคำหลัก")
    .max(100, "คำหลักยาวเกินไป (ไม่เกิน 100 ตัวอักษร)"),
  synonyms: z
    .array(z.string().min(1).max(100))
    .max(MAX_SYNONYMS_PER_TERM, `เพิ่มคำพ้องได้ไม่เกิน ${MAX_SYNONYMS_PER_TERM} คำต่อ 1 รายการ`)
    .default([]),
  language: z
    .string()
    .max(10)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

type SynonymInput = z.infer<typeof synonymSchema>;

const refreshSearchCaches = () => {
  updateTag(SEARCH_SYNONYM_CACHE_TAG);
  updateTag("product-search");
  revalidatePath(ADMIN_PATH);
};

const parsePayload = (formData: FormData):
  | { success: true; data: SynonymInput }
  | { success: false; error: string } => {
  let synonyms: string[] = [];
  try {
    const raw = formData.get("synonyms");
    if (typeof raw === "string" && raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        synonyms = parsed
          .filter((s): s is string => typeof s === "string")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
      }
    }
  } catch {
    return { success: false, error: "รูปแบบข้อมูลคำพ้องไม่ถูกต้อง" };
  }

  // Deduplicate (case-insensitive) and remove entries equal to term
  const term = String(formData.get("term") ?? "").trim();
  const lowerTerm = term.toLowerCase();
  synonyms = Array.from(
    new Set(
      synonyms
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.toLowerCase() !== lowerTerm),
    ),
  );

  const language = String(formData.get("language") ?? "").trim();

  const parsed = synonymSchema.safeParse({
    term,
    synonyms,
    language: language || undefined,
  });

  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  return { success: true, data: parsed.data };
};

async function getAuditSnapshot(id: string) {
  return db.searchSynonym.findUnique({
    where: { id },
    select: {
      id: true,
      term: true,
      synonyms: true,
      language: true,
      isActive: true,
    },
  });
}

export const createSearchSynonym = async (
  formData: FormData,
): Promise<{ error?: string }> => {
  const session = await requirePermission("search_synonyms.create").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  const parsed = parsePayload(formData);
  if (!parsed.success) return { error: parsed.error };

  const { term, synonyms, language } = parsed.data;

  try {
    const requestContext = await getRequestContext();
    const created = await db.searchSynonym.create({
      data: {
        term,
        synonyms,
        language: language ?? null,
      },
    });

    const snapshot = await getAuditSnapshot(created.id);
    if (snapshot) {
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.CREATE,
        entityType: "SearchSynonym",
        entityId: snapshot.id,
        entityRef: snapshot.term,
        after: snapshot,
      });
    }

    refreshSearchCaches();
    return {};
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "มีคำหลักนี้อยู่แล้ว — แก้ไขรายการเดิมแทน" };
    }
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
};

export const updateSearchSynonym = async (
  id: string,
  formData: FormData,
): Promise<{ error?: string }> => {
  const session = await requirePermission("search_synonyms.update").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  const parsed = parsePayload(formData);
  if (!parsed.success) return { error: parsed.error };

  const { term, synonyms, language } = parsed.data;

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getAuditSnapshot(id);
    if (!beforeSnapshot) return { error: "ไม่พบรายการนี้" };

    await db.searchSynonym.update({
      where: { id },
      data: {
        term,
        synonyms,
        language: language ?? null,
      },
    });

    const afterSnapshot = await getAuditSnapshot(id);
    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: AuditAction.UPDATE,
        entityType: "SearchSynonym",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.term,
        before: diff.before,
        after: diff.after,
      });
    }

    refreshSearchCaches();
    return {};
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "มีคำหลักนี้อยู่แล้ว" };
    }
    return { error: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง" };
  }
};

export const toggleSearchSynonym = async (
  id: string,
  isActive: boolean,
): Promise<{ error?: string }> => {
  const session = await requirePermission("search_synonyms.cancel").catch(() => null);
  if (!session?.user?.id) return { error: "ไม่มีสิทธิ์เข้าถึง" };

  if (!id || id.length > 50 || !/^[a-z0-9]+$/.test(id)) {
    return { error: "รหัสไม่ถูกต้อง" };
  }

  try {
    const requestContext = await getRequestContext();
    const beforeSnapshot = await getAuditSnapshot(id);
    if (!beforeSnapshot) return { error: "ไม่พบรายการนี้" };

    await db.searchSynonym.update({ where: { id }, data: { isActive } });
    const afterSnapshot = await getAuditSnapshot(id);

    if (beforeSnapshot && afterSnapshot) {
      const diff = diffEntity(beforeSnapshot, afterSnapshot);
      await safeWriteAuditLog({
        ...getAuditActorFromSession(session),
        ...requestContext,
        action: isActive ? AuditAction.UPDATE : AuditAction.CANCEL,
        entityType: "SearchSynonym",
        entityId: afterSnapshot.id,
        entityRef: afterSnapshot.term,
        before: diff.before,
        after: diff.after,
        meta: { isActive },
      });
    }

    refreshSearchCaches();
    return {};
  } catch {
    return { error: "เกิดข้อผิดพลาด" };
  }
};
