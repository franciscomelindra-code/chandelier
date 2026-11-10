-- S9 : DPIA obligatoirement rattachée à un SIA (table jamais alimentée avant S9), lien notice → document généré.

-- DropForeignKey
ALTER TABLE "dpia" DROP CONSTRAINT "dpia_aiSystemId_fkey";

-- AlterTable
ALTER TABLE "dpia" ALTER COLUMN "aiSystemId" SET NOT NULL;

-- AlterTable
ALTER TABLE "transparency_notice" ADD COLUMN     "documentId" UUID;

-- AddForeignKey
ALTER TABLE "dpia" ADD CONSTRAINT "dpia_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

