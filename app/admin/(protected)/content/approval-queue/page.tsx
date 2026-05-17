export const dynamic = "force-dynamic";

import Link from "next/link";
import AdminPageHeader from "@/components/shared/AdminPageHeader";
import { ensureAccessControlSetup } from "@/lib/access-control";
import { listPendingApprovalPosts } from "@/lib/content-repository";
import { formatThaiDateTime, truncateText } from "@/lib/content-utils";
import { requirePermission } from "@/lib/require-auth";

export default async function ContentApprovalQueuePage() {
  await ensureAccessControlSetup();
  await requirePermission("content.view");

  const posts = await listPendingApprovalPosts();

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow="การตลาด"
        title="คิวอนุมัติโพสต์"
        description="โพสต์ที่ส่งอนุมัติแล้วและยังรอการตัดสินใจจากผู้อนุมัติ"
      />

      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-900/80">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-kanit text-lg font-semibold text-gray-900 dark:text-white">คิวอนุมัติโพสต์ Facebook</h2>
            <p className="text-sm text-gray-500 dark:text-slate-400">
              แสดงเฉพาะโพสต์ที่ส่งอนุมัติแล้วและยังรอการตัดสินใจจากผู้อนุมัติ
            </p>
          </div>
          <Link
            href="/admin/content"
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            กลับไปหน้าคอนเทนต์
          </Link>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-500 dark:bg-slate-800 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2 font-medium">โพสต์</th>
                <th className="px-3 py-2 font-medium">ผู้สร้าง</th>
                <th className="px-3 py-2 font-medium">ผู้อนุมัติ</th>
                <th className="px-3 py-2 font-medium">เวลาโพสต์</th>
                <th className="px-3 py-2 font-medium">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => {
                const pendingApproval = post.approvals[0];
                return (
                  <tr key={post.id} className="border-t border-gray-100 align-top dark:border-white/10">
                    <td className="px-3 py-2 text-gray-700 dark:text-slate-200">
                      <div className="space-y-1">
                        <p className="font-medium">{post.title || "ยังไม่ได้ตั้งชื่อโพสต์"}</p>
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                          {truncateText(post.caption.replace(/\s+/g, " ").trim(), 160)}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-300">{post.createdByUser.name}</td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-300">
                      {pendingApproval?.approverUser.name ?? "-"}
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-slate-300">
                      {post.scheduledAt ? formatThaiDateTime(post.scheduledAt) : "-"}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/content/${post.id}`}
                        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        เปิดรายละเอียด
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {posts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-500 dark:text-slate-400">
                    ตอนนี้ไม่มีโพสต์ที่รออนุมัติ
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
