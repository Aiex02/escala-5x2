import "./quadro.css";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type FormEvent, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";
import { api, mensagemErro } from "../../api/client";
import type { AgendaMes, Alocacao, AusenciaAgenda, DiaQuadro, FuncionarioResumo, Periodo, Turno } from "../../api/types";
import { dataNoMes, DIAS_SEMANA_LONGO, diaDaSemana, diasNoMes, formatarDiaMes, indiceInicioSemana, LETRAS_DIAS, montarData, separarData, tituloMes } from "../../util/datas";
import { agruparPorFuncao } from "../../util/funcoes";
import { formatarMinutos, pluralizar } from "../../util/formato";
import { Botao } from "../base/Botao";
import { Entrada } from "../base/Campo";
import { rolarParaVisivel, useCliqueFora, useFlutuante } from "../base/flutuante";
import { useNotificar } from "../Toast";
import { turnoFuncionaEm, type IndiceAgenda } from "./indice";
import { classeSaldo, saldoTexto } from "./ResumoSemanal";
import { calcularTotais } from "./saldos";

interface Props {
  clienteId: number;
  agenda: AgendaMes;
  indice: IndiceAgenda;
  turnosVisiveis: Set<number>;
  filtro: ((a: Alocacao) => boolean) | null;
  hoje: string;
  /** Recebe o mês inteiro recalculado depois de cada alteração. */
  onAlterada: (agenda: AgendaMes) => void;
}

interface Dia {
  data: string;
  dia: number;
  /** 0 = segunda ... 6 = domingo. */
  diaSemana: number;
  /** Primeiro dia de uma semana de apuração. */
  inicioSemana: boolean;
}

interface Foco {
  funcionarioId: number;
  dia: number;
}

interface MenuAberto extends Foco {
  /** Item destacado pelo teclado. */
  ativo: number;
  /** "lista" = turnos, folga e ausências; "motivo" = campo do motivo da ausência justificada. */
  etapa: "lista" | "motivo";
}

/** Alteração em andamento numa célula: o valor pedido aparece enquanto o backend responde. */
interface Edicao {
  dia: DiaQuadro;
  pendentes: number;
}

/** Item do menu da célula. */
type ItemMenu = { tipo: "turno"; turno: Turno } | { tipo: "folga" } | { tipo: "falta" } | { tipo: "justificada" };

/** Como uma célula aparece: código, estado visual e a descrição da dica. */
interface Celula {
  codigo: string;
  estado: "folga" | "turno" | "falta" | "justificada";
  descricao: string;
  turno?: Turno;
  /** Minutos a mais (+) ou a menos (−) que o turno, quando as horas foram compensadas. */
  compensacao: number;
}

const FOLGA: DiaQuadro = { tipo: "folga" };
const FALTA: DiaQuadro = { tipo: "ausencia", justificada: false, motivo: null };

const ORDEM_PERIODOS: Periodo[] = ["manha", "tarde", "noite"];
const LETRA_PERIODO: Record<Periodo, string> = { manha: "M", tarde: "T", noite: "N" };
const PERIODO_DA_LETRA: Record<string, Periodo> = { m: "manha", t: "tarde", n: "noite" };
const NOME_PERIODO: Record<Periodo, string> = { manha: "da manhã", tarde: "da tarde", noite: "da noite" };

const chaveCelula = (funcionarioId: number, data: string) => `${funcionarioId}|${data}`;

/** Complemento da dica das células ajustadas à mão (e da legenda). */
const DICA_AJUSTE = "Ajustado à mão: fica como está ao reequilibrar";

function mesmoDia(a: DiaQuadro, b: DiaQuadro): boolean {
  if (a.tipo === "turno") return b.tipo === "turno" && a.turnoId === b.turnoId;
  if (a.tipo === "ausencia") return b.tipo === "ausencia" && a.justificada === b.justificada && (a.motivo ?? "") === (b.motivo ?? "");
  return b.tipo === "folga";
}

/** O item do menu é o que vale hoje na célula? */
function itemAtual(item: ItemMenu, dia: DiaQuadro): boolean {
  switch (item.tipo) {
    case "turno":
      return dia.tipo === "turno" && dia.turnoId === item.turno.id;
    case "folga":
      return dia.tipo === "folga";
    case "falta":
      return dia.tipo === "ausencia" && !dia.justificada;
    case "justificada":
      return dia.tipo === "ausencia" && dia.justificada;
  }
}

/** Código, estado e dica de uma célula. `alocacao` só vale quando não há alteração em andamento. */
function descreverCelula(dia: DiaQuadro, alocacao: Alocacao | undefined, indice: IndiceAgenda, codigos: Map<number, string>): Celula {
  if (dia.tipo === "folga") return { codigo: "F", estado: "folga", descricao: "Folga", compensacao: 0 };
  if (dia.tipo === "ausencia") {
    const base = dia.justificada ? "Ausência justificada" : "Falta";
    return { codigo: dia.justificada ? "J" : "A", estado: dia.justificada ? "justificada" : "falta", descricao: dia.motivo ? `${base}: ${dia.motivo}` : base, compensacao: 0 };
  }
  const turno = indice.turnos.get(dia.turnoId);
  if (!turno) return { codigo: "?", estado: "turno", descricao: "Turno desconhecido", compensacao: 0 };
  const horario = alocacao ? `${alocacao.inicio}–${alocacao.fim}` : `${turno.inicio}–${turno.fim}`;
  // Horas diferentes das do turno: a geração compensou saldo de meses anteriores.
  const compensacao = alocacao ? alocacao.minutosTrabalhados - turno.minutosTrabalhados : 0;
  let descricao = `${turno.nome} ${horario}`;
  if (compensacao !== 0) descricao = `${turno.nome} · Compensação de horas: ${saldoTexto(compensacao)} (${horario})`;
  else if (alocacao && (alocacao.inicio !== turno.inicio || alocacao.fim !== turno.fim)) descricao += " (horário próprio)";
  return { codigo: codigos.get(turno.id) ?? "?", estado: "turno", descricao, turno, compensacao };
}

