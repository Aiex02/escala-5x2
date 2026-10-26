import { CalendarDays, CalendarPlus, FileSpreadsheet, Settings, Users, type LucideIcon } from "lucide-react";
import icone from "../assets/icone.png";
import type { Cliente, MesGerado } from "../api/types";
import type { MesRef, Tela } from "../util/tipos";
import { ArvoreMeses } from "./ArvoreMeses";
import { BotaoIcone } from "./base/Botao";
import { ClienteSeletor } from "./ClienteSeletor";

const ITENS_NAVEGACAO: { tela: Tela; rotulo: string; icone: LucideIcon }[] = [
  { tela: "agenda", rotulo: "Agenda", icone: CalendarDays },
  { tela: "funcionarios", rotulo: "Funcionários", icone: Users },
  { tela: "importar", rotulo: "Importar planilha", icone: FileSpreadsheet },
  { tela: "config", rotulo: "Configurações", icone: Settings },
];

interface Props {
  clientes: Cliente[];
  clienteId: number | null;
  onSelecionarCliente: (id: number) => void;
  onNovoCliente: (nome?: string) => void;
  onRenomearCliente: () => void;
  onExcluirCliente: () => void;
  meses: MesGerado[];
  carregandoMeses: boolean;
  erroMeses: string | null;
  mesSelecionado: MesRef | null;
  onSelecionarMes: (ano: number, mes: number) => void;
  onNovoMes: () => void;
  tela: Tela;
  onNavegar: (tela: Tela) => void;
}

export function Sidebar(props: Props) {
  const temCliente = props.clienteId !== null;
  return (
    <aside className="lateral">
      <div className="marca">
        <img src={icone} alt="" width={30} height={30} />
        <span className="marca-nome">Organizador de Escalas</span>
      </div>

      <ClienteSeletor
        clientes={props.clientes}
        clienteId={props.clienteId}
        onSelecionar={props.onSelecionarCliente}
        onNovo={props.onNovoCliente}
        onRenomear={props.onRenomearCliente}
        onExcluir={props.onExcluirCliente}
      />

      {temCliente && (
        <section className="lateral-secao lateral-escalas" aria-labelledby="rotulo-escalas">
          <div className="lateral-secao-cab">
            <h2 id="rotulo-escalas" className="lateral-rotulo">
              Escalas
            </h2>
            <BotaoIcone icone={CalendarPlus} rotulo="Nova escala" onClick={props.onNovoMes} />
          </div>
          <ArvoreMeses
            meses={props.meses}
            carregando={props.carregandoMeses}
            erro={props.erroMeses}
            selecionado={props.mesSelecionado}
            onSelecionar={props.onSelecionarMes}
          />
        </section>
      )}

      <nav className="navegacao" aria-label="Telas">
        {ITENS_NAVEGACAO.map(({ tela, rotulo, icone: Icone }) => {
          const ativo = props.tela === tela;
          return (
            <button
              key={tela}
              type="button"
              className={ativo ? "nav-item ativo" : "nav-item"}
              aria-current={ativo ? "page" : undefined}
              disabled={!temCliente}
              onClick={() => props.onNavegar(tela)}
            >
              <Icone size={17} strokeWidth={1.9} aria-hidden="true" />
              {rotulo}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
