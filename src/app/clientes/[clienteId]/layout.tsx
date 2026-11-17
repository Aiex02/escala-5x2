import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Sidebar } from "@/componentes/shell/Sidebar";
import { Skeleton } from "@/componentes/ui/skeleton";
import { prisma } from "@/lib/db";
import { obterUsuario } from "@/lib/supabase/servidor";
import { hojeISO } from "@/lib/datas";

/** Dados dinâmicos (banco, params, sessão e data de hoje) ficam dentro de Suspense por causa do Cache Components. */
async function ShellCliente({
  params,
  children,
}: {
  params: LayoutProps<"/clientes/[clienteId]">["params"];
  children: ReactNode;
}) {
  const { clienteId } = await params;
  // A sessão valida a expiração do token contra a hora atual e a sidebar usa a data de hoje:
  // marca a renderização como de tempo de requisição antes dessas leituras.
  await connection();

  const [usuario, clientes, cliente, meses] = await Promise.all([
    obterUsuario(),
    prisma.cliente.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } }),
    prisma.cliente.findUnique({ where: { id: clienteId }, select: { id: true } }),
    prisma.mesGerado.findMany({
      where: { clienteId },
      select: { ano: true, mes: true },
      orderBy: [{ ano: "desc" }, { mes: "asc" }],
    }),
  ]);
  if (!cliente) notFound();

  const [ano, mes] = hojeISO().split("-").map(Number);

  return (
    <>
      <Sidebar
        clientes={clientes}
        clienteId={clienteId}
        meses={meses}
        hoje={{ ano, mes }}
        usuarioEmail={usuario?.email ?? null}
      />
      <main className="min-h-screen lg:pl-60">{children}</main>
    </>
  );
}

function EsqueletoShell() {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 hidden w-60 border-r border-borda bg-superficie p-4 lg:block">
        <Skeleton className="mb-4 h-7 w-24" />
        <Skeleton className="mb-6 h-12 w-full" />
        <Skeleton className="mb-2 h-8 w-full" />
        <Skeleton className="mb-2 h-8 w-full" />
        <Skeleton className="h-8 w-full" />
      </aside>
      <main className="min-h-screen p-6 lg:pl-66">
        <Skeleton className="h-8 w-48" />
      </main>
    </>
  );
}

export default function LayoutCliente({
  children,
  params,
}: LayoutProps<"/clientes/[clienteId]">) {
  return (
    <Suspense fallback={<EsqueletoShell />}>
      <ShellCliente params={params}>{children}</ShellCliente>
    </Suspense>
  );
}