/** Turnos de cada período, na ordem dos códigos (por horário de início). */
function agruparPorPeriodo(turnos: Turno[]): Map<Periodo, Turno[]> {
  const mapa = new Map<Periodo, Turno[]>();
  for (const t of turnos) mapa.set(t.periodo, [...(mapa.get(t.periodo) ?? []), t]);
  for (const lista of mapa.values()) lista.sort((a, b) => a.inicio.localeCompare(b.inicio) || a.ordem - b.ordem || a.id - b.id);
  return mapa;
}

/** "M", "T", "N"; quando um período tem mais de um turno, "M1", "M2"... */
function calcularCodigos(porPeriodo: Map<Periodo, Turno[]>): Map<number, string> {
  const codigos = new Map<number, string>();
  for (const [periodo, lista] of porPeriodo) {
    lista.forEach((t, i) => codigos.set(t.id, lista.length === 1 ? LETRA_PERIODO[periodo] : `${LETRA_PERIODO[periodo]}${i + 1}`));
  }
  return codigos;
}

function ausenciaEm(lista: AusenciaAgenda[] | undefined, data: string): AusenciaAgenda | undefined {
  return lista?.find((a) => a.inicio <= data && data <= a.fim);
}

/** Célula da grade a partir do alvo de um evento (a grade usa um único tratador por tipo de evento). */
function celulaDe(alvo: EventTarget): (Foco & { elemento: HTMLElement }) | null {
  if (!(alvo instanceof Element)) return null;
  const elemento = alvo.closest<HTMLElement>("td[data-f]");
  if (!elemento) return null;
  const funcionarioId = Number(elemento.dataset.f);
  const dia = Number(elemento.dataset.d);
  return Number.isInteger(funcionarioId) && Number.isInteger(dia) ? { elemento, funcionarioId, dia } : null;
}

function incrementar(atual: Map<string, Edicao>, chave: string, dia: DiaQuadro): Map<string, Edicao> {
  const novo = new Map(atual);
  novo.set(chave, { dia, pendentes: (atual.get(chave)?.pendentes ?? 0) + 1 });
  return novo;
}

function decrementar(atual: Map<string, Edicao>, chave: string): Map<string, Edicao> {
  const edicao = atual.get(chave);
  if (!edicao) return atual;
  const novo = new Map(atual);
  if (edicao.pendentes <= 1) novo.delete(chave);
  else novo.set(chave, { ...edicao, pendentes: edicao.pendentes - 1 });
  return novo;
}

/**
 * Funções que ficaram abaixo do mínimo em cada turno de cada dia (chave "data|turnoId"), já em texto:
 * "Cozinheiro (0 de 1)". Só entram turnos em uso que funcionam no dia e funções com mínimo.
 */
function calcularFaltasDeFuncao(agenda: AgendaMes, indice: IndiceAgenda, dias: Dia[]): Map<string, string[]> {
  const faltas = new Map<string, string[]>();
  if (agenda.funcoes.length === 0) return faltas;
  const funcaoDe = new Map(agenda.funcionarios.map((f) => [f.id, f.funcao]));
  for (const turno of indice.turnosOrdenados) {
    if (turno.arquivado) continue;
    for (const d of dias) {
      if (!turnoFuncionaEm(turno, d.data)) continue;
      const presentes = new Map<string, number>();
      for (const a of indice.porDia.get(d.data)?.get(turno.id) ?? []) {
        const chave = funcaoDe.get(a.funcionarioId);
        if (chave) presentes.set(chave, (presentes.get(chave) ?? 0) + 1);
      }
      const faltando = agenda.funcoes.filter((f) => f.minimo > 0 && (presentes.get(f.chave) ?? 0) < f.minimo).map((f) => `${f.nome} (${presentes.get(f.chave) ?? 0} de ${f.minimo})`);
      if (faltando.length > 0) faltas.set(`${d.data}|${turno.id}`, faltando);
    }
  }
  return faltas;
}

/**
 * Quadro do mês, como numa planilha: uma linha por pessoa, uma coluna por dia.
 * Cada célula mostra o código do turno (M, T, N; M1, M2... quando o período tem mais de um),
 * F para folga, A para falta e J para ausência justificada (férias, atestado). Clique, Enter ou
 * Espaço abre o menu do dia; letras e setas funcionam como no teclado de uma planilha. Cada
 * alteração devolve o mês recalculado.
 */
