import { createReadStream } from "node:fs";
import { mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { get, list, put } from "@vercel/blob";

import { db } from "@/lib/db";
import {
  AuditAction,
  BackupArtifactKind,
  BackupJobKind,
  BackupJobStatus,
  Prisma,
} from "@/lib/generated/prisma";
import { getAuditActorFromSession, safeWriteAuditLog } from "@/lib/audit-log";
import type { Session } from "next-auth";

const BACKUP_ROOT = path.join(process.cwd(), ".tmp", "backup-center");
const BACKUP_PREFIX = "backups/";
const LIST_LIMIT = 1000;

type BackupJobSnapshot = {
  id: string;
  kind: BackupJobKind;
  status: BackupJobStatus;
};

type BlobManifestEntry = {
  pathname: string;
  backupPathname: string;
  size: number;
  uploadedAt: string;
  url: string;
  downloadUrl: string;
  etag: string;
};

function asPercent(processed: number, total: number): number {
  if (total <= 0) return processed > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, Math.floor((processed / total) * 100)));
}

function artifactAccessForUrl(url: string): "public" | "private" {
  return url.includes(".private.blob.vercel-storage.com") ? "private" : "public";
}

function serializeJobMetadata(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

async function updateJobProgress(
  jobId: string,
  data: Prisma.BackupJobUpdateInput,
) {
  await db.backupJob.update({
    where: { id: jobId },
    data,
  });
}

async function failJob(job: BackupJobSnapshot, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  await updateJobProgress(job.id, {
    status: BackupJobStatus.FAILED,
    phase: "FAILED",
    message: "Backup failed",
    errorMessage: message.slice(0, 2000),
    finishedAt: new Date(),
  });
}

export async function createBackupJob(kind: BackupJobKind, session: Session) {
  const active = await db.backupJob.findFirst({
    where: {
      kind,
      status: { in: [BackupJobStatus.PENDING, BackupJobStatus.RUNNING] },
    },
    orderBy: { createdAt: "desc" },
  });

  if (active) return active;

  const job = await db.backupJob.create({
    data: {
      kind,
      status: BackupJobStatus.PENDING,
      phase: "QUEUED",
      message: "Waiting to start",
      createdById: session.user.id,
    },
  });

  await safeWriteAuditLog({
    ...getAuditActorFromSession(session),
    action: AuditAction.EXPORT,
    entityType: "BackupJob",
    entityId: job.id,
    entityRef: kind,
    after: { kind, status: job.status },
  });

  return job;
}

export async function getBackupCenterJobs() {
  return db.backupJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: {
      createdBy: {
        select: { name: true, email: true },
      },
    },
  });
}

export async function getBackupCenterEnvStatus() {
  return {
    blobToken: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    databaseUrl: Boolean(process.env.DATABASE_URL),
  };
}

async function claimJob(jobId: string): Promise<BackupJobSnapshot | null> {
  const job = await db.backupJob.findUnique({
    where: { id: jobId },
    select: { id: true, kind: true, status: true },
  });
  if (!job) return null;
  if (job.status !== BackupJobStatus.PENDING) return job;

  const claim = await db.backupJob.updateMany({
    where: { id: jobId, status: BackupJobStatus.PENDING },
    data: {
      status: BackupJobStatus.RUNNING,
      startedAt: new Date(),
      phase: "STARTING",
      message: "Starting backup",
      percent: 0,
    },
  });

  if (claim.count === 0) {
    return db.backupJob.findUnique({
      where: { id: jobId },
      select: { id: true, kind: true, status: true },
    });
  }

  return { ...job, status: BackupJobStatus.RUNNING };
}

export async function runBackupJob(jobId: string) {
  const job = await claimJob(jobId);
  if (!job) throw new Error("BACKUP_JOB_NOT_FOUND");
  if (job.status === BackupJobStatus.SUCCESS || job.status === BackupJobStatus.FAILED) return job;

  try {
    if (job.kind === BackupJobKind.BLOB) {
      await runBlobBackup(job.id);
    } else {
      await runPostgresBackup(job.id);
    }
  } catch (error) {
    await failJob(job, error);
    throw error;
  }

  return db.backupJob.findUnique({ where: { id: jobId } });
}

async function collectBlobEntries(jobId: string) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN_REQUIRED");

  await updateJobProgress(jobId, {
    phase: "LISTING",
    message: "Listing Vercel Blob objects",
  });

  const entries: Awaited<ReturnType<typeof list>>["blobs"] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const page = await list({ cursor, limit: LIST_LIMIT, token });
    const sourceBlobs = page.blobs.filter((blob) => !blob.pathname.startsWith(BACKUP_PREFIX));
    entries.push(...sourceBlobs);
    cursor = page.cursor;
    hasMore = page.hasMore;

    await updateJobProgress(jobId, {
      totalItems: entries.length,
      totalBytes: entries.reduce((sum, blob) => sum + BigInt(blob.size), BigInt(0)),
      message: `Found ${entries.length} blob objects`,
    });
  }

  return entries;
}

