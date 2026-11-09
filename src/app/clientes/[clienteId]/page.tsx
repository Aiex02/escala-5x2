import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { hojeISO } from "@/lib/datas";

async function IrParaEscalaDoMes({ params }: { params: PageProps<"/clientes/[clienteId]">["params"] }): Promise<never> {
  const { clienteId } = await params;
  // A data de hoje muda a cada pedido: marca a rota como dinâmica antes de lê-la.
  await connection();
  const [ano, mes] = hojeISO().split("-").map(Number);
  redirect(`/clientes/${clienteId}/escala/${ano}/${mes}`);
}

export default function PaginaCliente({ params }: PageProps<"/clientes/[clienteId]">) {
  return (
    <Suspense fallback={null}>
      <IrParaEscalaDoMes params={params} />
    </Suspense>
  );
}
