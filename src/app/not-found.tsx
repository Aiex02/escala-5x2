import { SearchX } from "lucide-react";
import { EstadoVazio } from "@/componentes/shell/EstadoVazio";

export default function NaoEncontrado() {
  return (
    <main className="mx-auto max-w-xl p-6 pt-24">
      <EstadoVazio
        icone={SearchX}
        titulo="Página não encontrada"
        descricao="O endereço não existe ou o cliente foi removido."
        acao={{ rotulo: "Voltar ao início", href: "/" }}
      />
    </main>
  );
}
