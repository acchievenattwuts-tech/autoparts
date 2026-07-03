import test from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ??= "postgresql://user:pass@localhost:5432/autoparts_test";

type RestoreFn = () => void;

function stubMethod<T extends object, K extends keyof T>(
  target: T,
  key: K,
  implementation: T[K],
): RestoreFn {
  const original = target[key];
  target[key] = implementation;
  return () => {
    target[key] = original;
  };
}

test("listLineConversations falls back to Customer.lineUserId when conversation.customer is null", async () => {
  const { db } = await import("@/lib/db");
  const { listLineConversations } = await import("@/lib/line-admin-service");
  const restoreFindMany = stubMethod(
    db.lineConversation,
    "findMany",
    (async () => [
      {
        id: "conversation-1",
        lineUserId: "line-user-1",
        displayName: "June",
        aiStatus: "ACTIVE",
        assignedAdminId: null,
        lastCustomerMessageAt: null,
        lastAdminMessageAt: null,
        pausedReason: null,
        updatedAt: new Date("2026-07-03T00:00:00.000Z"),
        customer: null,
        assignedAdmin: null,
        _count: { messages: 3 },
        paymentSlips: [],
      },
    ]) as unknown as typeof db.lineConversation.findMany,
  );
  const restoreCustomerFindMany = stubMethod(
    db.customer,
    "findMany",
    (async () => [
      {
        id: "customer-1",
        lineUserId: "line-user-1",
        name: "ลูกค้าทดสอบ",
        phone: "0812345678",
      },
    ]) as unknown as typeof db.customer.findMany,
  );

  try {
    const result = await listLineConversations({ take: 10 });

    assert.equal(result.length, 1);
    assert.deepEqual(result[0]?.customer, {
      id: "customer-1",
      name: "ลูกค้าทดสอบ",
      phone: "0812345678",
    });
  } finally {
    restoreFindMany();
    restoreCustomerFindMany();
  }
});

test("getLineConversationMessages falls back to Customer.lineUserId when conversation.customer is null", async () => {
  const { db } = await import("@/lib/db");
  const { getLineConversationMessages } = await import("@/lib/line-admin-service");
  const restoreFindUnique = stubMethod(
    db.lineConversation,
    "findUnique",
    (async () => ({
      id: "conversation-1",
      lineUserId: "line-user-1",
      displayName: "June",
      aiStatus: "ACTIVE",
      pausedReason: null,
      customer: null,
      assignedAdmin: null,
    })) as unknown as typeof db.lineConversation.findUnique,
  );
  const restoreCustomerFindUnique = stubMethod(
    db.customer,
    "findUnique",
    (async () => ({
      id: "customer-1",
      name: "ลูกค้าทดสอบ",
      phone: "0812345678",
    })) as unknown as typeof db.customer.findUnique,
  );
  const restoreMessageFindMany = stubMethod(
    db.lineMessage,
    "findMany",
    (async () => []) as unknown as typeof db.lineMessage.findMany,
  );

  try {
    const result = await getLineConversationMessages({ conversationId: "conversation-1", take: 10 });

    assert.ok(result);
    assert.deepEqual(result?.conversation.customer, {
      id: "customer-1",
      name: "ลูกค้าทดสอบ",
      phone: "0812345678",
    });
  } finally {
    restoreFindUnique();
    restoreCustomerFindUnique();
    restoreMessageFindMany();
  }
});
