import assert from "node:assert/strict";
import test, { before, beforeEach, mock } from "node:test";

// Scheduled Facebook publish must be idempotent: once Facebook accepted the
// post, no failure afterwards may lead to a second publish (QStash retries and
// admin requeue both re-enter this route), and a job whose function died while
// RUNNING must not block the post forever.

type JobState = {
  id: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  lastError: string | null;
  attemptCount: number;
};
type PostState = {
  id: string;
  status: string;
  metaPostId: string | null;
  lastError: string | null;
  title: string | null;
  caption: string;
  imageUrl: string | null;
  linkUrl: string | null;
  scheduledAt: Date | null;
  facebookPageId: string;
  createdByUserId: string;
  approvedByUserId: string | null;
};
type Where = { id: string; status?: { in: string[] } | string; startedAt?: { lt: Date } };

let job: JobState;
let post: PostState;
let publishCalls = 0;
let publishResult: () => Promise<string>;
let failTransactions = 0;
let failAuditLogs = 0;
const auditActions: string[] = [];
let findFirstArgs: unknown = null;

const matchesJob = (where: Where): boolean => {
  if (where.id !== job.id) return false;
  if (typeof where.status === "string" && job.status !== where.status) return false;
  if (typeof where.status === "object" && !where.status.in.includes(job.status)) return false;
  if (where.startedAt && !(job.startedAt && job.startedAt < where.startedAt.lt)) return false;
  return true;
};

const applyIncrement = (data: Record<string, unknown>) => {
  const next = { ...data };
  if (typeof next.attemptCount === "object") {
    next.attemptCount = job.attemptCount + 1;
  }
  return next;
};

const fakeDb = {
  contentScheduledJob: {
    findUnique: async () => ({ ...job, post: { ...post } }),
    findFirst: async (args: unknown) => {
      findFirstArgs = args;
      return null;
    },
    updateMany: async ({ where, data }: { where: Where; data: Record<string, unknown> }) => {
      if (!matchesJob(where)) return { count: 0 };
      Object.assign(job, applyIncrement(data));
      return { count: 1 };
    },
    update: async ({ data }: { data: Partial<JobState> }) => Object.assign(job, data),
  },
  contentPost: {
    update: async ({ data }: { data: Partial<PostState> }) => Object.assign(post, data),
  },
  contentAuditLog: {
    create: async ({ data }: { data: { action: string } }) => {
      if (failAuditLogs > 0) {
        failAuditLogs -= 1;
        throw new Error("AUDIT_DOWN");
      }
      auditActions.push(data.action);
      return data;
    },
  },
  $transaction: async <T,>(callback: (tx: object) => Promise<T>): Promise<T> => {
    if (failTransactions > 0) {
      failTransactions -= 1;
      throw new Error("POOLER_TIMEOUT");
    }
    return callback(fakeDb);
  },
};

before(async () => {
  await mock.module("@/lib/db", { namedExports: { db: fakeDb } });
  await mock.module("@/lib/content-facebook", {
    namedExports: {
      publishFacebookPagePost: async () => {
        publishCalls += 1;
        return publishResult();
      },
    },
  });
  await mock.module("@/lib/content-line", {
    namedExports: { sendContentWorkflowNotification: async () => undefined },
  });
  await mock.module("@/lib/content-config", {
    namedExports: { getContentConfig: () => ({ appBaseUrl: "" }) },
  });
  await mock.module("@/lib/content-qstash", {
    namedExports: { getQStashReceiver: () => ({ verify: async () => true }) },
  });
});

beforeEach(() => {
  job = { id: "job1", status: "DISPATCHED", startedAt: null, finishedAt: null, lastError: null, attemptCount: 0 };
  post = {
    id: "post1",
    status: "SCHEDULED",
    metaPostId: null,
    lastError: null,
    title: null,
    caption: "caption",
    imageUrl: null,
    linkUrl: null,
    scheduledAt: null,
    facebookPageId: "page",
    createdByUserId: "u1",
    approvedByUserId: null,
  };
  publishCalls = 0;
  publishResult = async () => "meta_123";
  failTransactions = 0;
  failAuditLogs = 0;
  auditActions.length = 0;
});