export function GradeQuadro({ clienteId, agenda, indice, turnosVisiveis, filtro, hoje, onAlterada }: Props) {
  const notificar = useNotificar();
  const idMenu = useId();
  const corpo = useRef<HTMLTableSectionElement>(null);
  const menuRaiz = useRef<HTMLDivElement>(null);
  const ancora = useRef<HTMLElement | null>(null);
  // Alterações seguem em fila: cada resposta traz o mês inteiro e a última precisa ser a mais nova.
  const fila = useRef<Promise<void>>(Promise.resolve());

  const [foco, setFoco] = useState<Foco | null>(null);
  const [menu, setMenu] = useState<MenuAberto | null>(null);
  const [edicoes, setEdicoes] = useState<Map<string, Edicao>>(new Map());

  const editavel = agenda.geradoEm !== null;
  const totalDias = diasNoMes(agenda.ano, agenda.mes);
  const inicioDaSemana = indiceInicioSemana(agenda.inicioSemana);

  const dias = useMemo<Dia[]>(
    () =>
      Array.from({ length: totalDias }, (_, i) => {
        const data = montarData(agenda.ano, agenda.mes, i + 1);
        const diaSemana = diaDaSemana(data);
        return { data, dia: i + 1, diaSemana, inicioSemana: diaSemana === inicioDaSemana };
      }),
    [agenda.ano, agenda.mes, totalDias, inicioDaSemana],
  );

  const porPeriodo = useMemo(() => agruparPorPeriodo(agenda.turnos), [agenda.turnos]);
  const codigos = useMemo(() => calcularCodigos(porPeriodo), [porPeriodo]);
  const totais = useMemo(() => calcularTotais(agenda), [agenda]);
  const alocadas = useMemo(() => new Map(agenda.alocacoes.map((a) => [chaveCelula(a.funcionarioId, a.data), a])), [agenda.alocacoes]);
  // Células ajustadas à mão: ficam como estão quando o mês é reequilibrado.
  const ajustadas = useMemo(() => new Set(agenda.ajustes.map((a) => chaveCelula(a.funcionarioId, a.data))), [agenda.ajustes]);
  const ausencias = useMemo(() => {
    const mapa = new Map<number, AusenciaAgenda[]>();
    for (const a of agenda.ausencias) mapa.set(a.funcionarioId, [...(mapa.get(a.funcionarioId) ?? []), a]);
    return mapa;
  }, [agenda.ausencias]);
  // Pessoas agrupadas por função (grupos e nomes em ordem alfabética; "Sem função" por último).
  const grupos = useMemo(() => agruparPorFuncao(agenda.funcionarios), [agenda.funcionarios]);
  const minimos = useMemo(() => new Map(agenda.funcoes.map((f) => [f.chave, f.minimo])), [agenda.funcoes]);
  const faltasDeFuncao = useMemo(() => calcularFaltasDeFuncao(agenda, indice, dias), [agenda, indice, dias]);

  // O filtro de busca olha só a pessoa (nome ou matrícula): basta uma alocação com o id dela.
  const gruposVisiveis = grupos
    .map((g) => ({ ...g, membros: g.membros.filter((f) => filtro === null || filtro({ id: 0, funcionarioId: f.id, turnoId: 0, data: "", inicio: "", fim: "", minutosTrabalhados: 0 })) }))
    .filter((g) => g.membros.length > 0);
  // Linhas de pessoas na ordem da tela: é por elas que o teclado anda (os cabeçalhos de grupo não têm células).
  const linhas = gruposVisiveis.flatMap((g) => g.membros);
  const turnosRodape = indice.turnosOrdenados.filter((t) => !t.arquivado && turnosVisiveis.has(t.id));
  const turnosLegenda = ORDEM_PERIODOS.flatMap((p) => porPeriodo.get(p) ?? []);

  // Uma única célula na ordem de tabulação (roving tabindex); começa em hoje, se o mês for o atual.
  const diaInicial = dataNoMes(hoje, agenda.ano, agenda.mes) ? separarData(hoje).dia : 1;
  const primeira = linhas[0];
  const focoAtual: Foco | null = !primeira
    ? null
    : foco && linhas.some((f) => f.id === foco.funcionarioId)
      ? foco
      : { funcionarioId: primeira.id, dia: foco?.dia ?? diaInicial };

  const fecharMenu = useCallback(() => setMenu(null), []);
  useCliqueFora([menuRaiz, corpo], menu !== null, fecharMenu);

  /** O que vale na célula agora: o pedido em andamento, se houver, senão o que a agenda traz. */
  function diaAtual(funcionarioId: number, data: string): DiaQuadro {
    const chave = chaveCelula(funcionarioId, data);
    const edicao = edicoes.get(chave);
    if (edicao) return edicao.dia;
    const ausencia = ausenciaEm(ausencias.get(funcionarioId), data);
    if (ausencia) return { tipo: "ausencia", justificada: ausencia.justificada, motivo: ausencia.motivo };
    const alocacao = alocadas.get(chave);
    return alocacao ? { tipo: "turno", turnoId: alocacao.turnoId } : FOLGA;
  }

  function podeEditar(dia: number): boolean {
    return editavel && dias[dia - 1] !== undefined;
  }

  /** Itens do menu num dia: os turnos em uso que funcionam naquele dia da semana, a folga e as ausências. */
  function itensDoMenu(data: string): ItemMenu[] {
    const turnos = indice.turnosOrdenados.filter((t) => !t.arquivado && turnoFuncionaEm(t, data));
    return [...turnos.map((turno): ItemMenu => ({ tipo: "turno", turno })), { tipo: "folga" }, { tipo: "falta" }, { tipo: "justificada" }];
  }

  const itensMenu = menu ? itensDoMenu(dias[menu.dia - 1]?.data ?? "") : [];

  function irPara(funcionarioId: number, dia: number) {
    setFoco({ funcionarioId, dia });
    corpo.current?.querySelector<HTMLElement>(`td[data-f="${funcionarioId}"][data-d="${dia}"]`)?.focus();
  }

  function abrirMenu(funcionarioId: number, dia: number, elemento: HTMLElement) {
    const d = dias[dia - 1];
    if (!d) return;
    const atual = diaAtual(funcionarioId, d.data);
    const posicao = itensDoMenu(d.data).findIndex((i) => itemAtual(i, atual));
    ancora.current = elemento;
    setMenu({ funcionarioId, dia, ativo: Math.max(posicao, 0), etapa: "lista" });
  }

  /** Grava o dia da pessoa (turno, folga ou ausência) e entrega o mês recalculado. */
  function definir(funcionarioId: number, dia: number, novo: DiaQuadro) {
    const d = dias[dia - 1];
    if (!d || mesmoDia(diaAtual(funcionarioId, d.data), novo)) return;
    const chave = chaveCelula(funcionarioId, d.data);
    setEdicoes((atual) => incrementar(atual, chave, novo));
    fila.current = fila.current.then(async () => {
      try {
        onAlterada(await api.definirDia(clienteId, funcionarioId, d.data, novo));
      } catch (erro) {
        notificar.erro(mensagemErro(erro));
      } finally {
        setEdicoes((atual) => decrementar(atual, chave));
      }
    });
  }

  /** A e J: marcam falta ou ausência justificada sem motivo; se o dia já é desse tipo, nada muda (o motivo fica). */
  function definirAusenciaPorLetra(funcionarioId: number, dia: number, justificada: boolean) {
    const d = dias[dia - 1];
    if (!d) return;
    const atual = diaAtual(funcionarioId, d.data);
    if (atual.tipo === "ausencia" && atual.justificada === justificada) return;
    definir(funcionarioId, dia, { tipo: "ausencia", justificada, motivo: null });
  }

  /** M, T ou N: o primeiro turno do período que funciona no dia; repetir a letra passa para o seguinte. */
  function definirPorLetra(funcionarioId: number, dia: number, periodo: Periodo) {
    const d = dias[dia - 1];
    if (!d) return;
    const candidatos = (porPeriodo.get(periodo) ?? []).filter((t) => !t.arquivado && turnoFuncionaEm(t, d.data));
    if (candidatos.length === 0) {
      notificar.info(`Nenhum turno ${NOME_PERIODO[periodo]} funciona neste dia (${(DIAS_SEMANA_LONGO[d.diaSemana] ?? "").toLowerCase()}).`);
      return;
    }
    const atual = diaAtual(funcionarioId, d.data);
    const posicao = atual.tipo === "turno" ? candidatos.findIndex((t) => t.id === atual.turnoId) : -1;
    const proximo = candidatos[(posicao + 1) % candidatos.length];
    if (proximo) definir(funcionarioId, dia, { tipo: "turno", turnoId: proximo.id });
  }

  function escolherNoMenu(i: number) {
    const item = itensMenu[i];
    const d = menu ? dias[menu.dia - 1] : undefined;
    if (!menu || !item || !d) return;
    const { funcionarioId, dia } = menu;
    if (item.tipo === "justificada") {
      // A justificada pede o motivo (opcional) antes de gravar.
      setMenu({ ...menu, ativo: i, etapa: "motivo" });
      return;
    }
    setMenu(null);
    // Escolher o que já vale não grava de novo (numa falta, isso apagaria o motivo).
    if (itemAtual(item, diaAtual(funcionarioId, d.data))) return;
    definir(funcionarioId, dia, item.tipo === "turno" ? { tipo: "turno", turnoId: item.turno.id } : item.tipo === "falta" ? FALTA : FOLGA);
  }

  function confirmarMotivo(motivo: string) {
    if (!menu) return;
    const { funcionarioId, dia } = menu;
    setMenu(null);
    definir(funcionarioId, dia, { tipo: "ausencia", justificada: true, motivo: motivo.trim() || null });
    irPara(funcionarioId, dia);
  }

  function cancelarMenu() {
    if (menu) irPara(menu.funcionarioId, menu.dia);
    setMenu(null);
  }

  function ativarItem(i: number) {
    setMenu((atual) => (atual ? { ...atual, ativo: i } : atual));
    rolarParaVisivel(menuRaiz.current, i);
  }

  function aoTeclarMenu(e: KeyboardEvent<HTMLTableSectionElement>, aberto: MenuAberto) {
    const n = itensMenu.length;
    if (aberto.etapa === "motivo") {
      // O campo do motivo tem o foco e cuida das próprias teclas; aqui só sobra cancelar.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setMenu(null);
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        ativarItem((aberto.ativo + 1) % n);
        break;
      case "ArrowUp":
        e.preventDefault();
        ativarItem((aberto.ativo + n - 1) % n);
        break;
      case "Home":
        e.preventDefault();
        ativarItem(0);
        break;
      case "End":
        e.preventDefault();
        ativarItem(n - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        escolherNoMenu(aberto.ativo);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        setMenu(null);
        break;
      case "Tab":
        setMenu(null);
        break;
    }
  }

  function aoTeclar(e: KeyboardEvent<HTMLTableSectionElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (menu) {
      aoTeclarMenu(e, menu);
      return;
    }
    const celula = celulaDe(e.target);
    if (!celula) return;
    const { funcionarioId, dia, elemento } = celula;
    const posicao = linhas.findIndex((f) => f.id === funcionarioId);
    const vizinha = (passo: number) => linhas[posicao + passo];

    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        irPara(funcionarioId, Math.min(dia + 1, totalDias));
        return;
      case "ArrowLeft":
        e.preventDefault();
        irPara(funcionarioId, Math.max(dia - 1, 1));
        return;
      case "ArrowDown":
      case "ArrowUp": {
        e.preventDefault();
        const alvo = vizinha(e.key === "ArrowDown" ? 1 : -1);
        if (alvo) irPara(alvo.id, dia);
        return;
      }
      case "Home":
        e.preventDefault();
        irPara(funcionarioId, 1);
        return;
      case "End":
        e.preventDefault();
        irPara(funcionarioId, totalDias);
        return;
      case "Enter":
      case " ":
        e.preventDefault();
        if (podeEditar(dia)) abrirMenu(funcionarioId, dia, elemento);
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (podeEditar(dia)) definir(funcionarioId, dia, FOLGA);
        return;
    }

    const letra = e.key.toLowerCase();
    const periodo = PERIODO_DA_LETRA[letra];
    if (letra === "f" || letra === "a" || letra === "j" || periodo) {
      e.preventDefault();
      if (!podeEditar(dia)) return;
      if (letra === "f") definir(funcionarioId, dia, FOLGA);
      else if (letra === "a") definirAusenciaPorLetra(funcionarioId, dia, false);
      else if (letra === "j") definirAusenciaPorLetra(funcionarioId, dia, true);
      else if (periodo) definirPorLetra(funcionarioId, dia, periodo);
    }
  }

  function aoClicar(e: MouseEvent<HTMLTableSectionElement>) {
    const celula = celulaDe(e.target);
    if (!celula) return;
    const { funcionarioId, dia, elemento } = celula;
    setFoco({ funcionarioId, dia });
    if (menu && menu.funcionarioId === funcionarioId && menu.dia === dia) setMenu(null);
    else if (podeEditar(dia)) abrirMenu(funcionarioId, dia, elemento);
    else setMenu(null);
  }

  function aoFocar(e: FocusEvent<HTMLTableSectionElement>) {
    const celula = celulaDe(e.target);
    if (!celula) return;
    const { funcionarioId, dia } = celula;
    setFoco((atual) => (atual && atual.funcionarioId === funcionarioId && atual.dia === dia ? atual : { funcionarioId, dia }));
  }

  /** Linha de uma pessoa: nome, as células de cada dia e os totais do mês. */
  function renderLinha(f: FuncionarioResumo) {
    const t = totais.get(f.id);
    const saldo = t?.saldo ?? 0;
    const anterior = f.saldoAnteriorMin;
    const acumulado = anterior + saldo;
    const temAcumulado = Boolean(t?.temSemana) || anterior !== 0;
    const dicaSaldo = !t?.temSemana
      ? "Nenhuma semana fechada ainda"
      : `Horas escaladas menos as previstas, nas semanas fechadas${t.parcial ? "; semanas que continuam num mês sem escala ficam de fora" : ""}`;
    const dicaAcumulado = temAcumulado ? `Anterior: ${saldoTexto(anterior)} · Mês: ${t?.temSemana ? saldoTexto(saldo) : "—"}` : "Nenhum saldo anterior e nenhuma semana fechada ainda";
    return (
      <tr key={f.id} className={f.id === focoAtual?.funcionarioId ? "quadro-linha foco" : "quadro-linha"}>
        <th scope="row" className="quadro-nome" data-dica={f.cargo ? `${f.nome} · ${f.cargo}` : f.nome}>
          <span className="quadro-nome-texto">{f.nome}</span>
          <span className="quadro-cargo">{f.cargo ?? f.matricula}</span>
        </th>
        {dias.map((d) => {
          const chave = chaveCelula(f.id, d.data);
          const edicao = edicoes.get(chave);
          const celula = descreverCelula(diaAtual(f.id, d.data), edicao ? undefined : alocadas.get(chave), indice, codigos);
          const { turno } = celula;
          const menuAqui = menu?.funcionarioId === f.id && menu.dia === d.dia;
          // Uma alteração em andamento já conta como ajuste: o backend a grava assim que responde.
          const ajustada = edicao !== undefined || ajustadas.has(chave);
          const descricao = ajustada ? `${celula.descricao} · ${DICA_AJUSTE}` : celula.descricao;
          const classes = [
            "quadro-celula",
            celula.estado,
            ajustada && "ajustada",
            d.diaSemana >= 5 && "fim",
            d.inicioSemana && "semana-ini",
            d.data === hoje && "hoje",
            editavel && "editavel",
            edicao && "salvando",
            menuAqui && "aberta",
            turno && !turnosVisiveis.has(turno.id) && "oculto",
          ]
            .filter(Boolean)
            .join(" ");
          const ativa = focoAtual?.funcionarioId === f.id && focoAtual.dia === d.dia;
          return (
            <td
              key={d.data}
              className={classes}
              style={turno ? ({ "--cor-turno": turno.cor } as CSSProperties) : undefined}
              tabIndex={ativa ? 0 : -1}
              data-f={f.id}
              data-d={d.dia}
              data-dica={descricao}
              aria-label={`${f.nome}, ${formatarDiaMes(d.data)}: ${descricao}`}
              aria-readonly={!editavel || undefined}
              aria-busy={edicao ? true : undefined}
              aria-haspopup={editavel ? "menu" : undefined}
              aria-expanded={menuAqui ? true : undefined}
              aria-controls={menuAqui ? idMenu : undefined}
              aria-activedescendant={menuAqui && menu?.etapa === "lista" ? `${idMenu}-${menu.ativo}` : undefined}
            >
              {celula.codigo}
              {celula.compensacao !== 0 && (
                <span className="quadro-comp" aria-hidden="true">
                  {celula.compensacao > 0 ? "+" : "−"}
                </span>
              )}
            </td>
          );
        })}
        <td className="quadro-total quadro-horas num">{formatarMinutos(t?.minutos ?? 0)}</td>
        <td className="quadro-total quadro-dias num">{t?.dias ?? 0}</td>
        <td className={`quadro-total quadro-saldo num ${t?.temSemana ? classeSaldo(saldo) : "texto-fraco"}`} data-dica={dicaSaldo}>
          {t?.temSemana ? saldoTexto(saldo) : "—"}
        </td>
        <td className={`quadro-total quadro-acumulado num ${temAcumulado ? classeSaldo(acumulado) : "texto-fraco"}`} data-dica={dicaAcumulado}>
          {temAcumulado ? saldoTexto(acumulado) : "—"}
        </td>
      </tr>
    );
  }

  const estiloRolagem = { "--n-rodape": turnosRodape.length } as CSSProperties;
  const diaDoMenu = menu ? dias[menu.dia - 1] : undefined;
  const atualNoMenu = menu && diaDoMenu ? diaAtual(menu.funcionarioId, diaDoMenu.data) : FOLGA;

  return (
    <div className="quadro-secao">
      <Legenda turnos={turnosLegenda} codigos={codigos} editavel={editavel} comFuncoes={agenda.funcoes.length > 0} />

      <div className="quadro-rolagem" style={estiloRolagem}>
        <table className="quadro" role="grid" aria-label={`Quadro de horários de ${tituloMes(agenda.ano, agenda.mes)}`} aria-readonly={!editavel || undefined}>
          <thead>
            <tr>
              <th scope="col" className="quadro-nome quadro-canto">
                Funcionário
              </th>
              {dias.map((d) => {
                const classes = ["quadro-dia", d.diaSemana >= 5 && "fim", d.inicioSemana && "semana-ini", d.data === hoje && "hoje", d.dia === focoAtual?.dia && "foco"].filter(Boolean).join(" ");
                const nome = `${DIAS_SEMANA_LONGO[d.diaSemana] ?? ""}, ${formatarDiaMes(d.data)}`;
                return (
                  <th key={d.data} scope="col" className={classes} aria-label={nome} data-dica={nome}>
                    <span className="quadro-dia-num">{d.dia}</span>
                    <span className="quadro-dia-letra" aria-hidden="true">
                      {LETRAS_DIAS[d.diaSemana]}
                    </span>
                  </th>
                );
              })}
              <th scope="col" className="quadro-total quadro-horas" data-dica="Horas trabalhadas no mês">
                Horas
              </th>
              <th scope="col" className="quadro-total quadro-dias" data-dica="Dias trabalhados no mês">
                Dias
              </th>
              <th scope="col" className="quadro-total quadro-saldo" data-dica="Horas escaladas menos as previstas, nas semanas já fechadas do mês">
                Saldo
              </th>
              <th scope="col" className="quadro-total quadro-acumulado" data-dica="Saldo dos meses anteriores mais o do mês: horas a mais (+) ou devendo (−)">
                Acumulado
              </th>
            </tr>
          </thead>

          <tbody ref={corpo} onClick={aoClicar} onKeyDown={aoTeclar} onFocus={aoFocar}>
            {linhas.length === 0 && (
              <tr>
                <td className="quadro-vazio" colSpan={totalDias + 5}>
                  {filtro ? "Nenhum funcionário encontrado na busca." : "Nenhum funcionário neste mês."}
                </td>
              </tr>
            )}
            {gruposVisiveis.map((g) => {
              const minimo = g.chave === null ? undefined : minimos.get(g.chave);
              const dicaGrupo = `${g.nome}: ${pluralizar(g.membros.length, "pessoa", "pessoas")}${minimo ? ` · mínimo de ${minimo} por turno` : ""}`;
              return (
                <Fragment key={g.chave ?? "sem-funcao"}>
                  <tr className="quadro-grupo">
                    <th scope="row" className="quadro-nome" data-dica={dicaGrupo}>
                      <span className="quadro-grupo-rotulo">
                        <span className="quadro-grupo-nome">{g.nome}</span>
                        <span className="quadro-grupo-contagem">{g.membros.length}</span>
                      </span>
                    </th>
                    <td className="quadro-grupo-fundo" colSpan={totalDias + 4} aria-hidden="true" />
                  </tr>
                  {g.membros.map(renderLinha)}
                </Fragment>
              );
            })}
          </tbody>

          {turnosRodape.length > 0 && (
            <tfoot>
              {turnosRodape.map((turno, i) => (
                <tr key={turno.id} className="quadro-rodape" style={{ "--restantes": turnosRodape.length - 1 - i, "--cor-turno": turno.cor } as CSSProperties}>
                  <th scope="row" className="quadro-nome" data-dica={`Pessoas por dia: ${turno.nome}`}>
                    <span className="quadro-rodape-nome">
                      <span className="ponto-cor" aria-hidden="true" />
                      <span className="quadro-nome-texto">{turno.nome}</span>
                      {turno.efetivoMinimo > 0 && <span className="quadro-cargo">mín. {turno.efetivoMinimo}</span>}
                    </span>
                  </th>
                  {dias.map((d) => {
                    const opera = turnoFuncionaEm(turno, d.data);
                    const quantidade = indice.porDia.get(d.data)?.get(turno.id)?.length ?? 0;
                    const abaixo = opera && turno.efetivoMinimo > 0 && quantidade < turno.efetivoMinimo;
                    // Funções abaixo do mínimo neste turno e dia (ver `Funcao.minimo`).
                    const faltando = opera ? faltasDeFuncao.get(`${d.data}|${turno.id}`) : undefined;
                    const base = !opera
                      ? `${turno.nome} não funciona neste dia`
                      : abaixo
                        ? `${turno.nome}: ${quantidade} de ${turno.efetivoMinimo} pessoas (abaixo do mínimo)`
                        : `${turno.nome}: ${quantidade} ${quantidade === 1 ? "pessoa" : "pessoas"}`;
                    const descricao = faltando ? `${base} · Falta: ${faltando.join(", ")}` : base;
                    const classes = [d.diaSemana >= 5 && "fim", d.inicioSemana && "semana-ini", d.data === hoje && "hoje", !opera && "fechado", faltando && "sem-funcao", abaixo && "abaixo"]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <td key={d.data} className={classes} data-dica={descricao} aria-label={`${formatarDiaMes(d.data)}, ${descricao}`}>
                        {opera ? quantidade : "–"}
                      </td>
                    );
                  })}
                  <td className="quadro-total quadro-horas" />
                  <td className="quadro-total quadro-dias" />
                  <td className="quadro-total quadro-saldo" />
                  <td className="quadro-total quadro-acumulado" />
                </tr>
              ))}
            </tfoot>
          )}
        </table>
      </div>

      {menu && (
        <MenuCelula
          // Uma instância por célula: o posicionamento é refeito ao trocar de âncora.
          key={`${menu.funcionarioId}|${menu.dia}`}
          id={idMenu}
          ancora={ancora}
          raizRef={menuRaiz}
          itens={itensMenu}
          ativo={menu.ativo}
          selecionado={itensMenu.findIndex((i) => itemAtual(i, atualNoMenu))}
          etapa={menu.etapa}
          motivoInicial={atualNoMenu.tipo === "ausencia" && atualNoMenu.justificada ? (atualNoMenu.motivo ?? "") : ""}
          codigos={codigos}
          onAtivar={ativarItem}
          onEscolher={escolherNoMenu}
          onConfirmarMotivo={confirmarMotivo}
          onCancelar={cancelarMenu}
        />
      )}
    </div>
  );
}

