import { Suspense } from "react";
import { Cabecalho } from "@/componentes/shell/Cabecalho";
import { ImportarView } from "@/componentes/importacao/ImportarView";
import { Skeleton } from "@/componentes/ui/skeleton";

async function Conteudo({ params }: { params: PageProps<"/clientes/[clienteId]/importar">["params"] }) {
  const { clienteId } = await params;
  return <ImportarView clienteId={clienteId} />;
}

export default function PaginaImportar({ params }: PageProps<"/clientes/[clienteId]/importar">) {
  return (
    <>
      <Cabecalho titulo="Importar planilha" />
      <div className="p-4 sm:p-6">
        <Suspense fallback={<Skeleton className="h-64 w-full max-w-3xl" />}>
          <Conteudo params={params} />
        </Suspense>
      </div>
    </>
  );
}
