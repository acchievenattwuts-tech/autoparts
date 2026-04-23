"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle, Copy, Search } from "lucide-react";
import { createRole, updateRole } from "./actions";

type PermissionItem = {
  key: string;
  group: string;
  label: string;
};

type MatrixAction = "view" | "create" | "update" | "cancel" | "manage";

type PermissionMatrixRow = {
  id: string;
  group: string;
  menuLabel: string;
  searchText: string;
  permissions: Partial<Record<MatrixAction, string>>;
};

interface RoleFormProps {
  role?: {
    id: string;
    name: string;
    description: string | null;
    isSystem: boolean;
    permissionKeys: string[];
  };
  permissions: PermissionItem[];
  copyRoleOptions: Array<{ id: string; name: string; permissionKeys: string[] }>;
}

const ACTION_COLUMNS: Array<{ key: MatrixAction; label: string; accent: string }> = [
  { key: "view", label: "ใช้", accent: "text-sky-700" },
  { key: "create", label: "เพิ่ม", accent: "text-emerald-700" },
  { key: "update", label: "แก้ไข", accent: "text-amber-700" },
  { key: "cancel", label: "ยกเลิก", accent: "text-rose-700" },
  { key: "manage", label: "จัดการ", accent: "text-violet-700" },
];

const MENU_LABELS: Record<string, string> = {
  dashboard: "Dashboard",
  products: "สินค้า",
  customers: "ลูกค้า",
  master: "ข้อมูลหลัก",
  "stock.bf": "สต็อกตั้งต้น (BF)",
  "stock.adjustments": "ปรับสต็อก",
  "stock.card": "Stock Card",
  purchases: "บันทึกซื้อสินค้า",
  purchase_returns: "CN ซื้อ",
  sales: "บันทึกการขาย",
  credit_notes: "CN ขาย",
  receipts: "รับชำระ",
  warranties: "รับประกัน",
  expenses: "ค่าใช้จ่าย",
  reports: "รายงาน",
  "settings.company": "ตั้งค่าร้าน",
  "admin.users": "ผู้ใช้งาน",
  "admin.roles": "บทบาทและสิทธิ์",
};

const ACTION_DEPENDENCIES: Partial<Record<MatrixAction, MatrixAction[]>> = {
  create: ["view"],
  update: ["view"],
  cancel: ["view"],
  manage: ["view"],
};

const inputCls =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200";

function getMenuLabel(baseKey: string, fallbackLabel: string): string {
  if (MENU_LABELS[baseKey]) {
    return MENU_LABELS[baseKey];
  }

  return fallbackLabel.replace(/^(ดู|เพิ่ม|แก้ไข|ยกเลิก|จัดการ)\s*/, "").trim();
}

function buildPermissionMatrix(permissions: PermissionItem[]): PermissionMatrixRow[] {
  const rows = new Map<string, PermissionMatrixRow>();

  for (const permission of permissions) {
    const parts = permission.key.split(".");
    const action = parts.at(-1) as MatrixAction | undefined;

    if (!action || !ACTION_COLUMNS.some((column) => column.key === action)) {
      continue;
    }

    const baseKey = parts.slice(0, -1).join(".");
    const existing = rows.get(baseKey);

    if (existing) {
      existing.permissions[action] = permission.key;
      existing.searchText = `${existing.searchText} ${permission.label}`.toLowerCase();
      continue;
    }

    rows.set(baseKey, {
      id: baseKey,
      group: permission.group,
      menuLabel: getMenuLabel(baseKey, permission.label),
      searchText: `${permission.group} ${permission.label} ${baseKey}`.toLowerCase(),
      permissions: {
        [action]: permission.key,
      },
    });
  }

  return Array.from(rows.values()).sort((left, right) => left.menuLabel.localeCompare(right.menuLabel, "th"));
}

