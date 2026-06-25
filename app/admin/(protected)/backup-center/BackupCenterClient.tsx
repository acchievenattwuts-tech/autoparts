"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Archive, CheckCircle2, Database, Download, FileJson, PackageOpen, RefreshCw, XCircle } from "lucide-react";

type BackupKind = "BLOB" | "POSTGRES";
type BackupStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED";

type BackupJob = {
  id: string;
  kind: BackupKind;
  status: BackupStatus;
  phase: string | null;
  message: string | null;
  processedItems: number;
  totalItems: number;
  processedBytes: string;
  totalBytes: string;
  percent: number;
  artifactKind: "BLOB_PREFIX" | "LOCAL_FILE" | null;
  artifactUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdBy: { name: string | null; email: string | null } | null;
};

type BackupCenterClientProps = {
  envStatus: {
    blobToken: boolean;
    databaseUrl: boolean;
  };
};

type PgDumpStatus = {
  available: boolean;
  version: string | null;
  error: string | null;
};

const KIND_LABEL: Record<BackupKind, string> = {
  BLOB: "Vercel Blob",
  POSTGRES: "PostgreSQL",
};

const STATUS_LABEL: Record<BackupStatus, string> = {
  PENDING: "รอเริ่ม",
  RUNNING: "กำลังทำงาน",
  SUCCESS: "สำเร็จ",
  FAILED: "ผิดพลาด",
};

