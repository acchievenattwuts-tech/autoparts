"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CloudUpload, ExternalLink, RefreshCw } from "lucide-react";

type GithubRunStatus = "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "CANCELLED" | "UNKNOWN";

type GithubBackupProgress = {
  percent: number;
  stage: number;
  totalStages: number;
  label: string;
  isIndeterminate: boolean;
  startedAt: string | null;
};

type GithubBackupRun = {
  id: number;
  status: GithubRunStatus;
  event: string;
  htmlUrl: string;
  createdAt: string;
  updatedAt: string;
  actor: string | null;
  progress: GithubBackupProgress | null;
};

type BackupCenterClientProps = {
  envStatus: {
    githubBackup: boolean;
  };
};

const GITHUB_STATUS_LABEL: Record<GithubRunStatus, string> = {
  QUEUED: "รอคิว",
  RUNNING: "กำลังทำงาน",
  SUCCESS: "สำเร็จ",
  FAILED: "ผิดพลาด",
  CANCELLED: "ถูกยกเลิก",
  UNKNOWN: "ไม่ทราบสถานะ",
};

const GITHUB_ERROR_LABEL: Record<string, string> = {
  GITHUB_BACKUP_NOT_CONFIGURED: "ยังไม่ได้ตั้งค่า GITHUB_BACKUP_TOKEN และ GITHUB_BACKUP_REPO",
  GITHUB_BACKUP_UNAUTHORIZED: "token ไม่มีสิทธิ์สั่งรัน workflow กรุณาตรวจสิทธิ์ Actions: write",
  GITHUB_BACKUP_WORKFLOW_NOT_FOUND: "ไม่พบไฟล์ backup.yml บน branch ที่ตั้งไว้",
  GITHUB_BACKUP_DISPATCH_FAILED: "สั่งรัน backup ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  GITHUB_BACKUP_RUNS_FAILED: "โหลดสถานะ backup ไม่สำเร็จ",
};

function githubErrorMessage(code: string): string {
  return GITHUB_ERROR_LABEL[code] ?? "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง";
}

