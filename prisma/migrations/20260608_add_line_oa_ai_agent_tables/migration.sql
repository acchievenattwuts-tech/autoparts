CREATE TYPE "LineConversationAiStatus" AS ENUM (
  'ACTIVE',
  'PAUSED_BY_ADMIN',
  'WAITING_ADMIN',
  'CLOSED'
);

CREATE TYPE "LineMessageDirection" AS ENUM (
  'INBOUND',
  'OUTBOUND_AI',
  'OUTBOUND_ADMIN',
  'SYSTEM'
);

CREATE TYPE "LineMessageType" AS ENUM (
  'TEXT',
  'IMAGE',
  'STICKER',
  'POSTBACK',
  'FOLLOW',
  'UNKNOWN'
);

CREATE TYPE "LineIntent" AS ENUM (
  'PRODUCT_INQUIRY_TEXT',
  'PART_IMAGE_INQUIRY',
  'PAYMENT_SLIP_IMAGE',
  'SHIPPING_ADDRESS',
  'ORDER_STATUS',
  'PRICE_NEGOTIATION',
  'CLAIM_OR_RETURN',
  'GREETING',
  'UNKNOWN'
);

CREATE TYPE "LineAiJobType" AS ENUM (
  'CLASSIFY_INTENT',
  'TEXT_REPLY',
  'IMAGE_OCR',
  'IMAGE_ANALYSIS',
  'PAYMENT_SLIP_OCR',
  'PAYMENT_SLIP_MATCH'
);

CREATE TYPE "LineAiJobStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'SKIPPED'
);

CREATE TYPE "LineAiConfidence" AS ENUM (
  'CONFIRMED',
  'POSSIBLE_MATCH',
  'NEED_MORE_INFO',
  'NOT_FOUND',
  'ADMIN_REQUIRED'
);

CREATE TYPE "LineAiSuggestionStatus" AS ENUM (
  'DRAFT',
  'SENT',
  'REJECTED',
  'EDITED_BY_ADMIN'
);

CREATE TYPE "LineDeliveryMode" AS ENUM (
  'REPLY',
  'PUSH',
  'NONE'
);

CREATE TYPE "LineDeliveryStatus" AS ENUM (
  'PENDING',
  'SENT',
  'FAILED',
  'SKIPPED'
);

CREATE TYPE "PaymentSlipVerificationStatus" AS ENUM (
  'PENDING_REVIEW',
  'MATCHED_PENDING_ADMIN_CONFIRM',
  'CONFIRMED_BY_ADMIN',
  'REJECTED',
  'NEEDS_MORE_INFO'
);