const callRoute = async () => {
  const { POST } = await import("../route");
  const response = await POST(
    new Request("https://shop.test/api/content/publish", {
      method: "POST",
      headers: { "upstash-signature": "sig" },
      body: JSON.stringify({ jobId: "job1" }),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

test("happy path publishes once and records the post as POSTED", async () => {
  const result = await callRoute();
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, metaPostId: "meta_123" });
  assert.equal(publishCalls, 1);
  assert.equal(job.status, "SUCCEEDED");
  assert.equal(post.status, "POSTED");
  assert.equal(post.metaPostId, "meta_123");
  assert.deepEqual(auditActions, ["PUBLISH_SUCCEEDED"]);
});

test("a DB failure after Facebook accepted the post never marks it FAILED or asks for a retry", async () => {
  failTransactions = 1; // the finishing transaction fails once
  const result = await callRoute();
  assert.equal(result.status, 200);
  assert.equal(result.body.metaPostId, "meta_123");
  assert.equal(publishCalls, 1);
  assert.equal(job.status, "SUCCEEDED");
  assert.equal(job.lastError, "POOLER_TIMEOUT");
  assert.equal(post.status, "POSTED");

  // A duplicate delivery afterwards is a no-op.
  await callRoute();
  assert.equal(publishCalls, 1);
});

test("an audit-log failure after commit no longer flips POSTED back to FAILED", async () => {
  failAuditLogs = 1;
  const result = await callRoute();
  assert.equal(result.status, 200);
  assert.equal(publishCalls, 1);
  assert.equal(job.status, "SUCCEEDED");
  assert.equal(post.status, "POSTED");
});

test("when finishing keeps failing the job answers 500 but the recorded metaPostId prevents a re-post", async () => {
  failTransactions = 2;
  const first = await callRoute();
  assert.equal(first.status, 500);
  assert.equal(post.metaPostId, "meta_123", "metaPostId recorded right after publishing");
  assert.equal(post.status, "SCHEDULED");

  // Admin requeue / retry on a claimable job finishes without calling Facebook.
  job.status = "FAILED";
  const retry = await callRoute();
  assert.equal(retry.status, 200);
  assert.equal(publishCalls, 1);
  assert.equal(post.status, "POSTED");
  assert.equal(job.status, "SUCCEEDED");
});

test("a Facebook error keeps the existing failure handling", async () => {
  publishResult = async () => {
    throw new Error("FACEBOOK_DOWN");
  };
  const result = await callRoute();
  assert.equal(result.status, 500);
  assert.equal(job.status, "FAILED");
  assert.equal(post.status, "FAILED");
  assert.equal(post.metaPostId, null);
  assert.deepEqual(auditActions, ["PUBLISH_FAILED"]);
});

test("RUNNING inside the lease is still skipped; past the lease it is released without re-posting", async () => {
  job.status = "RUNNING";
  job.startedAt = new Date(Date.now() - 60_000);
  const fresh = await callRoute();
  assert.deepEqual(fresh.body, { skipped: true, reason: "ALREADY_RUNNING" });

  job.startedAt = new Date(Date.now() - 16 * 60_000);
  const stale = await callRoute();
  assert.deepEqual(stale.body, { skipped: true, reason: "STALE_RUN_MARKED_FAILED" });
  assert.equal(publishCalls, 0);
  assert.equal(job.status, "FAILED");
  assert.equal(post.status, "FAILED");
});

test("a stale RUNNING job whose post already has a metaPostId is finished as POSTED", async () => {
  job.status = "RUNNING";
  job.startedAt = new Date(Date.now() - 16 * 60_000);
  post.metaPostId = "meta_prev";
  const result = await callRoute();
  assert.deepEqual(result.body, { skipped: true, reason: "STALE_RUN_FINALIZED" });
  assert.equal(publishCalls, 0);
  assert.equal(job.status, "SUCCEEDED");
  assert.equal(post.status, "POSTED");
});

test("hasActiveContentPublishJob ignores RUNNING jobs whose lease expired", async () => {
  const { hasActiveContentPublishJob, isContentPublishRunLeaseExpired, CONTENT_PUBLISH_RUNNING_LEASE_MS } =
    await import("@/lib/content-repository");
  assert.equal(await hasActiveContentPublishJob("post1"), false);
  const where = (findFirstArgs as { where: { OR: Record<string, unknown>[] } }).where;
  assert.deepEqual(where.OR[0], { status: { in: ["PENDING", "DISPATCHED"] } });
  assert.equal(where.OR[1].status, "RUNNING");

  const now = new Date("2026-09-23T10:00:00.000Z");
  assert.equal(isContentPublishRunLeaseExpired(null, now), false);
  assert.equal(isContentPublishRunLeaseExpired(new Date(now.getTime() - CONTENT_PUBLISH_RUNNING_LEASE_MS), now), false);
  assert.equal(isContentPublishRunLeaseExpired(new Date(now.getTime() - CONTENT_PUBLISH_RUNNING_LEASE_MS - 1), now), true);
});