interface LegendaProps {
  turnos: Turno[];
  codigos: Map<number, string>;
  editavel: boolean;
  /** Há funções com mínimo por turno (o rodapé pode marcar a falta delas). */
  comFuncoes: boolean;
}

/** Códigos usados no quadro, na ordem manhã, tarde e noite. */
function Legenda({ turnos, codigos, editavel, comFuncoes }: LegendaProps) {
  return (
    <ul className="quadro-legenda" aria-label="Legenda dos códigos">
      {turnos.map((t) => (
        <li key={t.id} style={{ "--cor-turno": t.cor } as CSSProperties}>
          <span className="quadro-amostra">{codigos.get(t.id)}</span>
          <span className="quadro-legenda-nome">{t.arquivado ? `${t.nome} (arquivado)` : t.nome}</span>
          <span className="quadro-legenda-horario">
            {t.inicio}–{t.fim}
          </span>
        </li>
      ))}
      <li>
        <span className="quadro-amostra folga">F</span>
        <span className="quadro-legenda-nome">Folga</span>
      </li>
      <li data-dica="A pessoa não veio: as horas do dia ficam devendo">
        <span className="quadro-amostra falta">A</span>
        <span className="quadro-legenda-nome">Falta</span>
      </li>
      <li data-dica="Férias, atestado: as horas do dia são abonadas">
        <span className="quadro-amostra justificada">J</span>
        <span className="quadro-legenda-nome">Ausência justificada</span>
      </li>
      <li data-dica="Turno com horas a mais (+) ou a menos (−) para compensar o saldo de meses anteriores">
        <span className="quadro-amostra-comp" aria-hidden="true">
          <span className="quadro-comp">+</span>
          <span className="quadro-comp">−</span>
        </span>
        <span className="quadro-legenda-nome">Horas compensadas</span>
      </li>
      {editavel && (
        <li data-dica={DICA_AJUSTE}>
          <span className="quadro-amostra-ajuste" aria-hidden="true">
            M
          </span>
          <span className="quadro-legenda-nome">Ajustado à mão</span>
        </li>
      )}
      {comFuncoes && (
        <li data-dica="No rodapé, a contagem do turno fica em âmbar quando falta o mínimo de alguma função naquele dia; passe o mouse para ver qual.">
          <span className="quadro-amostra-funcao" aria-hidden="true">
            2
          </span>
          <span className="quadro-legenda-nome">Falta função no turno</span>
        </li>
      )}
      {editavel && <li className="quadro-legenda-ajuda">Clique numa célula para mudar o dia, ou digite M, T, N, F, A (falta) e J (justificada).</li>}
    </ul>
  );
}

