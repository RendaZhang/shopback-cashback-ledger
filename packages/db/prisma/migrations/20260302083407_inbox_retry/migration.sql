-- CreateEnum
CREATE TYPE "public"."InboxStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');

-- AlterTable
ALTER TABLE "public"."OutboxEvent" ADD COLUMN     "lastError" TEXT;

-- CreateTable
CREATE TABLE "public"."InboxEvent" (
    "id" UUID NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "public"."InboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "InboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboxEvent_sourceEventId_key" ON "public"."InboxEvent"("sourceEventId");

-- CreateIndex
CREATE INDEX "InboxEvent_status_availableAt_idx" ON "public"."InboxEvent"("status", "availableAt");