function formatDate(value: string | null): string {
  if (!value) return "-";
  // "th-TH" alone resolves to the Buddhist calendar and renders 2569 for 2026.
  // Every other date in the system is Gregorian, so this column was the one
  // place showing a B.E. year. See .rules §8.
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatElapsed(startedAt: string | null, now: number | null): string {
  if (!startedAt || now === null) return "กำลังคำนวณเวลา";
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  if (hours > 0) return `${hours} ชม. ${minutes} นาที`;
  if (minutes > 0) return `${minutes} นาที`;
  return `${elapsedSeconds} วินาที`;
}

function ProgressBar({
  value,
  indeterminate = false,
  label = "ความคืบหน้า",
}: {
  value: number;
  indeterminate?: boolean;
  label?: string;
}) {
  const percent = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(percent)}
      className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800"
    >
      <div
        className={`h-full rounded-full bg-sky-500 transition-all duration-500 dark:bg-sky-400 ${indeterminate ? "animate-pulse" : ""}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

export default function BackupCenterClient({ envStatus }: BackupCenterClientProps) {
  const [githubRuns, setGithubRuns] = useState<GithubBackupRun[]>([]);
  const [githubLoading, setGithubLoading] = useState(envStatus.githubBackup);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [dispatching, setDispatching] = useState(false);

  const refreshGithubRuns = useCallback(async () => {
    if (!envStatus.githubBackup) return;
    const response = await fetch("/api/admin/backup-center/github-backup", { cache: "no-store" });
    const payload = (await response.json()) as { ok: boolean; runs?: GithubBackupRun[]; error?: string };
    if (!response.ok || !payload.ok) throw new Error(payload.error ?? "GITHUB_BACKUP_RUNS_FAILED");
    setGithubRuns(payload.runs ?? []);
    setGithubError(null);
  }, [envStatus.githubBackup]);

  useEffect(() => {
    if (!envStatus.githubBackup) return;
    let active = true;
    const timer = window.setTimeout(() => {
      refreshGithubRuns()
        .catch((err) => {
          if (active) setGithubError(githubErrorMessage(err instanceof Error ? err.message : ""));
        })
        .finally(() => {
          if (active) setGithubLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [envStatus.githubBackup, refreshGithubRuns]);

  const hasActiveGithubRun = useMemo(
    () => githubRuns.some((run) => run.status === "QUEUED" || run.status === "RUNNING"),
    [githubRuns],
  );

  // A backup run takes minutes, not seconds, and every poll costs a GitHub API
  // call — 10s is responsive enough without burning the rate limit.
  useEffect(() => {
    if (!envStatus.githubBackup || (!hasActiveGithubRun && !dispatching)) return;
    const timer = window.setInterval(() => {
      void refreshGithubRuns().catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [envStatus.githubBackup, hasActiveGithubRun, dispatching, refreshGithubRuns]);

  const runGithubBackup = useCallback(async () => {
    setDispatching(true);
    setGithubError(null);
    try {
      const response = await fetch("/api/admin/backup-center/github-backup", { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "GITHUB_BACKUP_DISPATCH_FAILED");

      // GitHub queues the run asynchronously, so it is not in the runs list yet.
      // Give it a moment before the first poll so the panel does not flash "ไม่มีประวัติ".
      await new Promise((resolve) => window.setTimeout(resolve, 3000));
      await refreshGithubRuns();
    } catch (err) {
      setGithubError(githubErrorMessage(err instanceof Error ? err.message : ""));
    } finally {
      setDispatching(false);
    }
  }, [refreshGithubRuns]);

  return (
    <div className="space-y-4">
      <AutoBackupPanel
        configured={envStatus.githubBackup}
        runs={githubRuns}
        loading={githubLoading}
        dispatching={dispatching}
        error={githubError}
        onRun={() => void runGithubBackup()}
        onRefresh={() => {
          void refreshGithubRuns().catch((err) => {
            setGithubError(githubErrorMessage(err instanceof Error ? err.message : ""));
          });
        }}
      />
    </div>
  );
}

function githubStatusClass(status: GithubRunStatus): string {
  if (status === "SUCCESS") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200";
  if (status === "FAILED") return "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/30 dark:bg-rose-400/10 dark:text-rose-200";
  if (status === "RUNNING" || status === "QUEUED") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200";
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-slate-900 dark:text-slate-300";
}

function AutoBackupPanel({
  configured,
  runs,
  loading,
  dispatching,
  error,
  onRun,
  onRefresh,
}: {
  configured: boolean;
  runs: GithubBackupRun[];
  loading: boolean;
  dispatching: boolean;
  error: string | null;
  onRun: () => void;
  onRefresh: () => void;
}) {
  const activeRun = runs.find((run) => run.status === "QUEUED" || run.status === "RUNNING") ?? null;
  const running = activeRun !== null;
  const lastSuccess = runs.find((run) => run.status === "SUCCESS") ?? null;
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;
    const updateClock = () => setNow(Date.now());
    const initialTimer = window.setTimeout(updateClock, 0);
    const timer = window.setInterval(updateClock, 1000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, [running]);

  const progress = activeRun?.progress ?? (dispatching ? {
    percent: 2,
    stage: 0,
    totalStages: 7,
    label: "กำลังส่งคำสั่งไป GitHub",
    isIndeterminate: true,
    startedAt: null,
  } satisfies GithubBackupProgress : null);

  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-400/30 dark:bg-sky-400/10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="rounded-lg border border-sky-200 bg-white p-2 text-sky-700 dark:border-sky-400/30 dark:bg-slate-950 dark:text-sky-200">
            <CloudUpload size={22} />
          </div>
          <div className="min-w-0 space-y-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-50">
              Backup อัตโนมัติเข้า Google Drive
            </h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              สำรองฐานข้อมูลและไฟล์รูปทั้งหมดขึ้น Google Drive โดยอัตโนมัติทุกวันจันทร์ 02:00 น.
              หรือกดปุ่มนี้เพื่อสั่งสำรองทันที งานจะไปทำงานบนเครื่องของ GitHub ไม่ต้องเปิดคอมพิวเตอร์ทิ้งไว้
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              รอบแรกอาจใช้เวลา 1-3 ชั่วโมง ส่วนรอบถัดไปแบบ incremental มักเร็วกว่า
              ระบบจะแจ้ง Telegram เมื่อกำหนด Secrets แล้ว และปิดหน้านี้ระหว่างรอได้
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 lg:w-64">
          <button
            type="button"
            onClick={onRun}
            disabled={!configured || dispatching || running}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-sky-500 dark:hover:bg-sky-400"
          >
            <CloudUpload size={16} />
            {dispatching ? "กำลังสั่งงาน..." : running ? "กำลังสำรองข้อมูล..." : "สำรองข้อมูลเดี๋ยวนี้"}
          </button>
          <button
            type="button"
            onClick={onRefresh}
            disabled={!configured}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-sky-400/30 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-sky-400/10"
          >
            <RefreshCw size={16} />
            ตรวจสถานะล่าสุด
          </button>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {!configured ? (
          <p className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-amber-800 dark:border-amber-400/30 dark:bg-slate-950 dark:text-amber-100">
            ยังใช้งานไม่ได้ — ต้องตั้งค่า <code className="font-mono text-xs">GITHUB_BACKUP_TOKEN</code> และ{" "}
            <code className="font-mono text-xs">GITHUB_BACKUP_REPO</code> ก่อน ดูขั้นตอนใน docs/backup-automation-runbook.md
          </p>
        ) : error ? (
          <p className="rounded-md border border-rose-200 bg-white px-3 py-2 text-sm text-rose-700 dark:border-rose-400/30 dark:bg-slate-950 dark:text-rose-200">
            {error}
          </p>
        ) : null}

        {progress ? (
          <div
            aria-live="polite"
            className="rounded-lg border border-sky-200 bg-white p-3 shadow-sm dark:border-sky-400/20 dark:bg-slate-950"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium text-slate-800 dark:text-slate-100">{progress.label}</span>
              <span className="font-semibold tabular-nums text-sky-700 dark:text-sky-300">
                ประมาณ {progress.percent}%
              </span>
            </div>
            <div className="mt-2">
              <ProgressBar
                value={progress.percent}
                indeterminate={progress.isIndeterminate}
                label={`ความคืบหน้า Backup โดยประมาณ ${progress.percent}%`}
              />
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>
                ขั้นตอน {progress.stage}/{progress.totalStages}
                {activeRun ? ` · ใช้เวลา ${formatElapsed(progress.startedAt ?? activeRun.createdAt, now)}` : ""}
              </span>
              <span>อัปเดตอัตโนมัติทุก 10 วินาที</span>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              เปอร์เซ็นต์คำนวณจากขั้นตอนของ GitHub Actions; ระหว่างอัปโหลดไฟล์จำนวนมากแถบอาจค้างที่ขั้นเดิมจนตรวจปลายทางเสร็จ
            </p>
          </div>
        ) : null}

        {configured && lastSuccess ? (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            สำรองข้อมูลสำเร็จครั้งล่าสุด: <span className="font-medium">{formatDate(lastSuccess.updatedAt)}</span>
          </p>
        ) : null}

        {configured ? (
          loading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">กำลังโหลดสถานะ...</p>
          ) : runs.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">ยังไม่เคยสำรองข้อมูลด้วยวิธีนี้</p>
          ) : (
            <ul className="divide-y divide-sky-200/70 overflow-hidden rounded-md border border-sky-200 bg-white dark:divide-white/10 dark:border-sky-400/20 dark:bg-slate-950">
              {runs.map((run) => (
                <li key={run.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${githubStatusClass(run.status)}`}>
                      {GITHUB_STATUS_LABEL[run.status]}
                    </span>
                    <span className="text-slate-600 dark:text-slate-300">{formatDate(run.createdAt)}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {run.event === "schedule" ? "อัตโนมัติ" : "สั่งเอง"}
                    </span>
                  </div>
                  <a
                    href={run.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline dark:text-sky-300"
                  >
                    ดู log
                    <ExternalLink size={12} />
                  </a>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </section>
  );
}
