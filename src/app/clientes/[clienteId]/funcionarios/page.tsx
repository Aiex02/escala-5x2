import { Suspense } from "react";
import { Cabecalho } from "@/componentes/shell/Cabecalho";
import { FuncionariosView } from "@/componentes/funcionarios/FuncionariosView";
import { Skeleton } from "@/componentes/ui/skeleton";
import { listarFuncionarios } from "@/servicos/funcionarios";

async function Conteudo({ params }: { params: PageProps<"/clientes/[clienteId]/funcionarios">["params"] }) {
  const { clienteId } = await params;
  const funcionarios = await listarFuncionarios(clienteId);
  return <FuncionariosView clienteId={clienteId} funcionarios={funcionarios} />;
}

function Esqueleto() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-9 w-full max-w-xl" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

export default function PaginaFuncionarios({ params }: PageProps<"/clientes/[clienteId]/funcionarios">) {
  return (
    <>
      <Cabecalho titulo="Funcionários" />
      <div className="p-4 sm:p-6">
        <Suspense fallback={<Esqueleto />}>
          <Conteudo params={params} />
        </Suspense>
      </div>
    </>
  );
}
