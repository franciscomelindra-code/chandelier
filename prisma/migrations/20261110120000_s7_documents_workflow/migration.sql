-- S7 : documents rattachés à un SIA ou à un modèle (les tables de liaison, jamais alimentées, sont supprimées),
-- dates de validation et de revue du SIA, idempotence des notifications.

-- DropForeignKey
ALTER TABLE "ai_model_document" DROP CONSTRAINT "ai_model_document_aiModelId_fkey";

-- DropForeignKey
ALTER TABLE "ai_model_document" DROP CONSTRAINT "ai_model_document_documentId_fkey";

-- DropForeignKey
ALTER TABLE "ai_system_document" DROP CONSTRAINT "ai_system_document_aiSystemId_fkey";

-- DropForeignKey
ALTER TABLE "ai_system_document" DROP CONSTRAINT "ai_system_document_documentId_fkey";

-- AlterTable
ALTER TABLE "ai_system" ADD COLUMN     "lastReviewDate" DATE,
ADD COLUMN     "validatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "document" ADD COLUMN     "aiModelId" UUID,
ADD COLUMN     "aiSystemId" UUID;

-- AlterTable
ALTER TABLE "notification" ADD COLUMN     "dedupeKey" TEXT;

-- DropTable
DROP TABLE "ai_model_document";

-- DropTable
DROP TABLE "ai_system_document";

-- CreateIndex
CREATE INDEX "document_aiSystemId_idx" ON "document"("aiSystemId");

-- CreateIndex
CREATE INDEX "document_aiModelId_idx" ON "document"("aiModelId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_dedupeKey_key" ON "notification"("dedupeKey");

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "ai_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

