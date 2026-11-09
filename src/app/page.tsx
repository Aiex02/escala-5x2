import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";

async function RedirecionarParaCliente(): Promise<never> {
  const primeiro = await prisma.cliente.findFirst({
    orderBy: { criadoEm: "asc" },
    select: { id: true },
  });
  redirect(primeiro ? `/clientes/${primeiro.id}` : "/clientes/novo");
}

export default function Inicio() {
  return (
    <Suspense fallback={null}>
      <RedirecionarParaCliente />
    </Suspense>
  );
}
