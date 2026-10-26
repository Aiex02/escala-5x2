import { useMemo, useRef, useState, type CSSProperties } from "react";
import { CalendarDays, CalendarPlus, CalendarRange, ChevronLeft, ChevronRight, Download, RefreshCcwDot, RefreshCw, Scale, Table2, Trash2, TriangleAlert } from "lucide-react";
import { api, emTauri, mensagemErro } from "../../api/client";
import type { AgendaMes, MesGerado, ResultadoReequilibrio } from "../../api/types";
import { gravarArmazenado, lerArmazenado } from "../../util/armazenamento";
import { dataNoMes, dataParaDias, formatarDiaMes, formatarGeradoEm, hojeISO, montarData, nomeMes, separarData, tituloMes } from "../../util/datas";
import { pluralizar } from "../../util/formato";
import { useCarregar } from "../../util/useCarregar";
import { Botao, BotaoIcone } from "../base/Botao";
import { Busca } from "../base/Campo";
import { Segmentado } from "../base/Escolhas";
import { Interruptor } from "../base/Marcacao";
import { ConfirmModal } from "../Modal";
import { ReequilibrarModal } from "../ReequilibrarModal";
import { useNotificar } from "../Toast";
import { CabecalhoTela, Carregando, EstadoVazio, ErroCarregamento } from "../ui";
import { DiaModal } from "./DiaModal";
import { GradeMensal } from "./GradeMensal";
import { GradeQuadro } from "./GradeQuadro";
import { GradeSemanal } from "./GradeSemanal";
import { criarFiltroBusca, indexarAgenda } from "./indice";
import { ListaAvisos } from "./ListaAvisos";
import { ResumoSemanal } from "./ResumoSemanal";

type Visao = "quadro" | "mes" | "semana";

// `.v2`: o Quadro virou a visão principal; quem tinha outra visão salva começa nele uma vez.
const CHAVE_VISAO = "organizador-escalas.visaoAgenda.v2";
const CHAVE_COMPACTO = "organizador-escalas.agendaCompacta";

interface Props {
  clienteId: number;
  ano: number;
  mes: number;
  /** Muda sempre que a escala é gerada de novo, forçando nova leitura. */
  versao: number;
  onGerar: (ano: number, mes: number) => Promise<void>;
  onExcluirMes: (ano: number, mes: number) => Promise<void>;
  /** Meses já gerados do cliente (para oferecer refazer os seguintes ao reequilibrar). */
  meses: MesGerado[];
  /** Reequilibra o mês a partir da data e atualiza a lista de meses; lança em caso de erro. */
  onReequilibrar: (ano: number, mes: number, aPartir: string, seguintes: boolean) => Promise<ResultadoReequilibrio>;
}

function lerVisaoSalva(): Visao {
  const salva = lerArmazenado(CHAVE_VISAO);
  return salva === "mes" || salva === "semana" ? salva : "quadro";
}

/** "9 a 15 de março" ou "30 de março a 5 de abril". */
function rotuloSemana(inicio: string, fim: string): string {
  const a = separarData(inicio);
  const b = separarData(fim);
  if (a.mes === b.mes) return `${a.dia} a ${b.dia} de ${nomeMes(b.mes).toLowerCase()}`;
  return `${a.dia} de ${nomeMes(a.mes).toLowerCase()} a ${b.dia} de ${nomeMes(b.mes).toLowerCase()}`;
}

