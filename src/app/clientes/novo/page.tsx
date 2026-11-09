import { Cabecalho } from "@/componentes/shell/Cabecalho";
import { NovoClienteForm } from "@/componentes/clientes/NovoClienteForm";

export default function PaginaNovoCliente() {
  return (
    <main>
      <Cabecalho titulo="Novo cliente" />
      <div className="p-4 sm:p-6">
        <NovoClienteForm />
      </div>
    </main>
  );
}