const RoleForm = ({ role, permissions, copyRoleOptions }: RoleFormProps) => {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] = useState<string>("ALL");
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>(role?.permissionKeys ?? []);

  const matrixRows = useMemo(() => buildPermissionMatrix(permissions), [permissions]);
  const groups = useMemo(() => Array.from(new Set(matrixRows.map((row) => row.group))), [matrixRows]);
  const selectedPermissionSet = useMemo(() => new Set(selectedPermissions), [selectedPermissions]);
  const isEdit = Boolean(role);

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return matrixRows.filter((row) => {
      const matchesGroup = selectedGroup === "ALL" || row.group === selectedGroup;
      const matchesQuery = normalizedQuery.length === 0 || row.searchText.includes(normalizedQuery);
      return matchesGroup && matchesQuery;
    });
  }, [matrixRows, query, selectedGroup]);

  const updateSelectedPermissions = (updater: (current: Set<string>) => Set<string>) => {
    setSelectedPermissions((current) => Array.from(updater(new Set(current))));
  };

  const enablePermissionWithDependencies = (permissionKey: string, current: Set<string>) => {
    current.add(permissionKey);

    const parts = permissionKey.split(".");
    const action = parts.at(-1) as MatrixAction | undefined;
    const baseKey = parts.slice(0, -1).join(".");
    const dependencies = action ? ACTION_DEPENDENCIES[action] ?? [] : [];

    for (const dependency of dependencies) {
      const dependencyKey = `${baseKey}.${dependency}`;
      if (permissions.some((permission) => permission.key === dependencyKey)) {
        current.add(dependencyKey);
      }
    }

    return current;
  };

  const handleTogglePermission = (permissionKey: string, checked: boolean) => {
    updateSelectedPermissions((current) => {
      if (checked) {
        return enablePermissionWithDependencies(permissionKey, current);
      }

      current.delete(permissionKey);
      return current;
    });
  };

  const handleToggleRow = (row: PermissionMatrixRow, checked: boolean) => {
    updateSelectedPermissions((current) => {
      for (const permissionKey of Object.values(row.permissions)) {
        if (!permissionKey) continue;

        if (checked) {
          enablePermissionWithDependencies(permissionKey, current);
        } else {
          current.delete(permissionKey);
        }
      }

      return current;
    });
  };

  const handleBulkAction = (mode: "all" | "view-only" | "clear") => {
    updateSelectedPermissions((current) => {
      for (const row of visibleRows) {
        const permissionKeys = Object.values(row.permissions).filter((permissionKey): permissionKey is string =>
          typeof permissionKey === "string"
        );

        if (mode === "clear") {
          for (const permissionKey of permissionKeys) {
            current.delete(permissionKey);
          }
          continue;
        }

        if (mode === "view-only") {
          for (const permissionKey of permissionKeys) {
            current.delete(permissionKey);
          }

          if (row.permissions.view) {
            current.add(row.permissions.view);
          }
          continue;
        }

        for (const permissionKey of permissionKeys) {
          enablePermissionWithDependencies(permissionKey, current);
        }
      }

      return current;
    });
  };

  const handleCopyRole = (roleId: string) => {
    const sourceRole = copyRoleOptions.find((option) => option.id === roleId);
    if (!sourceRole) return;

    setSelectedPermissions(sourceRole.permissionKeys);
    setError("");
    setSuccess(`คัดลอกสิทธิ์จากบทบาท ${sourceRole.name} แล้ว`);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setSuccess("");

    const formData = new FormData(event.currentTarget);
    formData.set("permissionKeys", JSON.stringify(selectedPermissions));

    startTransition(async () => {
      const result = isEdit ? await updateRole(role!.id, formData) : await createRole(formData);

      if (result.error) {
        setError(result.error);
        return;
      }

      if (isEdit) {
        setSuccess("บันทึกสิทธิ์เรียบร้อยแล้ว");
        return;
      }

      router.push("/admin/roles");
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-300 bg-slate-100 px-4 py-2">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="rounded-t-md border border-slate-300 border-b-white bg-white px-3 py-1 font-medium text-slate-800">
              Group of Role
            </span>
            <span className="text-slate-500">กำหนดสิทธิ์การใช้งาน</span>
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[310px_minmax(0,1fr)]">
          <aside className="border-b border-slate-300 bg-[#f7f7f7] lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-300 bg-white p-4">
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="submit"
                  disabled={isPending}
                  className="flex h-16 items-center justify-center rounded-lg border border-slate-300 bg-gradient-to-b from-sky-100 to-sky-200 text-slate-700 shadow-sm transition hover:from-sky-200 hover:to-sky-300 disabled:opacity-50"
                >
                  <div className="text-center">
                    <div className="text-2xl">💾</div>
                    <div className="text-xs font-medium">{isPending ? "กำลังบันทึก..." : "บันทึก"}</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction("clear")}
                  className="flex h-16 items-center justify-center rounded-lg border border-slate-300 bg-gradient-to-b from-rose-100 to-rose-200 text-slate-700 shadow-sm transition hover:from-rose-200 hover:to-rose-300"
                >
                  <div className="text-center">
                    <div className="text-2xl">✕</div>
                    <div className="text-xs font-medium">ล้างที่เลือก</div>
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-4 p-4">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Group
                  </label>
                  {role?.isSystem ? <input type="hidden" name="name" value={role.name} /> : null}
                  <input
                    name="name"
                    defaultValue={role?.name ?? ""}
                    disabled={role?.isSystem}
                    required
                    className={inputCls}
                    placeholder="เช่น พนักงานขาย"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Description
                  </label>
                  <textarea
                    name="description"
                    defaultValue={role?.description ?? ""}
                    rows={3}
                    className={`${inputCls} resize-none`}
                    placeholder="อธิบายการใช้งานของบทบาทนี้"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-300 bg-white">
                <div className="border-b border-slate-300 bg-slate-700 px-4 py-2 text-sm font-semibold text-white">
                  System Menu
                </div>
                <div className="max-h-[420px] overflow-y-auto p-3">
                  <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
                    <input
                      type="radio"
                      name="permission-group"
                      checked={selectedGroup === "ALL"}
                      onChange={() => setSelectedGroup("ALL")}
                      className="h-4 w-4 border-slate-300 text-sky-700 focus:ring-sky-700"
                    />
                    ทั้งหมด
                  </label>
                  {groups.map((group) => (
                    <label key={group} className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <input
                        type="radio"
                        name="permission-group"
                        checked={selectedGroup === group}
                        onChange={() => setSelectedGroup(group)}
                        className="h-4 w-4 border-slate-300 text-sky-700 focus:ring-sky-700"
                      />
                      {group}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="min-w-0 bg-white">
            <div className="border-b border-slate-300 bg-slate-50 px-4 py-3">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div>
                  <h2 className="font-kanit text-xl font-semibold text-slate-900">กำหนดสิทธิ์การใช้งาน</h2>
                  <p className="text-sm text-slate-500">ตั้งค่าสิทธิ์ตามเมนูหลักและ action ที่ต้องการใช้งาน</p>
                </div>

                <div className="flex flex-col gap-2 md:flex-row">
                  <div className="relative min-w-64">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      className="w-full rounded-md border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                      placeholder="ค้นหาเมนูหรือสิทธิ์"
                    />
                  </div>

                  <select
                    defaultValue=""
                    onChange={(event) => handleCopyRole(event.target.value)}
                    className="min-w-56 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                  >
                    <option value="">คัดลอกจากบทบาทอื่น</option>
                    {copyRoleOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleBulkAction("all")}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100"
                >
                  <Copy size={14} />
                  เลือกทั้งหมดในหมวดนี้
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction("view-only")}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100"
                >
                  ให้สิทธิ์ดูอย่างเดียว
                </button>
                <button
                  type="button"
                  onClick={() => handleBulkAction("clear")}
                  className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 transition hover:bg-slate-100"
                >
                  ล้างสิทธิ์ในหมวดนี้
                </button>
                <div className="inline-flex items-center rounded-md bg-slate-800 px-3 py-1.5 text-sm font-medium text-white">
                  เลือกแล้ว {selectedPermissions.length} รายการ
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-slate-100 text-slate-700">
                  <tr>
                    <th className="w-14 border-b border-r border-slate-300 px-3 py-2 text-center font-semibold">#</th>
                    <th className="min-w-[280px] border-b border-r border-slate-300 px-4 py-2 text-left font-semibold">Menu name</th>
                    {ACTION_COLUMNS.map((column) => (
                      <th
                        key={column.key}
                        className={`w-20 border-b border-r border-slate-300 px-3 py-2 text-center font-semibold ${column.accent}`}
                      >
                        {column.label}
                      </th>
                    ))}
                    <th className="w-24 border-b border-slate-300 px-3 py-2 text-center font-semibold">ทั้งแถว</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr>
                      <td colSpan={ACTION_COLUMNS.length + 3} className="px-4 py-10 text-center text-sm text-slate-500">
                        ไม่พบเมนูที่ตรงกับเงื่อนไขที่ค้นหา
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((row, index) => {
                      const availablePermissionKeys = Object.values(row.permissions).filter(
                        (permissionKey): permissionKey is string => typeof permissionKey === "string"
                      );
                      const isRowSelected =
                        availablePermissionKeys.length > 0 &&
                        availablePermissionKeys.every((permissionKey) => selectedPermissionSet.has(permissionKey));

                      return (
                        <tr key={row.id} className="odd:bg-white even:bg-slate-50/60">
                          <td className="border-b border-r border-slate-200 px-3 py-2 text-center text-slate-500">
                            {index + 1}
                          </td>
                          <td className="border-b border-r border-slate-200 px-4 py-2">
                            <div className="font-medium text-slate-900">{row.menuLabel}</div>
                            <div className="text-xs text-slate-500">{row.group}</div>
                          </td>
                          {ACTION_COLUMNS.map((column) => {
                            const permissionKey = row.permissions[column.key];
                            const checked = permissionKey ? selectedPermissionSet.has(permissionKey) : false;

                            return (
                              <td key={column.key} className="border-b border-r border-slate-200 px-3 py-2 text-center">
                                {permissionKey ? (
                                  <label className="mx-auto flex h-8 w-8 cursor-pointer items-center justify-center rounded border border-slate-300 bg-white transition hover:border-slate-400">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(event) => handleTogglePermission(permissionKey, event.target.checked)}
                                      className="h-4 w-4 rounded border-slate-300 text-sky-700 focus:ring-sky-700"
                                    />
                                  </label>
                                ) : (
                                  <span className="text-slate-300">-</span>
                                )}
                              </td>
                            );
                          })}
                          <td className="border-b border-slate-200 px-3 py-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleToggleRow(row, !isRowSelected)}
                              className={`rounded-md border px-3 py-1 text-xs font-medium transition ${
                                isRowSelected
                                  ? "border-slate-700 bg-slate-700 text-white hover:bg-slate-800"
                                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                              }`}
                            >
                              {isRowSelected ? "ครบ" : "เลือก"}
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
      ) : null}

      {success ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          <CheckCircle size={16} />
          <span>{success}</span>
        </div>
      ) : null}
    </form>
  );
};

export default RoleForm;
