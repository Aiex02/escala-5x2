-- CreateTable
CREATE TABLE "dias_fechados" (
    "cliente_id" TEXT NOT NULL,
    "data" DATE NOT NULL,
    "motivo" TEXT,

    CONSTRAINT "dias_fechados_pkey" PRIMARY KEY ("cliente_id","data")
);

-- AddForeignKey
ALTER TABLE "dias_fechados" ADD CONSTRAINT "dias_fechados_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
