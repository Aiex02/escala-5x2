import { Suspense } from "react";
import { Cabecalho } from "@/componentes/shell/Cabecalho";
import { ConfiguracoesView } from "@/componentes/configuracoes/ConfiguracoesView";
import { Skeleton } from "@/componentes/ui/skeleton";
import { obterConfiguracao } from "@/servicos/configuracao";

const ABAS = ["funcionamento", "turnos", "regime", "funcoes", "horaExtra", "perigo"];

async function Conteudo({
  params,
  searchParams,
}: {
  params: PageProps<"/clientes/[clienteId]/configuracoes">["params"];
  searchParams: PageProps<"/clientes/[clienteId]/configuracoes">["searchParams"];
}) {
  const [{ clienteId }, { aba }] = await Promise.all([params, searchParams]);
  const config = await obterConfiguracao(clienteId);
  const abaInicial = typeof aba === "string" && ABAS.includes(aba) ? aba : "funcionamento";
  return <ConfiguracoesView config={config} abaInicial={abaInicial} />;
}

function Esqueleto() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-96 max-w-full" />
      <Skeleton className="h-10 w-80 max-w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function PaginaConfiguracoes({ params, searchParams }: PageProps<"/clientes/[clienteId]/configuracoes">) {
  return (
    <>
      <Cabecalho titulo="Configurações" />
      <div className="p-4 sm:p-6">
        <Suspense fallback={<Esqueleto />}>
          <Conteudo params={params} searchParams={searchParams} />
        </Suspense>
      </div>
    </>
  );
}