async function runBlobBackup(jobId: string) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN_REQUIRED");

  const entries = await collectBlobEntries(jobId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `${BACKUP_PREFIX}blob/${timestamp}-${jobId}`;
  const totalBytes = entries.reduce((sum, blob) => sum + BigInt(blob.size), BigInt(0));
  const manifest: BlobManifestEntry[] = [];
  let processedBytes = BigInt(0);

  await updateJobProgress(jobId, {
    phase: "COPYING",
    message: "Copying blob objects into backup prefix",
    totalItems: entries.length,
    totalBytes,
  });

  for (let index = 0; index < entries.length; index += 1) {
    const blob = entries[index];
    const backupPathname = `${prefix}/objects/${blob.pathname}`;
    const source = await get(blob.url, { access: artifactAccessForUrl(blob.url), token });
    if (!source?.stream) {
      throw new Error(`BLOB_STREAM_UNAVAILABLE:${blob.pathname}`);
    }

    await put(backupPathname, source.stream, {
      access: artifactAccessForUrl(blob.url),
      allowOverwrite: true,
      token,
    });

    processedBytes += BigInt(blob.size);
    manifest.push({
      pathname: blob.pathname,
      backupPathname,
      size: blob.size,
      uploadedAt: blob.uploadedAt.toISOString(),
      url: blob.url,
      downloadUrl: blob.downloadUrl,
      etag: blob.etag,
    });

    const processedItems = index + 1;
    await updateJobProgress(jobId, {
      processedItems,
      processedBytes,
      percent: asPercent(processedItems, entries.length),
      message: `Copied ${processedItems}/${entries.length} blob objects`,
    });
  }

  await updateJobProgress(jobId, {
    phase: "WRITING_MANIFEST",
    message: "Writing backup manifest",
    percent: entries.length === 0 ? 90 : 99,
  });

  const manifestBlob = await put(
    `${prefix}/manifest.json`,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        source: "vercel-blob",
        totalItems: entries.length,
        totalBytes: totalBytes.toString(),
        files: manifest,
      },
      null,
      2,
    ),
    {
      access: manifest.some((entry) => artifactAccessForUrl(entry.url) === "private") ? "private" : "public",
      allowOverwrite: true,
      contentType: "application/json",
      token,
    },
  );

  await updateJobProgress(jobId, {
    status: BackupJobStatus.SUCCESS,
    phase: "DONE",
    message: "Blob backup completed",
    percent: 100,
    artifactKind: BackupArtifactKind.BLOB_PREFIX,
    artifactPath: prefix,
    artifactUrl: manifestBlob.downloadUrl,
    metadata: serializeJobMetadata({
      manifestPathname: manifestBlob.pathname,
      manifestUrl: manifestBlob.url,
      totalBytes: totalBytes.toString(),
    }),
    finishedAt: new Date(),
  });
}

async function runPostgresBackup(jobId: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");

  const outDir = path.join(BACKUP_ROOT, "postgres");
  await mkdir(outDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(outDir, `postgres-${timestamp}-${jobId}.dump`);

  await updateJobProgress(jobId, {
    phase: "DUMPING",
    message: "Running pg_dump",
    totalItems: 5,
    processedItems: 1,
    percent: 20,
  });

  await runPgDump(databaseUrl, outFile, async (message) => {
    await updateJobProgress(jobId, {
      phase: "DUMPING",
      message,
      processedItems: 2,
      percent: 45,
    });
  });

  await updateJobProgress(jobId, {
    phase: "CHECKING_ARTIFACT",
    message: "Checking dump artifact",
    processedItems: 3,
    percent: 70,
  });

  const stats = await stat(outFile);
  if (stats.size <= 0) {
    await unlink(outFile).catch(() => undefined);
    throw new Error("PG_DUMP_EMPTY_ARTIFACT");
  }

  await updateJobProgress(jobId, {
    status: BackupJobStatus.SUCCESS,
    phase: "DONE",
    message: "PostgreSQL backup completed",
    processedItems: 5,
    totalItems: 5,
    processedBytes: BigInt(stats.size),
    totalBytes: BigInt(stats.size),
    percent: 100,
    artifactKind: BackupArtifactKind.LOCAL_FILE,
    artifactPath: outFile,
    metadata: serializeJobMetadata({
      fileName: path.basename(outFile),
      size: stats.size,
      format: "pg_dump custom",
    }),
    finishedAt: new Date(),
  });
}

function runPgDump(
  databaseUrl: string,
  outFile: string,
  onMessage: (message: string) => Promise<void>,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        `--file=${outFile}`,
        databaseUrl,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      },
    );

    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      stderr += text;
      void onMessage(text.trim().slice(0, 300) || "pg_dump is running");
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("PG_DUMP_NOT_AVAILABLE"));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`PG_DUMP_FAILED:${code}:${stderr.slice(-1000)}`));
    });
  });
}

export async function getBackupArtifact(jobId: string) {
  const job = await db.backupJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== BackupJobStatus.SUCCESS || !job.artifactKind) {
    return null;
  }

  if (job.artifactKind === BackupArtifactKind.LOCAL_FILE) {
    if (!job.artifactPath) return null;
    const resolved = path.resolve(job.artifactPath);
    const root = path.resolve(BACKUP_ROOT);
    if (!resolved.startsWith(root)) return null;
    const stats = await stat(resolved).catch(() => null);
    if (!stats?.isFile()) return null;
    return {
      kind: job.artifactKind,
      fileName: path.basename(resolved),
      size: stats.size,
      stream: createReadStream(resolved),
    };
  }

  if (job.artifactUrl) {
    return {
      kind: job.artifactKind,
      redirectUrl: job.artifactUrl,
    };
  }

  return null;
}
