-- AlterTable
ALTER TABLE "alocacoes" ADD COLUMN     "origem" TEXT NOT NULL DEFAULT 'normal';

-- AlterTable
ALTER TABLE "regras" ADD COLUMN     "hora_extra_diaria_max_min" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "permitir_hora_extra" BOOLEAN NOT NULL DEFAULT true;