export function Agenda({ clienteId, ano, mes, versao, onGerar, onExcluirMes, meses, onReequilibrar }: Props) {
  const notificar = useNotificar();
  const { dados: agenda, carregando, erro, recarregar, definirDados } = useCarregar(() => api.obterAgenda(clienteId, ano, mes), [clienteId, ano, mes, versao]);

  const [visao, setVisao] = useState<Visao>(lerVisaoSalva);
  const [compacto, setCompacto] = useState(() => lerArmazenado(CHAVE_COMPACTO) === "1");
  const [turnosOcultos, setTurnosOcultos] = useState<Set<number>>(new Set());
  const [busca, setBusca] = useState("");
  const [diaAberto, setDiaAberto] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<"gerar" | "excluir" | "reequilibrar" | null>(null);
  const [gerando, setGerando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [semanaEscolhida, setSemanaEscolhida] = useState<number | null>(null);
  const secaoAvisos = useRef<HTMLElement>(null);

  const indice = useMemo(() => (agenda ? indexarAgenda(agenda) : null), [agenda]);
  const hoje = hojeISO();

  if (!agenda || !indice) {
    if (erro) return <ErroCarregamento mensagem={erro} onTentarNovamente={recarregar} />;
    return <Carregando texto={`Abrindo ${tituloMes(ano, mes)}…`} />;
  }

  const titulo = tituloMes(ano, mes);

  async function gerarEsteMes() {
    setGerando(true);
    try {
      await onGerar(ano, mes);
    } catch (e) {
      notificar.erro(mensagemErro(e));
    } finally {
      setGerando(false);
    }
  }

  if (agenda.geradoEm === null) {
    return (
      <EstadoVazio
        icone={CalendarDays}
        titulo={`${titulo} ainda não tem escala`}
        acao={
          <Botao variante="primario" icone={CalendarPlus} carregando={gerando} onClick={() => void gerarEsteMes()}>
            Gerar escala
          </Botao>
        }
      >
        A escala é montada a partir dos turnos, regras e funcionários deste cliente.
      </EstadoVazio>
    );
  }

  const turnosVisiveis = new Set(agenda.turnos.filter((t) => !turnosOcultos.has(t.id)).map((t) => t.id));
  const filtro = criarFiltroBusca(indice, busca);

  // Semana exibida: a escolhida, ou a de hoje, ou a primeira com a maior parte dos dias no mês.
  const primeiroDoMes = montarData(ano, mes, 1);
  const indiceHoje = agenda.semanas.findIndex((s) => s.inicio <= hoje && hoje <= s.fim && dataNoMes(hoje, ano, mes));
  const indicePrimeira = Math.max(
    0,
    agenda.semanas.findIndex((s) => dataParaDias(s.fim) - dataParaDias(s.inicio < primeiroDoMes ? primeiroDoMes : s.inicio) + 1 >= 4),
  );
  const semanaAtual = Math.min(semanaEscolhida ?? (indiceHoje >= 0 ? indiceHoje : indicePrimeira), Math.max(agenda.semanas.length - 1, 0));
  const semana = agenda.semanas[semanaAtual];
  const inicioSemana = semana?.inicio ?? montarData(ano, mes, 1);

  async function exportar() {
    setExportando(true);
    try {
      const sugestao = `escala_${String(mes).padStart(2, "0")}_${ano}.xlsx`;
      let destino: string | null = sugestao;
      if (emTauri) {
        const { save } = await import("@tauri-apps/plugin-dialog");
        destino = await save({ defaultPath: sugestao, filters: [{ name: "Planilha do Excel", extensions: ["xlsx"] }] });
      }
      if (!destino) return;
      await api.exportarEscala(clienteId, ano, mes, destino);
      notificar.sucesso(`Escala exportada para ${destino}.`);
    } catch (e) {
      notificar.erro(mensagemErro(e));
    } finally {
      setExportando(false);
    }
  }

  /** O quadro devolve o mês recalculado a cada ajuste: ele substitui a agenda (resumo e avisos incluídos). */
  function agendaAlterada(nova: AgendaMes) {
    definirDados(() => nova);
  }

  /** Reequilibra o mês: a agenda devolvida substitui a atual e os meses seguintes refeitos são lidos de novo ao abri-los. */
  async function reequilibrarEsteMes(aPartir: string, seguintes: boolean) {
    const resultado = await onReequilibrar(ano, mes, aPartir, seguintes);
    agendaAlterada(resultado.agenda);
    const refeitos = resultado.meses.filter((m) => !(m.ano === ano && m.mes === mes)).length;
    notificar.sucesso(`Mês reequilibrado a partir de ${formatarDiaMes(aPartir)}${refeitos > 0 ? `; ${pluralizar(refeitos, "mês seguinte refeito", "meses seguintes refeitos")}` : ""}.`);
  }

  function mudarVisao(v: Visao) {
    setVisao(v);
    gravarArmazenado(CHAVE_VISAO, v);
  }

  function alternarTurno(id: number) {
    setTurnosOcultos((atual) => {
      const novo = new Set(atual);
      if (!novo.delete(id)) novo.add(id);
      return novo;
    });
  }

  return (
    <div className={carregando ? "tela tela-agenda recarregando" : "tela tela-agenda"}>
      <CabecalhoTela
        titulo={titulo}
        acoes={
          <>
            <Segmentado<Visao>
              rotulo="Visualização"
              valor={visao}
              onMudar={mudarVisao}
              opcoes={[
                { valor: "quadro", rotulo: "Quadro", icone: Table2 },
                { valor: "mes", rotulo: "Mês", icone: CalendarDays },
                { valor: "semana", rotulo: "Semana", icone: CalendarRange },
              ]}
            />
            <Botao icone={Download} carregando={exportando} onClick={() => void exportar()}>
              Exportar Excel
            </Botao>
            <Botao icone={RefreshCcwDot} onClick={() => setConfirmando("reequilibrar")} data-dica="Refaz o resto do mês compensando as horas e mantendo o que você ajustou à mão">
              Reequilibrar
            </Botao>
            <Botao icone={RefreshCw} onClick={() => setConfirmando("gerar")}>
              Gerar de novo
            </Botao>
            <Botao variante="perigo-contorno" icone={Trash2} onClick={() => setConfirmando("excluir")}>
              Excluir
            </Botao>
          </>
        }
      >
        <span>Gerada em {formatarGeradoEm(agenda.geradoEm)}</span>
        <span>{pluralizar(agenda.alocacoes.length, "plantão", "plantões")}</span>
        {agenda.regra && (
          <span className="regra-mes">
            <Scale size={14} strokeWidth={2} aria-hidden="true" />
            {agenda.regra}
          </span>
        )}
        {agenda.avisos.length > 0 && (
          <button type="button" className="link-aviso" onClick={() => secaoAvisos.current?.scrollIntoView({ behavior: "smooth" })}>
            <TriangleAlert size={14} strokeWidth={2} aria-hidden="true" />
            {pluralizar(agenda.avisos.length, "aviso", "avisos")}
          </button>
        )}
      </CabecalhoTela>

      <div className="barra-ferramentas" role="group" aria-label="Filtros da agenda">
        <div className="filtro-turnos" role="group" aria-label="Turnos exibidos">
          {indice.turnosOrdenados.map((t) => (
            <button
              key={t.id}
              type="button"
              className="chip-turno"
              aria-pressed={turnosVisiveis.has(t.id)}
              style={{ "--cor-turno": t.cor } as CSSProperties}
              data-dica={turnosVisiveis.has(t.id) ? `Ocultar ${t.nome}` : `Mostrar ${t.nome}`}
              onClick={() => alternarTurno(t.id)}
            >
              <span className="ponto-cor" aria-hidden="true" />
              {t.nome}
            </button>
          ))}
        </div>

        {visao === "semana" && semana && (
          <div className="navegador-semana">
            <BotaoIcone icone={ChevronLeft} rotulo="Semana anterior" variante="secundario" disabled={semanaAtual === 0} onClick={() => setSemanaEscolhida(semanaAtual - 1)} />
            <span className="navegador-rotulo" aria-live="polite">
              {rotuloSemana(semana.inicio, semana.fim)}
            </span>
            <BotaoIcone
              icone={ChevronRight}
              rotulo="Próxima semana"
              variante="secundario"
              disabled={semanaAtual >= agenda.semanas.length - 1}
              onClick={() => setSemanaEscolhida(semanaAtual + 1)}
            />
          </div>
        )}

        <div className="barra-direita">
          <Busca id="busca-agenda" rotulo="Buscar funcionário" placeholder="Buscar funcionário" valor={busca} onMudar={setBusca} className="busca-agenda" />
          {visao === "mes" && (
            <Interruptor
              ligado={compacto}
              rotuloAria="Modo compacto"
              onMudar={(v) => {
                setCompacto(v);
                gravarArmazenado(CHAVE_COMPACTO, v ? "1" : "0");
              }}
            >
              Compacto
            </Interruptor>
          )}
        </div>
      </div>

      {visao === "quadro" ? (
        <GradeQuadro clienteId={clienteId} agenda={agenda} indice={indice} turnosVisiveis={turnosVisiveis} filtro={filtro} hoje={hoje} onAlterada={agendaAlterada} />
      ) : visao === "mes" ? (
        <GradeMensal agenda={agenda} indice={indice} turnosVisiveis={turnosVisiveis} filtro={filtro} compacto={compacto} hoje={hoje} onAbrirDia={setDiaAberto} />
      ) : (
        <GradeSemanal agenda={agenda} indice={indice} inicio={inicioSemana} turnosVisiveis={turnosVisiveis} filtro={filtro} hoje={hoje} onAbrirDia={setDiaAberto} />
      )}

      <ResumoSemanal agenda={agenda} destaque={visao === "semana" ? semana?.inicio : undefined} />
      <ListaAvisos ref={secaoAvisos} avisos={agenda.avisos} />

      {diaAberto && <DiaModal data={diaAberto} agenda={agenda} indice={indice} onFechar={() => setDiaAberto(null)} />}

      {confirmando === "gerar" && (
        <ConfirmModal titulo="Gerar a escala de novo" rotuloConfirmar="Gerar de novo" onConfirmar={() => onGerar(ano, mes)} onFechar={() => setConfirmando(null)}>
          <p>
            A escala de <strong>{titulo}</strong> será substituída por uma nova, calculada com os turnos, regras e funcionários de hoje.
          </p>
          {agenda.ajustes.length > 0 && (
            <p>
              Os ajustes feitos à mão no Quadro ({pluralizar(agenda.ajustes.length, "dia", "dias")}) serão descartados. Para mantê-los, use <strong>Reequilibrar</strong>.
            </p>
          )}
        </ConfirmModal>
      )}
      {confirmando === "reequilibrar" && (
        <ReequilibrarModal agenda={agenda} meses={meses} hoje={hoje} onReequilibrar={reequilibrarEsteMes} onFechar={() => setConfirmando(null)} />
      )}
      {confirmando === "excluir" && (
        <ConfirmModal
          titulo="Excluir escala"
          rotuloConfirmar="Excluir escala"
          perigo
          onConfirmar={() => onExcluirMes(ano, mes)}
          onFechar={() => setConfirmando(null)}
        >
          <p>
            Todos os plantões de <strong>{titulo}</strong> serão apagados. Você pode gerar o mês de novo depois.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
