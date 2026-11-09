-- CreateEnum
CREATE TYPE "InicioSemana" AS ENUM ('SEGUNDA', 'DOMINGO');

-- CreateEnum
CREATE TYPE "RegimeLegal" AS ENUM ('LIVRE', 'EC141');

-- CreateEnum
CREATE TYPE "Periodo" AS ENUM ('MANHA', 'TARDE', 'NOITE');

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regras" (
    "cliente_id" TEXT NOT NULL,
    "carga_semanal_max_min" INTEGER NOT NULL,
    "jornada_diaria_max_min" INTEGER NOT NULL,
    "descanso_entre_jornadas_min" INTEGER NOT NULL,
    "max_dias_consecutivos" INTEGER NOT NULL,
    "inicio_semana" "InicioSemana" NOT NULL,
    "folgas_semanais_min" INTEGER NOT NULL,
    "domingos_seguidos_max" INTEGER NOT NULL,
    "regime" "RegimeLegal" NOT NULL,
    "ec141_publicacao" DATE,
    "jornada_padrao_min" INTEGER NOT NULL,
    "intervalo_padrao_min" INTEGER NOT NULL,
    "modelo" TEXT,

    CONSTRAINT "regras_pkey" PRIMARY KEY ("cliente_id")
);

-- CreateTable
CREATE TABLE "janelas_funcionamento" (
    "cliente_id" TEXT NOT NULL,
    "dia" INTEGER NOT NULL,
    "abre_min" INTEGER NOT NULL,
    "fecha_min" INTEGER NOT NULL,

    CONSTRAINT "janelas_funcionamento_pkey" PRIMARY KEY ("cliente_id","dia")
);

-- CreateTable
CREATE TABLE "turnos" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "inicio_min" INTEGER NOT NULL,
    "fim_min" INTEGER NOT NULL,
    "intervalo_min" INTEGER NOT NULL,
    "efetivo_minimo" INTEGER NOT NULL,
    "ordem" INTEGER NOT NULL,
    "cor" TEXT NOT NULL,
    "dias_semana" INTEGER NOT NULL,
    "arquivado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funcionarios" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "matricula" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "cargo" TEXT,
    "secao" TEXT,
    "ctps" TEXT,
    "carga_semanal_min" INTEGER,
    "preferencia" "Periodo",
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "isento_ec141" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "funcionarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ausencias" (
    "id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "fim" DATE NOT NULL,
    "motivo" TEXT,
    "justificada" BOOLEAN NOT NULL,

    CONSTRAINT "ausencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meses_gerados" (
    "cliente_id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "gerado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meses_gerados_pkey" PRIMARY KEY ("cliente_id","ano","mes")
);

-- CreateTable
CREATE TABLE "avisos_mes" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "ano" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "data" DATE,
    "turno_id" TEXT,
    "funcionario_id" TEXT,
    "mensagem" TEXT NOT NULL,

    CONSTRAINT "avisos_mes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alocacoes" (
    "id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "turno_id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "inicio_min" INTEGER NOT NULL,
    "fim_min" INTEGER NOT NULL,
    "intervalo_min" INTEGER NOT NULL,
    "minutos_trabalhados" INTEGER NOT NULL,

    CONSTRAINT "alocacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "previstos_semana" (
    "cliente_id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "inicio" DATE NOT NULL,
    "previsto_min" INTEGER NOT NULL,

    CONSTRAINT "previstos_semana_pkey" PRIMARY KEY ("funcionario_id","inicio")
);

-- CreateTable
CREATE TABLE "funcoes_minimas" (
    "cliente_id" TEXT NOT NULL,
    "funcao" TEXT NOT NULL,
    "minimo" INTEGER NOT NULL,

    CONSTRAINT "funcoes_minimas_pkey" PRIMARY KEY ("cliente_id","funcao")
);

-- CreateTable
CREATE TABLE "ajustes_manuais" (
    "cliente_id" TEXT NOT NULL,
    "funcionario_id" TEXT NOT NULL,
    "data" DATE NOT NULL,

    CONSTRAINT "ajustes_manuais_pkey" PRIMARY KEY ("funcionario_id","data")
);

-- CreateIndex
CREATE UNIQUE INDEX "clientes_nome_key" ON "clientes"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "turnos_cliente_id_nome_key" ON "turnos"("cliente_id", "nome");

-- CreateIndex
CREATE UNIQUE INDEX "funcionarios_cliente_id_matricula_key" ON "funcionarios"("cliente_id", "matricula");

-- CreateIndex
CREATE INDEX "ausencias_funcionario_id_idx" ON "ausencias"("funcionario_id");

-- CreateIndex
CREATE INDEX "avisos_mes_cliente_id_ano_mes_idx" ON "avisos_mes"("cliente_id", "ano", "mes");

-- CreateIndex
CREATE INDEX "alocacoes_cliente_id_data_idx" ON "alocacoes"("cliente_id", "data");

-- CreateIndex
CREATE UNIQUE INDEX "alocacoes_funcionario_id_data_key" ON "alocacoes"("funcionario_id", "data");

-- CreateIndex
CREATE INDEX "previstos_semana_cliente_id_inicio_idx" ON "previstos_semana"("cliente_id", "inicio");

-- CreateIndex
CREATE INDEX "ajustes_manuais_cliente_id_data_idx" ON "ajustes_manuais"("cliente_id", "data");

-- AddForeignKey
ALTER TABLE "regras" ADD CONSTRAINT "regras_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "janelas_funcionamento" ADD CONSTRAINT "janelas_funcionamento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcionarios" ADD CONSTRAINT "funcionarios_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ausencias" ADD CONSTRAINT "ausencias_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meses_gerados" ADD CONSTRAINT "meses_gerados_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos_mes" ADD CONSTRAINT "avisos_mes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos_mes" ADD CONSTRAINT "avisos_mes_cliente_id_ano_mes_fkey" FOREIGN KEY ("cliente_id", "ano", "mes") REFERENCES "meses_gerados"("cliente_id", "ano", "mes") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_funcionario_id_fkey" FOREIGN KEY ("funcionario_id") REFERENCES "funcionarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alocacoes" ADD CONSTRAINT "alocacoes_turno_id_fkey" FOREIGN KEY ("turno_id") REFERENCES "turnos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "previstos_semana" ADD CONSTRAINT "previstos_semana_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "funcoes_minimas" ADD CONSTRAINT "funcoes_minimas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ajustes_manuais" ADD CONSTRAINT "ajustes_manuais_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