CREATE TABLE "LineConversation" (
  "id" TEXT NOT NULL,
  "lineUserId" TEXT NOT NULL,
  "displayName" TEXT,
  "pictureUrl" TEXT,
  "aiStatus" "LineConversationAiStatus" NOT NULL DEFAULT 'ACTIVE',
  "customerId" TEXT,
  "assignedAdminId" TEXT,
  "pausedReason" TEXT,
  "lastCustomerMessageAt" TIMESTAMPTZ(3),
  "lastAdminMessageAt" TIMESTAMPTZ(3),
  "pausedAt" TIMESTAMPTZ(3),
  "resumedAt" TIMESTAMPTZ(3),
  "closedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "LineConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "lineUserId" TEXT NOT NULL,
  "lineMessageId" TEXT,
  "lineEventId" TEXT,
  "replyToken" TEXT,
  "direction" "LineMessageDirection" NOT NULL,
  "messageType" "LineMessageType" NOT NULL,
  "intent" "LineIntent",
  "text" TEXT,
  "imageUrl" TEXT,
  "rawEvent" JSONB,
  "deliveryMode" "LineDeliveryMode",
  "deliveryStatus" "LineDeliveryStatus",
  "adminUserId" TEXT,
  "sentAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LineMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineAiJob" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "lineMessageId" TEXT,
  "jobType" "LineAiJobType" NOT NULL,
  "status" "LineAiJobStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "result" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(3),
  "finishedAt" TIMESTAMPTZ(3),

  CONSTRAINT "LineAiJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineAiSuggestion" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "lineMessageId" TEXT,
  "intent" "LineIntent",
  "suggestedReply" TEXT NOT NULL,
  "confidence" "LineAiConfidence" NOT NULL,
  "matchedProducts" JSONB,
  "reasoningSummary" TEXT,
  "status" "LineAiSuggestionStatus" NOT NULL DEFAULT 'DRAFT',
  "deliveryMode" "LineDeliveryMode",
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMPTZ(3),

  CONSTRAINT "LineAiSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LineAiAuditLog" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT,
  "action" TEXT NOT NULL,
  "payload" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LineAiAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentSlip" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "lineUserId" TEXT NOT NULL,
  "lineMessageId" TEXT,
  "imageUrl" TEXT,
  "detectedAmount" DECIMAL(10,2),
  "detectedTransferDatetime" TIMESTAMPTZ(3),
  "detectedBank" TEXT,
  "detectedSenderName" TEXT,
  "detectedReceiverName" TEXT,
  "detectedReferenceNo" TEXT,
  "matchedSaleId" TEXT,
  "verificationStatus" "PaymentSlipVerificationStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "rawOcr" JSONB,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMPTZ(3),
  "reviewedById" TEXT,

  CONSTRAINT "PaymentSlip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LineConversation_lineUserId_key" ON "LineConversation"("lineUserId");
CREATE INDEX "LineConversation_aiStatus_updatedAt_idx" ON "LineConversation"("aiStatus", "updatedAt");
CREATE INDEX "LineConversation_assignedAdminId_idx" ON "LineConversation"("assignedAdminId");
CREATE INDEX "LineConversation_customerId_idx" ON "LineConversation"("customerId");
CREATE INDEX "LineConversation_lastCustomerMessageAt_idx" ON "LineConversation"("lastCustomerMessageAt");

CREATE UNIQUE INDEX "LineMessage_lineEventId_key" ON "LineMessage"("lineEventId");
CREATE INDEX "LineMessage_conversationId_createdAt_idx" ON "LineMessage"("conversationId", "createdAt");
CREATE INDEX "LineMessage_lineUserId_createdAt_idx" ON "LineMessage"("lineUserId", "createdAt");
CREATE INDEX "LineMessage_lineMessageId_idx" ON "LineMessage"("lineMessageId");
CREATE INDEX "LineMessage_direction_createdAt_idx" ON "LineMessage"("direction", "createdAt");
CREATE INDEX "LineMessage_intent_createdAt_idx" ON "LineMessage"("intent", "createdAt");

CREATE INDEX "LineAiJob_conversationId_createdAt_idx" ON "LineAiJob"("conversationId", "createdAt");
CREATE INDEX "LineAiJob_lineMessageId_idx" ON "LineAiJob"("lineMessageId");
CREATE INDEX "LineAiJob_jobType_status_createdAt_idx" ON "LineAiJob"("jobType", "status", "createdAt");

CREATE INDEX "LineAiSuggestion_conversationId_createdAt_idx" ON "LineAiSuggestion"("conversationId", "createdAt");
CREATE INDEX "LineAiSuggestion_lineMessageId_idx" ON "LineAiSuggestion"("lineMessageId");
CREATE INDEX "LineAiSuggestion_intent_confidence_idx" ON "LineAiSuggestion"("intent", "confidence");
CREATE INDEX "LineAiSuggestion_status_createdAt_idx" ON "LineAiSuggestion"("status", "createdAt");

CREATE INDEX "LineAiAuditLog_conversationId_createdAt_idx" ON "LineAiAuditLog"("conversationId", "createdAt");
CREATE INDEX "LineAiAuditLog_action_createdAt_idx" ON "LineAiAuditLog"("action", "createdAt");

CREATE INDEX "PaymentSlip_conversationId_createdAt_idx" ON "PaymentSlip"("conversationId", "createdAt");
CREATE INDEX "PaymentSlip_lineUserId_createdAt_idx" ON "PaymentSlip"("lineUserId", "createdAt");
CREATE INDEX "PaymentSlip_lineMessageId_idx" ON "PaymentSlip"("lineMessageId");
CREATE INDEX "PaymentSlip_matchedSaleId_idx" ON "PaymentSlip"("matchedSaleId");
CREATE INDEX "PaymentSlip_verificationStatus_createdAt_idx" ON "PaymentSlip"("verificationStatus", "createdAt");
CREATE INDEX "PaymentSlip_reviewedById_idx" ON "PaymentSlip"("reviewedById");

ALTER TABLE "LineConversation"
  ADD CONSTRAINT "LineConversation_assignedAdminId_fkey"
  FOREIGN KEY ("assignedAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LineConversation"
  ADD CONSTRAINT "LineConversation_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LineMessage"
  ADD CONSTRAINT "LineMessage_adminUserId_fkey"
  FOREIGN KEY ("adminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LineMessage"
  ADD CONSTRAINT "LineMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "LineConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineAiJob"
  ADD CONSTRAINT "LineAiJob_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "LineConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineAiJob"
  ADD CONSTRAINT "LineAiJob_lineMessageId_fkey"
  FOREIGN KEY ("lineMessageId") REFERENCES "LineMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LineAiSuggestion"
  ADD CONSTRAINT "LineAiSuggestion_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "LineConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LineAiSuggestion"
  ADD CONSTRAINT "LineAiSuggestion_lineMessageId_fkey"
  FOREIGN KEY ("lineMessageId") REFERENCES "LineMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LineAiAuditLog"
  ADD CONSTRAINT "LineAiAuditLog_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "LineConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentSlip"
  ADD CONSTRAINT "PaymentSlip_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "LineConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentSlip"
  ADD CONSTRAINT "PaymentSlip_matchedSaleId_fkey"
  FOREIGN KEY ("matchedSaleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaymentSlip"
  ADD CONSTRAINT "PaymentSlip_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