function formatBytes(raw: string): string {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusClass(status: BackupStatus): string {
  if (status === "SUCCESS") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200";
  if (status === "FAILED") return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200";
  if (status === "RUNNING") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200";
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300";
}

function ProgressBar({ value }: { value: number }) {
  const percent = Math.min(100, Math.max(0, value));
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
      <div
        className="h-full rounded-full bg-sky-500 transition-all duration-300 dark:bg-sky-400"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export default function BackupCenterClient({ envStatus }: BackupCenterClientProps) {
  const [jobs, setJobs] = useState<BackupJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingAction, setDownloadingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pgDumpStatus, setPgDumpStatus] = useState<PgDumpStatus | null>(null);
  const [checkingPgDump, setCheckingPgDump] = useState(false);

  const refreshJobs = useCallback(async () => {
    const response = await fetch("/api/admin/backup-center/jobs", { cache: "no-store" });
    if (!response.ok) throw new Error("LOAD_BACKUP_JOBS_FAILED");
    const payload = (await response.json()) as { jobs: BackupJob[] };
    setJobs(payload.jobs);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      refreshJobs()
        .catch((err) => {
          if (active) setError(err instanceof Error ? err.message : "LOAD_BACKUP_JOBS_FAILED");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [refreshJobs]);

  const hasActiveJob = useMemo(
    () => jobs.some((job) => job.status === "PENDING" || job.status === "RUNNING"),
    [jobs],
  );

  useEffect(() => {
    if (!hasActiveJob) return;
    const timer = window.setInterval(() => {
      void refreshJobs().catch((err) => {
        setError(err instanceof Error ? err.message : "LOAD_BACKUP_JOBS_FAILED");
      });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [hasActiveJob, refreshJobs]);

  const startDownload = (action: string, href: string) => {
    setError(null);
    setDownloadingAction(action);
    window.location.href = href;
    window.setTimeout(() => setDownloadingAction(null), 1500);
  };

  const checkPgDump = useCallback(async () => {
    setCheckingPgDump(true);
    try {
      const response = await fetch("/api/admin/backup-center/pg-dump-status", { cache: "no-store" });
      if (!response.ok) throw new Error("PG_DUMP_STATUS_FAILED");
      setPgDumpStatus((await response.json()) as PgDumpStatus);
    } catch (err) {
      setPgDumpStatus({
        available: false,
        version: null,
        error: err instanceof Error ? err.message : "PG_DUMP_STATUS_FAILED",
      });
    } finally {
      setCheckingPgDump(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkPgDump();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [checkPgDump]);

  const activeBlob = jobs.find((job) => job.kind === "BLOB" && (job.status === "PENDING" || job.status === "RUNNING"));
  const activePostgres = jobs.find((job) => job.kind === "POSTGRES" && (job.status === "PENDING" || job.status === "RUNNING"));

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <BackupActionPanel
          title="Vercel Blob Manifest"
          description="ดาวน์โหลด manifest รายการ blob objects ทั้งหมด ไม่ copy backup ซ้ำเข้า Vercel Blob"
          icon={<Archive size={22} />}
          envReady={envStatus.blobToken}
          envLabel="BLOB_READ_WRITE_TOKEN"
          activeJob={activeBlob}
          actionIcon={<FileJson size={16} />}
          actionLabel="Download Manifest"
          downloading={downloadingAction === "blob-manifest"}
          onStart={() => startDownload("blob-manifest", "/api/admin/backup-center/download/blob-manifest")}
        />
        <BackupActionPanel
          title="Vercel Blob Archive"
          description="ดาวน์โหลดไฟล์ .tar ที่รวม manifest และ blob objects โดยไม่เก็บ archive ไว้ใน Vercel Blob"
          icon={<PackageOpen size={22} />}
          envReady={envStatus.blobToken}
          envLabel="BLOB_READ_WRITE_TOKEN"
          activeJob={activeBlob}
          actionIcon={<Download size={16} />}
          actionLabel="Download Archive"
          downloading={downloadingAction === "blob-archive"}
          onStart={() => startDownload("blob-archive", "/api/admin/backup-center/download/blob-archive")}
        />
        <BackupActionPanel
          title="PostgreSQL Download"
          description="สร้าง pg_dump custom-format ใน temp runtime แล้วดาวน์โหลดลงเครื่องผู้ใช้ทันที ไม่เก็บใน Vercel Blob"
          icon={<Database size={22} />}
          envReady={envStatus.databaseUrl}
          envLabel="BACKUP_DATABASE_URL / DIRECT_URL / DATABASE_URL"
          activeJob={activePostgres}
          actionIcon={<Download size={16} />}
          actionLabel="Download PostgreSQL Dump"
          downloading={downloadingAction === "postgres"}
          onStart={() => startDownload("postgres", "/api/admin/backup-center/download/postgres")}
        />
      </div>

      <PgDumpHelper status={pgDumpStatus} checking={checkingPgDump} onCheck={() => void checkPgDump()} />

      <section className="rounded-lg border border-slate-200 bg-white dark:border-white/10 dark:bg-slate-950">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">ประวัติ Backup</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">แสดง 20 งานล่าสุด</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshJobs()}
            className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">กำลังโหลด...</div>
        ) : jobs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500 dark:text-slate-400">ยังไม่มีประวัติ backup</div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-white/10">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PgDumpHelper({
  status,
  checking,
  onCheck,
}: {
  status: PgDumpStatus | null;
  checking: boolean;
  onCheck: () => void;
}) {
  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">PostgreSQL backup ต้องใช้ pg_dump</h2>
            {status ? (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${status.available ? "border-emerald-300 bg-emerald-100 text-emerald-800 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-100" : "border-rose-300 bg-rose-100 text-rose-800 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-100"}`}>
                {status.available ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                {status.available ? "pg_dump พร้อมใช้งาน" : "ไม่พบ pg_dump"}
              </span>
            ) : null}
          </div>
          <p>
            ถ้ากด PostgreSQL Backup แล้ว runtime ไม่มีคำสั่ง <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs dark:bg-amber-950">pg_dump</code> งานจะล้มเหลวด้วย <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs dark:bg-amber-950">PG_DUMP_NOT_AVAILABLE</code>
          </p>
          {status?.version ? (
            <p className="rounded-md border border-emerald-200 bg-white/70 px-3 py-2 font-mono text-xs text-emerald-900 dark:border-emerald-400/20 dark:bg-slate-950/40 dark:text-emerald-100">
              {status.version}
            </p>
          ) : status?.error ? (
            <p className="rounded-md border border-rose-200 bg-white/70 px-3 py-2 font-mono text-xs text-rose-700 dark:border-rose-400/20 dark:bg-slate-950/40 dark:text-rose-200">
              {status.error}
            </p>
          ) : null}
          <div className="grid gap-2 md:grid-cols-3">
            <div className="rounded-md border border-amber-200 bg-white/70 p-3 dark:border-amber-400/20 dark:bg-slate-950/40">
              <p className="font-medium">Windows</p>
              <p className="mt-1 text-xs opacity-80">ติดตั้ง PostgreSQL installer แล้วเพิ่มโฟลเดอร์ bin เข้า PATH</p>
            </div>
            <div className="rounded-md border border-amber-200 bg-white/70 p-3 dark:border-amber-400/20 dark:bg-slate-950/40">
              <p className="font-medium">macOS</p>
              <p className="mt-1 text-xs opacity-80">ใช้ official installer หรือ Homebrew package ตามคู่มือ PostgreSQL</p>
            </div>
            <div className="rounded-md border border-amber-200 bg-white/70 p-3 dark:border-amber-400/20 dark:bg-slate-950/40">
              <p className="font-medium">Linux</p>
              <p className="mt-1 text-xs opacity-80">ติดตั้งจาก package manager ของ distribution ที่ใช้งาน</p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:max-w-xs lg:justify-end">
          <button
            type="button"
            onClick={onCheck}
            disabled={checking}
            className="rounded-md border border-amber-300 bg-white px-3 py-2 font-medium text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-400/40 dark:bg-slate-950 dark:text-amber-100 dark:hover:bg-amber-400/10"
          >
            {checking ? "Checking..." : "Check pg_dump"}
          </button>
          <a className="rounded-md border border-amber-300 bg-white px-3 py-2 font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-400/40 dark:bg-slate-950 dark:text-amber-100 dark:hover:bg-amber-400/10" href="https://www.postgresql.org/download/windows/" target="_blank" rel="noreferrer">
            Windows
          </a>
          <a className="rounded-md border border-amber-300 bg-white px-3 py-2 font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-400/40 dark:bg-slate-950 dark:text-amber-100 dark:hover:bg-amber-400/10" href="https://www.postgresql.org/download/macosx/" target="_blank" rel="noreferrer">
            macOS
          </a>
          <a className="rounded-md border border-amber-300 bg-white px-3 py-2 font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-400/40 dark:bg-slate-950 dark:text-amber-100 dark:hover:bg-amber-400/10" href="https://www.postgresql.org/download/linux/" target="_blank" rel="noreferrer">
            Linux
          </a>
          <a className="rounded-md border border-amber-300 bg-white px-3 py-2 font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-400/40 dark:bg-slate-950 dark:text-amber-100 dark:hover:bg-amber-400/10" href="https://www.postgresql.org/docs/current/app-pgdump.html" target="_blank" rel="noreferrer">
            pg_dump docs
          </a>
        </div>
      </div>
    </section>
  );
}

function BackupActionPanel({
  title,
  description,
  icon,
  envReady,
  envLabel,
  activeJob,
  starting,
  actionIcon,
  actionLabel,
  downloading,
  onStart,
}: {
  title: string;
  description: string;
  icon: ReactNode;
  envReady: boolean;
  envLabel: string;
  activeJob?: BackupJob;
  starting?: boolean;
  actionIcon: ReactNode;
  actionLabel: string;
  downloading: boolean;
  onStart: () => void;
}) {
  const disabled = !envReady || Boolean(activeJob) || Boolean(starting) || downloading;
  const progress = activeJob?.percent ?? 0;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-200">
            {icon}
          </div>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">{title}</h2>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
          </div>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${envReady ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200" : "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200"}`}>
          {envReady ? "พร้อมใช้งาน" : "ขาด env"}
        </span>
      </div>

      <div className="mt-4 space-y-3">
        <div className="text-xs text-slate-500 dark:text-slate-400">ตรวจ env: {envLabel}</div>
        {activeJob ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">{activeJob.message ?? STATUS_LABEL[activeJob.status]}</span>
              <span className="tabular-nums text-slate-500 dark:text-slate-400">{progress}%</span>
            </div>
            <ProgressBar value={progress} />
            <div className="text-xs text-slate-500 dark:text-slate-400">
              {activeJob.processedItems}/{activeJob.totalItems || 0} items · {formatBytes(activeJob.processedBytes)} / {formatBytes(activeJob.totalBytes)}
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={onStart}
          disabled={disabled}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
        >
          {actionIcon}
          {downloading ? "กำลังเตรียมดาวน์โหลด..." : actionLabel}
        </button>
      </div>
    </section>
  );
}

function JobRow({ job }: { job: BackupJob }) {
  return (
    <div className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_180px_160px] lg:items-center">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-slate-900 dark:text-slate-50">{KIND_LABEL[job.kind]}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusClass(job.status)}`}>
            {STATUS_LABEL[job.status]}
          </span>
          {job.phase ? <span className="text-xs text-slate-500 dark:text-slate-400">{job.phase}</span> : null}
        </div>
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
            <span className="truncate">{job.message ?? "-"}</span>
            <span className="tabular-nums">{job.percent}%</span>
          </div>
          <ProgressBar value={job.percent} />
        </div>
        {job.errorMessage ? (
          <p className="break-words text-xs text-rose-600 dark:text-rose-300">{job.errorMessage}</p>
        ) : null}
      </div>

      <div className="text-sm text-slate-500 dark:text-slate-400">
        <div>{formatDate(job.createdAt)}</div>
        <div className="text-xs">{job.createdBy?.name ?? job.createdBy?.email ?? "-"}</div>
      </div>

      <div className="flex items-center gap-2 lg:justify-end">
        <div className="text-right text-xs text-slate-500 dark:text-slate-400">
          <div>{job.processedItems}/{job.totalItems || 0} items</div>
          <div>{formatBytes(job.processedBytes)}</div>
        </div>
        {job.status === "SUCCESS" ? (
          <a
            href={`/api/admin/backup-center/jobs/${job.id}/download`}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 text-slate-700 transition hover:bg-slate-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5"
            title="Download artifact"
          >
            <Download size={16} />
          </a>
        ) : null}
      </div>
    </div>
  );
}