interface MenuCelulaProps {
  id: string;
  ancora: RefObject<HTMLElement | null>;
  raizRef: RefObject<HTMLDivElement | null>;
  itens: ItemMenu[];
  ativo: number;
  /** Posição do item que vale hoje na célula (-1 = nenhum). */
  selecionado: number;
  etapa: "lista" | "motivo";
  /** Motivo já gravado, quando o dia é uma ausência justificada. */
  motivoInicial: string;
  codigos: Map<number, string>;
  onAtivar: (i: number) => void;
  onEscolher: (i: number) => void;
  onConfirmarMotivo: (motivo: string) => void;
  onCancelar: () => void;
}

/**
 * Menu do dia preso à célula. Na lista, o foco fica na própria célula (que aponta o item ativo por
 * `aria-activedescendant`), então a navegação por teclado é tratada na grade. Na etapa do motivo
 * da ausência justificada, o foco vai para o campo de texto.
 */
function MenuCelula({ id, ancora, raizRef, itens, ativo, selecionado, etapa, motivoInicial, codigos, onAtivar, onEscolher, onConfirmarMotivo, onCancelar }: MenuCelulaProps) {
  const estilo = useFlutuante(ancora, true, { largura: 256, alturaMax: 340 });
  return createPortal(
    <div ref={raizRef} className="flutuante quadro-menu" style={estilo}>
      {etapa === "motivo" ? (
        <FormularioMotivo id={id} inicial={motivoInicial} onConfirmar={onConfirmarMotivo} onCancelar={onCancelar} />
      ) : (
        <ul id={id} role="menu" aria-label="O que fica neste dia" className="lista-opcoes">
          {itens.map((item, i) => {
            const turno = item.tipo === "turno" ? item.turno : null;
            const classes = ["opcao", i === ativo && "ativa", item.tipo === "folga" && "quadro-menu-folga"].filter(Boolean).join(" ");
            const [codigo, nome] =
              item.tipo === "turno" ? [codigos.get(item.turno.id) ?? "?", item.turno.nome] : item.tipo === "folga" ? ["F", "Folga"] : item.tipo === "falta" ? ["A", "Falta"] : ["J", "Ausência justificada"];
            return (
              <li
                key={item.tipo === "turno" ? item.turno.id : item.tipo}
                id={`${id}-${i}`}
                role="menuitemradio"
                aria-checked={i === selecionado}
                className={classes}
                style={turno ? ({ "--cor-turno": turno.cor } as CSSProperties) : undefined}
                onMouseEnter={() => onAtivar(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onEscolher(i)}
              >
                <span className={turno ? "quadro-amostra" : `quadro-amostra ${item.tipo}`} aria-hidden="true">
                  {codigo}
                </span>
                <span className="opcao-texto">{nome}</span>
                {turno && (
                  <span className="quadro-menu-horario">
                    {turno.inicio}–{turno.fim}
                  </span>
                )}
                {i === selecionado && <Check className="opcao-marca" size={15} strokeWidth={2.2} aria-hidden="true" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>,
    document.body,
  );
}

interface FormularioMotivoProps {
  id: string;
  inicial: string;
  onConfirmar: (motivo: string) => void;
  onCancelar: () => void;
}

/** Motivo opcional da ausência justificada: Enter ou o botão confirmam, Escape cancela. */
function FormularioMotivo({ id, inicial, onConfirmar, onCancelar }: FormularioMotivoProps) {
  const [motivo, setMotivo] = useState(inicial);
  const entrada = useRef<HTMLInputElement>(null);

  useEffect(() => {
    entrada.current?.focus();
    entrada.current?.select();
  }, []);

  function enviar(e: FormEvent) {
    e.preventDefault();
    onConfirmar(motivo);
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    onCancelar();
  }

  return (
    <form className="quadro-motivo" onSubmit={enviar}>
      <label htmlFor={`${id}-motivo`} className="quadro-motivo-rotulo">
        Ausência justificada
      </label>
      <Entrada
        ref={entrada}
        id={`${id}-motivo`}
        tamanho="p"
        value={motivo}
        maxLength={80}
        placeholder="Atestado, férias..."
        onChange={(e) => setMotivo(e.target.value)}
        onKeyDown={aoTeclar}
      />
      <p className="quadro-motivo-dica">Motivo opcional. As horas do dia ficam abonadas.</p>
      <div className="quadro-motivo-acoes">
        <Botao tamanho="p" onClick={onCancelar}>
          Cancelar
        </Botao>
        <Botao tamanho="p" variante="primario" type="submit">
          Confirmar
        </Botao>
      </div>
    </form>
  );
}
