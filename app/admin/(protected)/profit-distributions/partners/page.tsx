export const dynamic = "force-dynamic";

import { UserCog } from "lucide-react";

import NavLink from "@/components/shared/NavLink";
import type { SelectOption } from "@/components/shared/SearchableSelect";
import { db } from "@/lib/db";
import { maskBankAccountNo } from "@/lib/profit-distribution";
import { requirePermission } from "@/lib/require-auth";
import { formatDateOnlyForInput, getThailandDateKey } from "@/lib/th-date";

import PartnerManager, { type PartnerRow } from "./PartnerManager";

export default async function PartnerSettingsPage() {
  await requirePermission("profit_distributions.partners.manage");

  const [profiles, candidates] = await Promise.all([
    db.partnerProfile.findMany({
      orderBy: [{ isActive: "desc" }, { defaultSharePercent: "desc" }],
      select: {
        userId: true,
        defaultSharePercent: true,
        bankName: true,
        bankAccountNo: true,
        joinedAt: true,
        note: true,
        isActive: true,
        user: { select: { name: true, email: true } },
      },
    }),
    db.user.findMany({
      where: { isActive: true, partnerProfile: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, email: true },
    }),
  ]);

  const partners: PartnerRow[] = profiles.map((profile) => ({
    userId: profile.userId,
    name: profile.user.name,
    email: profile.user.email,
    defaultSharePercent: Number(profile.defaultSharePercent),
    bankName: profile.bankName ?? "",
    maskedAccountNo: maskBankAccountNo(profile.bankAccountNo),
    joinedAt: formatDateOnlyForInput(profile.joinedAt),
    note: profile.note ?? "",
    isActive: profile.isActive,
  }));

  const candidateOptions: SelectOption[] = candidates.map((user) => ({
    id: user.id,
    label: user.name,
    sublabel: user.email,
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2">
        <NavLink
          href="/admin/profit-distributions"
          className="text-sm text-gray-500 hover:underline dark:text-slate-400"
        >
          ← กลับหน้าแบ่งกำไรผู้ร่วมทุน
        </NavLink>
        <div className="flex items-center gap-2">
          <UserCog size={22} className="text-[#1e3a5f] dark:text-sky-300" />
          <h1 className="font-kanit text-2xl font-bold text-gray-900 dark:text-slate-100">
            ผู้ร่วมทุน
          </h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-slate-400">
          ตั้งผู้ใช้ในระบบให้เป็นผู้ร่วมทุน พร้อมสัดส่วนตั้งต้นที่จะใช้เป็นค่าเริ่มต้นตอนประกาศแบ่งกำไร
          — การตั้งค่านี้ไม่เปลี่ยนสิทธิ์การเข้าถึงเมนูใด ๆ
        </p>
      </div>

      <PartnerManager
        partners={partners}
        candidateOptions={candidateOptions}
        today={getThailandDateKey()}
      />
    </div>
  );
}
