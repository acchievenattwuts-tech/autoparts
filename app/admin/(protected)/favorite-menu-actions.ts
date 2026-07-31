"use server";

import { z } from "zod";

import {
  getAuditActorFromSession,
  getRequestContext,
  safeWriteAuditLog,
} from "@/lib/audit-log";
import { db } from "@/lib/db";
import { AuditAction } from "@/lib/generated/prisma";
import { getRequiredSession } from "@/lib/require-auth";
import {
  MAX_FAVORITE_MENUS,
  getFavoriteMenuHrefs,
  isKnownAdminHref,
} from "@/lib/user-favorite-menu";

const AUDIT_ENTITY_TYPE = "UserFavoriteMenu";

type FavoriteMenuResult = { favorites?: string[]; error?: string };

const hrefSchema = z
  .string()
  .min(1)
  .max(200)
  .refine(isKnownAdminHref, { message: "ไม่พบเมนูที่เลือก" });

const reorderSchema = z.array(hrefSchema).max(MAX_FAVORITE_MENUS);

/** เขียนลำดับใหม่ทั้งชุดของผู้ใช้คนเดียว — ทำใน transaction เพื่อไม่ให้ลำดับพังกลางทาง */
const persistOrder = async (userId: string, hrefs: string[]): Promise<void> => {
  await db.$transaction(async (tx) => {
    await tx.userFavoriteMenu.deleteMany({ where: { userId } });
    if (hrefs.length === 0) return;
    await tx.userFavoriteMenu.createMany({
      data: hrefs.map((href, index) => ({ userId, href, sortOrder: index })),
    });
  });
};

/** เพิ่ม/เอาออกจากรายการโปรดของผู้ใช้ที่ล็อกอินอยู่เท่านั้น (ไม่รับ userId จาก client) */
export const toggleFavoriteMenu = async (href: string): Promise<FavoriteMenuResult> => {
  const session = await getRequiredSession().catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = hrefSchema.safeParse(href);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const userId = session.user.id;

  try {
    const current = await getFavoriteMenuHrefs(userId);
    const isFavorite = current.includes(parsed.data);
    const next = isFavorite
      ? current.filter((item) => item !== parsed.data)
      : [...current, parsed.data];

    if (!isFavorite && current.length >= MAX_FAVORITE_MENUS) {
      return { error: `เพิ่มรายการโปรดได้ไม่เกิน ${MAX_FAVORITE_MENUS} เมนู`, favorites: current };
    }

    await persistOrder(userId, next);

    const requestContext = await getRequestContext();
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: userId,
      entityRef: parsed.data,
      before: { favorites: current },
      after: { favorites: next },
      meta: { operation: isFavorite ? "REMOVE_FAVORITE" : "ADD_FAVORITE" },
    });

    return { favorites: next };
  } catch (error) {
    console.error("[favorite-menu] toggle failed", error);
    return { error: "บันทึกรายการโปรดไม่สำเร็จ" };
  }
};

/** จัดลำดับรายการโปรดใหม่ — รับได้เฉพาะ href ที่เป็นรายการโปรดเดิมของผู้ใช้ */
export const reorderFavoriteMenus = async (hrefs: string[]): Promise<FavoriteMenuResult> => {
  const session = await getRequiredSession().catch(() => null);
  if (!session?.user?.id) {
    return { error: "ไม่มีสิทธิ์เข้าถึง" };
  }

  const parsed = reorderSchema.safeParse(hrefs);
  if (!parsed.success) {
    return { error: "ลำดับรายการโปรดไม่ถูกต้อง" };
  }

  const userId = session.user.id;

  try {
    const current = await getFavoriteMenuHrefs(userId);
    const requested = Array.from(new Set(parsed.data));
    const isSameSet =
      requested.length === current.length && requested.every((href) => current.includes(href));
    if (!isSameSet) {
      return { error: "ลำดับรายการโปรดไม่ตรงกับข้อมูลปัจจุบัน", favorites: current };
    }

    await persistOrder(userId, requested);

    const requestContext = await getRequestContext();
    await safeWriteAuditLog({
      ...getAuditActorFromSession(session),
      ...requestContext,
      action: AuditAction.UPDATE,
      entityType: AUDIT_ENTITY_TYPE,
      entityId: userId,
      before: { favorites: current },
      after: { favorites: requested },
      meta: { operation: "REORDER_FAVORITES" },
    });

    return { favorites: requested };
  } catch (error) {
    console.error("[favorite-menu] reorder failed", error);
    return { error: "จัดลำดับรายการโปรดไม่สำเร็จ" };
  }
};
