import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Cliente } from "../api/types";
import { Botao } from "./base/Botao";
import { Combobox } from "./base/Combobox";
import { MenuAcoes } from "./base/Menu";

interface Props {
  clientes: Cliente[];
  clienteId: number | null;
  onSelecionar: (id: number) => void;
  /** Abre o diálogo de novo cliente, já com o nome digitado na busca (se houver). */
  onNovo: (nome?: string) => void;
  onRenomear: () => void;
  onExcluir: () => void;
}

export function ClienteSeletor({ clientes, clienteId, onSelecionar, onNovo, onRenomear, onExcluir }: Props) {
  if (clientes.length === 0) {
    return (
      <section className="lateral-secao" aria-label="Cliente">
        <p className="lateral-nota">Nenhum cliente cadastrado ainda.</p>
        <Botao variante="primario" icone={Plus} bloco onClick={() => onNovo()}>
          Novo cliente
        </Botao>
      </section>
    );
  }

  return (
    <section className="lateral-secao" aria-labelledby="rotulo-cliente">
      <div className="lateral-secao-cab">
        <label id="rotulo-cliente" htmlFor="busca-cliente" className="lateral-rotulo">
          Cliente
        </label>
        <MenuAcoes
          rotulo="Ações do cliente"
          itens={[
            { rotulo: "Novo cliente", icone: Plus, aoEscolher: () => onNovo() },
            ...(clienteId !== null
              ? [
                  { rotulo: "Renomear", icone: Pencil, aoEscolher: onRenomear },
                  { rotulo: "Excluir cliente", icone: Trash2, aoEscolher: onExcluir, perigo: true },
                ]
              : []),
          ]}
        />
      </div>
      <Combobox
        id="busca-cliente"
        itens={clientes.map((c) => ({ id: c.id, rotulo: c.nome }))}
        selecionadoId={clienteId}
        onSelecionar={onSelecionar}
        onCriar={(texto) => onNovo(texto)}
        rotuloCriar={(texto) => `Criar cliente “${texto}”`}
        placeholder="Buscar cliente"
        vazio="Nenhum cliente com esse nome."
      />
    </section>
  );
}
