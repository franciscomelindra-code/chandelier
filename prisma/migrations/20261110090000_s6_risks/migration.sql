-- S6 : risques, mesures, actions. Les tables risk / measure / action n'étaient alimentées par aucune route avant S6 :
-- les colonnes NOT NULL sans valeur par défaut sont donc ajoutées sur des tables vides.

-- AlterTable
ALTER TABLE "action" ADD COLUMN     "closureComment" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reference" TEXT NOT NULL,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "aiSystemId" SET NOT NULL;

-- AlterTable
ALTER TABLE "measure" ADD COLUMN     "aiSystemId" UUID NOT NULL,
ADD COLUMN     "dueDate" DATE;

-- AlterTable
ALTER TABLE "risk" ADD COLUMN     "acceptanceJustification" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "acceptedById" UUID,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "risk_measure" DROP COLUMN "isExisting",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE UNIQUE INDEX "action_reference_key" ON "action"("reference");

-- CreateIndex
CREATE INDEX "measure_aiSystemId_idx" ON "measure"("aiSystemId");

-- CreateIndex
CREATE INDEX "risk_ownerId_idx" ON "risk"("ownerId");

-- AddForeignKey
ALTER TABLE "measure" ADD CONSTRAINT "measure_aiSystemId_fkey" FOREIGN KEY ("aiSystemId") REFERENCES "ai_system"("id") ON DELETE CASCADE ON UPDATE CASCADE;

