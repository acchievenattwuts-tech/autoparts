-- Additive WHT (ภาษีหัก ณ ที่จ่าย) schema only.
-- จงใจไม่ใช้ `prisma db push` เพราะ diff จะ drop `product_search_documents.trgm_text`
-- (generated column ของ setup-search-v2.ts) พร้อม index ค้นหาอีก 5 ตัว — ดู PLAN.md:975
BEGIN;
SET LOCAL lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "WhtFormType" AS ENUM ('PND1', 'PND1A', 'PND2', 'PND3', 'PND3A', 'PND53', 'PND54');

-- CreateEnum
CREATE TYPE "WhtPayeeType" AS ENUM ('INDIVIDUAL', 'JURISTIC');

-- CreateEnum
CREATE TYPE "WhtPayCondition" AS ENUM ('WITHHELD', 'PAID_ALWAYS', 'PAID_ONCE');

-- CreateEnum
CREATE TYPE "WhtFilingSubmissionType" AS ENUM ('NORMAL', 'ADDITIONAL');

-- CreateEnum
CREATE TYPE "WhtFilingStatus" AS ENUM ('DRAFT', 'FILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhtFilingChannel" AS ENUM ('PAPER', 'RD_PREP', 'SWC', 'EFILING');

-- CreateEnum
CREATE TYPE "WhtCreditForm" AS ENUM ('PND94', 'PND90');

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN     "whtAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "whtAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "WhtIncomeType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "formTypes" "WhtFormType"[],
    "defaultRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "legalRef" TEXT,
    "usableForReceived" BOOLEAN NOT NULL DEFAULT false,
    "usableForIssued" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhtIncomeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhtReceived" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT,
    "saleId" TEXT,
    "customerId" TEXT,
    "customerNameSnapshot" TEXT NOT NULL,
    "customerTaxIdSnapshot" TEXT,
    "incomeTypeId" TEXT NOT NULL,
    "incomeLabelSnapshot" TEXT NOT NULL,
    "baseAmount" DECIMAL(10,2) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "payDate" TIMESTAMPTZ(3) NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "taxHalf" INTEGER NOT NULL,
    "certNo" TEXT,
    "certDate" TIMESTAMPTZ(3),
    "certReceivedAt" TIMESTAMPTZ(3),
    "creditedFormType" "WhtCreditForm",
    "creditedAt" TIMESTAMPTZ(3),
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhtReceived_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhtReceivedAttachment" (
    "id" TEXT NOT NULL,
    "whtReceivedId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhtReceivedAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhtPayeeProfile" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "payeeType" "WhtPayeeType" NOT NULL DEFAULT 'JURISTIC',
    "taxId13" TEXT NOT NULL,
    "taxId10" TEXT,
    "titleName" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "branchNo" TEXT NOT NULL DEFAULT '000000',
    "addrNo" TEXT,
    "addrRoad" TEXT,
    "addrSubdistrict" TEXT,
    "addrDistrict" TEXT,
    "addrProvince" TEXT,
    "addrPostcode" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhtPayeeProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhtCertificate" (
    "id" TEXT NOT NULL,
    "certNo" TEXT NOT NULL,
    "certDate" TIMESTAMPTZ(3) NOT NULL,
    "payDate" TIMESTAMPTZ(3) NOT NULL,
    "formType" "WhtFormType" NOT NULL,
    "supplierId" TEXT NOT NULL,
    "payeeType" "WhtPayeeType" NOT NULL,
    "payeeName" TEXT NOT NULL,
    "payeeTaxId13" TEXT NOT NULL,
    "payeeTaxId10" TEXT,
    "payeeTitleName" TEXT,
    "payeeFirstName" TEXT NOT NULL,
    "payeeLastName" TEXT,
    "payeeBranchNo" TEXT NOT NULL DEFAULT '000000',
    "payeeAddrNo" TEXT,
    "payeeAddrRoad" TEXT,
    "payeeAddrSubdistrict" TEXT,
    "payeeAddrDistrict" TEXT,
    "payeeAddrProvince" TEXT,
    "payeeAddrPostcode" TEXT,
    "expenseId" TEXT,
    "activeExpenseId" TEXT,
    "supplierPaymentId" TEXT,
    "activeSupplierPaymentId" TEXT,
    "totalBaseAmount" DECIMAL(10,2) NOT NULL,
    "totalTaxAmount" DECIMAL(10,2) NOT NULL,
    "taxMonth" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "filingId" TEXT,
    "status" "DocStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelNote" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhtCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhtCertificateLine" (
    "id" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "incomeTypeId" TEXT NOT NULL,
    "incomeLabelSnapshot" TEXT NOT NULL,
    "payDate" TIMESTAMPTZ(3) NOT NULL,
    "baseAmount" DECIMAL(10,2) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "taxAmount" DECIMAL(10,2) NOT NULL,
    "payCondition" "WhtPayCondition" NOT NULL DEFAULT 'WITHHELD',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhtCertificateLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhtFiling" (
    "id" TEXT NOT NULL,
    "filingNo" TEXT NOT NULL,
    "formType" "WhtFormType" NOT NULL,
    "taxMonth" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "submissionType" "WhtFilingSubmissionType" NOT NULL DEFAULT 'NORMAL',
    "additionalSeq" INTEGER NOT NULL DEFAULT 0,
    "totalRecords" INTEGER NOT NULL DEFAULT 0,
    "totalBaseAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "totalTaxAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "surchargeAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "grandTotalAmount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "filedAt" TIMESTAMPTZ(3),
    "filedChannel" "WhtFilingChannel",
    "rdRefNo" TEXT,
    "status" "WhtFilingStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WhtFiling_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WhtIncomeType_code_key" ON "WhtIncomeType"("code");

-- CreateIndex
CREATE INDEX "WhtIncomeType_isActive_sortOrder_idx" ON "WhtIncomeType"("isActive", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WhtReceived_receiptId_key" ON "WhtReceived"("receiptId");

-- CreateIndex
CREATE UNIQUE INDEX "WhtReceived_saleId_key" ON "WhtReceived"("saleId");

-- CreateIndex
CREATE INDEX "WhtReceived_taxYear_taxHalf_status_idx" ON "WhtReceived"("taxYear", "taxHalf", "status");

-- CreateIndex
CREATE INDEX "WhtReceived_customerId_taxYear_status_idx" ON "WhtReceived"("customerId", "taxYear", "status");

-- CreateIndex
CREATE INDEX "WhtReceived_payDate_status_idx" ON "WhtReceived"("payDate" DESC, "status");

-- CreateIndex
CREATE INDEX "WhtReceived_status_certReceivedAt_idx" ON "WhtReceived"("status", "certReceivedAt");

-- CreateIndex
CREATE INDEX "WhtReceived_incomeTypeId_idx" ON "WhtReceived"("incomeTypeId");

-- CreateIndex
CREATE INDEX "WhtReceived_userId_idx" ON "WhtReceived"("userId");

-- CreateIndex
CREATE INDEX "WhtReceivedAttachment_whtReceivedId_createdAt_idx" ON "WhtReceivedAttachment"("whtReceivedId", "createdAt");

-- CreateIndex
CREATE INDEX "WhtReceivedAttachment_uploadedById_idx" ON "WhtReceivedAttachment"("uploadedById");

-- CreateIndex
CREATE UNIQUE INDEX "WhtPayeeProfile_supplierId_key" ON "WhtPayeeProfile"("supplierId");

-- CreateIndex
CREATE INDEX "WhtPayeeProfile_payeeType_isActive_idx" ON "WhtPayeeProfile"("payeeType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WhtCertificate_certNo_key" ON "WhtCertificate"("certNo");

-- CreateIndex
CREATE UNIQUE INDEX "WhtCertificate_activeExpenseId_key" ON "WhtCertificate"("activeExpenseId");

-- CreateIndex
CREATE UNIQUE INDEX "WhtCertificate_activeSupplierPaymentId_key" ON "WhtCertificate"("activeSupplierPaymentId");

-- CreateIndex
CREATE INDEX "WhtCertificate_taxYear_taxMonth_formType_status_idx" ON "WhtCertificate"("taxYear", "taxMonth", "formType", "status");

-- CreateIndex
CREATE INDEX "WhtCertificate_supplierId_status_idx" ON "WhtCertificate"("supplierId", "status");

-- CreateIndex
CREATE INDEX "WhtCertificate_certDate_status_idx" ON "WhtCertificate"("certDate" DESC, "status");

-- CreateIndex
CREATE INDEX "WhtCertificate_filingId_idx" ON "WhtCertificate"("filingId");

-- CreateIndex
CREATE INDEX "WhtCertificate_expenseId_idx" ON "WhtCertificate"("expenseId");

-- CreateIndex
CREATE INDEX "WhtCertificate_supplierPaymentId_idx" ON "WhtCertificate"("supplierPaymentId");

-- CreateIndex
CREATE INDEX "WhtCertificate_userId_idx" ON "WhtCertificate"("userId");

-- CreateIndex
CREATE INDEX "WhtCertificateLine_incomeTypeId_idx" ON "WhtCertificateLine"("incomeTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "WhtCertificateLine_certificateId_lineNo_key" ON "WhtCertificateLine"("certificateId", "lineNo");

-- CreateIndex
CREATE UNIQUE INDEX "WhtFiling_filingNo_key" ON "WhtFiling"("filingNo");

-- CreateIndex
CREATE INDEX "WhtFiling_taxYear_taxMonth_formType_idx" ON "WhtFiling"("taxYear", "taxMonth", "formType");

-- CreateIndex
CREATE INDEX "WhtFiling_status_filedAt_idx" ON "WhtFiling"("status", "filedAt");

-- CreateIndex
CREATE INDEX "WhtFiling_userId_idx" ON "WhtFiling"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhtFiling_formType_taxYear_taxMonth_submissionType_addition_key" ON "WhtFiling"("formType", "taxYear", "taxMonth", "submissionType", "additionalSeq");

-- AddForeignKey
ALTER TABLE "WhtReceived" ADD CONSTRAINT "WhtReceived_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtReceived" ADD CONSTRAINT "WhtReceived_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtReceived" ADD CONSTRAINT "WhtReceived_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtReceived" ADD CONSTRAINT "WhtReceived_incomeTypeId_fkey" FOREIGN KEY ("incomeTypeId") REFERENCES "WhtIncomeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtReceived" ADD CONSTRAINT "WhtReceived_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtReceivedAttachment" ADD CONSTRAINT "WhtReceivedAttachment_whtReceivedId_fkey" FOREIGN KEY ("whtReceivedId") REFERENCES "WhtReceived"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtReceivedAttachment" ADD CONSTRAINT "WhtReceivedAttachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtPayeeProfile" ADD CONSTRAINT "WhtPayeeProfile_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtCertificate" ADD CONSTRAINT "WhtCertificate_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtCertificate" ADD CONSTRAINT "WhtCertificate_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtCertificate" ADD CONSTRAINT "WhtCertificate_activeExpenseId_fkey" FOREIGN KEY ("activeExpenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtCertificate" ADD CONSTRAINT "WhtCertificate_supplierPaymentId_fkey" FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtCertificate" ADD CONSTRAINT "WhtCertificate_activeSupplierPaymentId_fkey" FOREIGN KEY ("activeSupplierPaymentId") REFERENCES "SupplierPayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtCertificate" ADD CONSTRAINT "WhtCertificate_filingId_fkey" FOREIGN KEY ("filingId") REFERENCES "WhtFiling"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtCertificate" ADD CONSTRAINT "WhtCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtCertificateLine" ADD CONSTRAINT "WhtCertificateLine_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "WhtCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtCertificateLine" ADD CONSTRAINT "WhtCertificateLine_incomeTypeId_fkey" FOREIGN KEY ("incomeTypeId") REFERENCES "WhtIncomeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhtFiling" ADD CONSTRAINT "WhtFiling_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
