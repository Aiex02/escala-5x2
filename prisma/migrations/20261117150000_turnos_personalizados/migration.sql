-- AlterTable
ALTER TABLE "turnos" ADD COLUMN     "personalizado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "origem_horario" TEXT;
