// Base compartilhada pela geração e pela agenda: carrega o cliente do banco, monta a
// entrada do motor, calcula saldos e grava o "previsto" das semanas fechadas.

import type {
  Alocacao as AlocacaoDb,
  Ausencia as AusenciaDb,
  Funcionario as FuncionarioDb,
  Prisma,
  PrismaClient,
  Regras as RegrasDb,
  Turno as TurnoDb,
} from "@prisma/client";
import { deISO, paraISO } from "@/lib/datas";
import {
  type Alocacao,
  type OrigemAlocacao,
  chaveFuncao,
  datasDoIntervalo,
  type DataISO,
  type EntradaPlanejamento,
  type EtapaRegime,
  type FuncaoMinima,
  type FuncionarioPlano,
  primeiroDiaDoMes,
  type RegrasCarga,
  resumoSemanal,
  type Semana,
  semanasCobrindo,
  somarDias,
  type Turno,
  ultimoDiaDoMes,
} from "@/motor";
import {
  funcionarioParaMotor,
  publicacaoEc141,
  regimeParaMotor,
  regrasParaMotor,
  turnoParaMotor,
} from "./mapeadores";

/** Cliente Prisma ou transação. */
export type Db = PrismaClient | Prisma.TransactionClient;

/** Erro de regra de negócio da agenda, com mensagem pronta para o usuário. */
export class ErroAgenda extends Error {
  /** Código para a interface tratar o caso (ex.: `diaComAusencia` pede confirmação). */
  readonly codigo: string | null;
  constructor(mensagem: string, codigo: string | null = null) {
    super(mensagem);
    this.codigo = codigo;
    this.name = "ErroAgenda";
  }
}

/** Dias olhados para os lados do período (7 semanas) ao buscar meses vizinhos. */
export const JANELA_VIZINHOS_DIAS = 49;

export type FuncionarioComAusencias = FuncionarioDb & { ausencias: AusenciaDb[] };

export interface ContextoCliente {
  clienteId: string;
  nome: string;
  regrasDb: RegrasDb;
  regras: RegrasCarga;
  regime: EtapaRegime[];
  publicacao: DataISO;
  janelas: { dia: number; abreMin: number; fechaMin: number }[];
  /** Todos os turnos (inclusive arquivados), como no banco. */
  turnosDb: TurnoDb[];
  /** Turnos em uso (não arquivados), no formato do motor. */
  turnosAtivos: Turno[];
  /** Todos os turnos no formato do motor. */
  turnosTodos: Turno[];
  funcionarios: FuncionarioComAusencias[];
  funcoesMinimasDb: { funcao: string; minimo: number }[];
  meses: { ano: number; mes: number; geradoEm: Date }[];
  /** Dias em que o estabelecimento não abre (feriado, inventário), com o motivo. */
  diasFechados: Map<DataISO, string | null>;
}

export async function carregarContexto(db: Db, clienteId: string): Promise<ContextoCliente> {
  const cliente = await db.cliente.findUnique({
    where: { id: clienteId },
    include: {
      regras: true,
      janelas: true,
      turnos: { orderBy: [{ ordem: "asc" }, { nome: "asc" }] },
      funcionarios: { include: { ausencias: true }, orderBy: { nome: "asc" } },
      funcoesMinimas: true,
      meses: true,
      diasFechados: true,
    },
  });
  if (!cliente) throw new ErroAgenda("Cliente não encontrado.");
  if (!cliente.regras) throw new ErroAgenda("O cliente ainda não tem regras de jornada configuradas.");
  const turnosTodos = cliente.turnos.map(turnoParaMotor);
  return {
    clienteId,
    nome: cliente.nome,
    regrasDb: cliente.regras,
    regras: regrasParaMotor(cliente.regras),
    regime: regimeParaMotor(cliente.regras),
    publicacao: publicacaoEc141(cliente.regras),
    janelas: cliente.janelas,
    turnosDb: cliente.turnos,
    turnosAtivos: cliente.turnos.filter((t) => !t.arquivado).map(turnoParaMotor),
    turnosTodos,
    funcionarios: cliente.funcionarios,
    funcoesMinimasDb: cliente.funcoesMinimas,
    meses: cliente.meses.map((m) => ({ ano: m.ano, mes: m.mes, geradoEm: m.geradoEm })),
    diasFechados: new Map(cliente.diasFechados.map((d) => [paraISO(d.data), d.motivo])),
  };
}

// ---------------------------------------------------------------------------
// Datas e meses
// ---------------------------------------------------------------------------

/** Dias fechados do cliente no formato do motor. */
export function conjuntoDiasFechados(ctx: Pick<ContextoCliente, "diasFechados">): Set<DataISO> {
  return new Set(ctx.diasFechados.keys());
}

export function limitesDoMes(ano: number, mes: number): { inicio: DataISO; fim: DataISO } {
  return { inicio: primeiroDiaDoMes(ano, mes), fim: ultimoDiaDoMes(ano, mes) };
}

export function validarAnoMes(ano: number, mes: number): void {
  if (!Number.isInteger(ano) || ano < 2000 || ano > 2100 || !Number.isInteger(mes) || mes < 1 || mes > 12) {
    throw new ErroAgenda("Mês inválido.");
  }
}

const chaveMes = (ano: number, mes: number): string => `${ano}-${String(mes).padStart(2, "0")}`;

/** Função que diz se uma data está em um mês gerado. */
export function criarDiaPlanejado(meses: readonly { ano: number; mes: number }[]): (data: DataISO) => boolean {
  const conjunto = new Set(meses.map((m) => chaveMes(m.ano, m.mes)));
  return (data) => conjunto.has(data.slice(0, 7));
}

/** Meses seguintes ao (ano, mes) já gerados, em ordem. */
export function mesesPosteriores(ctx: ContextoCliente, ano: number, mes: number): { ano: number; mes: number }[] {
  return ctx.meses
    .filter((m) => m.ano * 12 + m.mes > ano * 12 + mes)
    .map((m) => ({ ano: m.ano, mes: m.mes }))
    .sort((a, b) => a.ano * 12 + a.mes - (b.ano * 12 + b.mes));
}

export function semanaFechada(semana: Semana, diaPlanejado: (d: DataISO) => boolean): boolean {
  return semana.dias().every(diaPlanejado);
}

// ---------------------------------------------------------------------------
// Conversões
// ---------------------------------------------------------------------------

export function alocacaoParaMotor(a: Pick<AlocacaoDb, "funcionarioId" | "turnoId" | "data" | "inicioMin" | "fimMin" | "intervaloMin" | "origem">): Alocacao {
  const origem: OrigemAlocacao = a.origem === "compensacao" || a.origem === "horaExtra" ? a.origem : "normal";
  return {
    origem,
    funcionarioId: a.funcionarioId,
    turnoId: a.turnoId,
    data: paraISO(a.data),
    horario: { inicioMin: a.inicioMin, fimMin: a.fimMin, intervaloMin: a.intervaloMin },
  };
}

/** Alocações do cliente entre duas datas (inclusive). */
export async function alocacoesEntre(db: Db, clienteId: string, de: DataISO, ate: DataISO): Promise<AlocacaoDb[]> {
  return db.alocacao.findMany({
    where: { clienteId, data: { gte: deISO(de), lte: deISO(ate) } },
    orderBy: [{ data: "asc" }],
  });
}

/** Dias de ausência do funcionário dentro da janela, separados em justificadas e faltas. */
export function diasDeAusencia(
  ausencias: readonly AusenciaDb[],
  de: DataISO,
  ate: DataISO,
): { indisponivel: Set<DataISO>; faltas: Set<DataISO> } {
  const indisponivel = new Set<DataISO>();
  const faltas = new Set<DataISO>();
  for (const a of ausencias) {
    const ini = paraISO(a.inicio) > de ? paraISO(a.inicio) : de;
    const fim = paraISO(a.fim) < ate ? paraISO(a.fim) : ate;
    if (fim < ini) continue;
    const alvo = a.justificada ? indisponivel : faltas;
    for (const d of datasDoIntervalo(ini, fim)) alvo.add(d);
  }
  return { indisponivel, faltas };
}

export function planoDoFuncionario(
  f: FuncionarioComAusencias,
  de: DataISO,
  ate: DataISO,
  saldoAnteriorMin = 0,
): FuncionarioPlano {
  return funcionarioParaMotor(f, { ...diasDeAusencia(f.ausencias, de, ate), saldoAnteriorMin });
}

/** Mínimo de pessoas por função (chave de `chaveFuncao`): funções sem linha usam 0 (sem exigência); nome = cargo mais frequente. */
export function minimosPorFuncao(
  funcionarios: readonly FuncionarioDb[],
  linhas: readonly { funcao: string; minimo: number }[],
): Map<string, FuncaoMinima> {
  const cargos = new Map<string, Map<string, number>>();
  for (const f of funcionarios) {
    if (!f.ativo || !f.cargo?.trim()) continue;
    const chave = chaveFuncao(f.cargo);
    if (chave === "") continue;
    const nomes = cargos.get(chave) ?? new Map<string, number>();
    const cargo = f.cargo.trim();
    nomes.set(cargo, (nomes.get(cargo) ?? 0) + 1);
    cargos.set(chave, nomes);
  }
  const configurado = new Map(linhas.map((l) => [chaveFuncao(l.funcao), l.minimo]));
  const resultado = new Map<string, FuncaoMinima>();
  for (const [chave, nomes] of cargos) {
    const nome = [...nomes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))[0]?.[0] ?? chave;
    const minimo = configurado.get(chave) ?? 0;
    if (minimo > 0) resultado.set(chave, { nome, minimo });
  }
  return resultado;
}

// ---------------------------------------------------------------------------
// Semanas, previsto e saldo
// ---------------------------------------------------------------------------

export interface LinhaSemanaFuncionario {
  funcionarioId: string;
  semana: Semana;
  fechada: boolean;
  feitoMin: number;
  previstoMin: number;
  limiteMin: number;
  saldoMin: number;
  /** A pessoa tem jornada ou falta na semana (só então o saldo conta). */
  temMovimento: boolean;
}

/**
 * Horas feitas × previstas de cada funcionário em cada semana. `usarGravado`: nas semanas
 * fechadas, usa o previsto gravado quando existe (senão calcula com as regras de agora).
 */
export function resumirSemanas(args: {
  ctx: ContextoCliente;
  semanas: readonly Semana[];
  funcionarios: readonly FuncionarioComAusencias[];
  turnos: readonly Turno[];
  alocacoes: readonly Alocacao[];
  diaPlanejado: (d: DataISO) => boolean;
  gravados?: ReadonlyMap<string, number>;
  saldosAnteriores?: ReadonlyMap<string, number>;
}): LinhaSemanaFuncionario[] {
  const { ctx, semanas, funcionarios, turnos, alocacoes, diaPlanejado, gravados } = args;
  if (semanas.length === 0) return [];
  const de = semanas[0]?.inicio ?? "";
  const ate = semanas[semanas.length - 1]?.fim ?? "";
  const planos = funcionarios.map((f) => planoDoFuncionario(f, de, ate, args.saldosAnteriores?.get(f.id) ?? 0));
  const porSemana = new Map<string, Alocacao[]>();
  for (const a of alocacoes) {
    for (const s of semanas) {
      if (s.contem(a.data)) {
        const lista = porSemana.get(s.inicio) ?? [];
        lista.push(a);
        porSemana.set(s.inicio, lista);
        break;
      }
    }
  }
  const resultado: LinhaSemanaFuncionario[] = [];
  for (const semana of semanas) {
    const fechada = semanaFechada(semana, diaPlanejado);
    const daSemana = porSemana.get(semana.inicio) ?? [];
    const previstosGravados = new Map<string, number>();
    if (fechada && gravados) {
      for (const f of funcionarios) {
        const g = gravados.get(`${f.id}|${semana.inicio}`);
        if (g !== undefined) previstosGravados.set(f.id, g);
      }
    }
    const linhas = resumoSemanal({
      semana,
      funcionarios: planos,
      turnos,
      regras: ctx.regras,
      regime: ctx.regime,
      alocacoes: daSemana,
      previstosGravados,
      diasFechados: conjuntoDiasFechados(ctx),
    });
    const comAloc = new Set(daSemana.map((a) => a.funcionarioId));
    for (const l of linhas) {
      const plano = planos.find((p) => p.id === l.funcionarioId);
      const temFalta = plano ? semana.dias().some((d) => plano.faltas.has(d)) : false;
      resultado.push({
        funcionarioId: l.funcionarioId,
        semana,
        fechada,
        feitoMin: l.feitoMin,
        previstoMin: l.previstoMin,
        limiteMin: l.limiteMin,
        saldoMin: l.saldoMin,
        temMovimento: comAloc.has(l.funcionarioId) || temFalta,
      });
    }
  }
  return resultado;
}

export async function carregarPrevistos(db: Db, clienteId: string, de: DataISO, ate: DataISO): Promise<Map<string, number>> {
  const linhas = await db.previstoSemana.findMany({ where: { clienteId, inicio: { gte: deISO(de), lte: deISO(ate) } } });
  return new Map(linhas.map((l) => [`${l.funcionarioId}|${paraISO(l.inicio)}`, l.previstoMin]));
}

/**
 * Saldo de horas de cada funcionário nas semanas fechadas anteriores à semana em que
 * `inicio` cai: soma de (feito − previsto gravado). Só conta semanas em que a pessoa tem
 * jornada ou falta. Devolve só quem tem saldo diferente de zero.
 */
export async function calcularSaldosAnteriores(db: Db, ctx: ContextoCliente, inicio: DataISO): Promise<Map<string, number>> {
  const saldos = new Map<string, number>();
  if (ctx.meses.length === 0) return saldos;
  const primeiro = ctx.meses
    .map((m) => primeiroDiaDoMes(m.ano, m.mes))
    .reduce((a, b) => (a < b ? a : b));
  const semanaDoPeriodo = semanasCobrindo(inicio, inicio, ctx.regras.inicioSemana)[0];
  if (!semanaDoPeriodo) return saldos;
  const ate = somarDias(semanaDoPeriodo.inicio, -1);
  if (ate < primeiro) return saldos;
  const semanas = semanasCobrindo(primeiro, ate, ctx.regras.inicioSemana);
  const de = semanas[0]?.inicio;
  if (!de) return saldos;
  const [gravados, alocacoes] = await Promise.all([
    carregarPrevistos(db, ctx.clienteId, de, ate),
    alocacoesEntre(db, ctx.clienteId, de, ate),
  ]);
  const linhas = resumirSemanas({
    ctx,
    semanas,
    funcionarios: ctx.funcionarios,
    // Semanas passadas: os dias abertos vêm de todos os turnos, inclusive arquivados.
    turnos: ctx.turnosTodos,
    alocacoes: alocacoes.map(alocacaoParaMotor),
    diaPlanejado: criarDiaPlanejado(ctx.meses),
    gravados,
  });
  for (const l of linhas) {
    if (!l.fechada || !l.temMovimento) continue;
    saldos.set(l.funcionarioId, (saldos.get(l.funcionarioId) ?? 0) + l.saldoMin);
  }
  for (const [id, v] of saldos) if (v === 0) saldos.delete(id);
  return saldos;
}

/**
 * Grava o previsto (com as regras de agora) das semanas fechadas que tocam o mês e
 * terminam a partir de `desde`; com `soSemanaDe`, só a semana que contém essa data.
 * Deve rodar depois de gravar alocações e `MesGerado`.
 */
export interface OpcoesGravarPrevistos {
  desde?: DataISO;
  soSemanaDe?: DataISO;
  /**
   * Previsto devolvido pelo motor (`ResultadoPlanejamento.previstos`): tem prioridade sobre o
   * cálculo puro, porque já desconta a folga estrutural do rodízio de domingo.
   */
  doMotor?: readonly { funcionarioId: string; inicioSemana: DataISO; previstoMin: number }[];
  /**
   * Em ajustes manuais: mantém o menor entre o previsto já gravado e o recalculado, para não
   * apagar o desconto do motor nem ignorar uma ausência nova.
   */
  manterMenor?: boolean;
}

export async function gravarPrevistos(
  db: Db,
  clienteId: string,
  ano: number,
  mes: number,
  opcoes: OpcoesGravarPrevistos = {},
): Promise<void> {
  const ctx = await carregarContexto(db, clienteId);
  const { inicio, fim } = limitesDoMes(ano, mes);
  const diaPlanejado = criarDiaPlanejado(ctx.meses);
  let semanas = semanasCobrindo(inicio, fim, ctx.regras.inicioSemana).filter((s) => semanaFechada(s, diaPlanejado));
  const { desde, soSemanaDe } = opcoes;
  if (desde) semanas = semanas.filter((s) => s.fim >= desde);
  if (soSemanaDe) semanas = semanas.filter((s) => s.contem(soSemanaDe));
  if (semanas.length === 0) return;
  const de = semanas[0]?.inicio ?? inicio;
  const ate = semanas[semanas.length - 1]?.fim ?? fim;
  const alocacoes = (await alocacoesEntre(db, clienteId, de, ate)).map(alocacaoParaMotor);
  const comAlocacao = new Set(alocacoes.map((a) => a.funcionarioId));
  const funcionarios = ctx.funcionarios.filter((f) => f.ativo || comAlocacao.has(f.id));
  const linhas = resumirSemanas({
    ctx,
    semanas,
    funcionarios,
    turnos: ctx.turnosAtivos,
    alocacoes,
    diaPlanejado,
  });
  const chave = (funcionarioId: string, inicioSemana: DataISO) => `${funcionarioId}|${inicioSemana}`;
  const doMotor = new Map((opcoes.doMotor ?? []).map((p) => [chave(p.funcionarioId, p.inicioSemana), p.previstoMin]));
  const anteriores = opcoes.manterMenor ? await carregarPrevistos(db, clienteId, de, ate) : new Map<string, number>();
  const previstoDe = (l: LinhaSemanaFuncionario): number => {
    const k = chave(l.funcionarioId, l.semana.inicio);
    const motor = doMotor.get(k);
    if (motor !== undefined) return motor;
    const anterior = anteriores.get(k);
    return anterior !== undefined && opcoes.manterMenor ? Math.min(anterior, l.previstoMin) : l.previstoMin;
  };
  await db.previstoSemana.deleteMany({
    where: { clienteId, inicio: { in: semanas.map((s) => deISO(s.inicio)) } },
  });
  await db.previstoSemana.createMany({
    data: linhas.map((l) => ({
      clienteId,
      funcionarioId: l.funcionarioId,
      inicio: deISO(l.semana.inicio),
      previstoMin: previstoDe(l),
    })),
  });
}

// ---------------------------------------------------------------------------
// Entrada do motor
// ---------------------------------------------------------------------------

export interface OpcoesEntrada {
  /** Só funcionários ativos (geração) ou também os que têm alocação no período (agenda). */
  funcionarios: "ativos" | { alemDosAtivos: ReadonlySet<string> };
  saldos?: ReadonlyMap<string, number>;
  /** Alocações da janela do período, se o chamador já as carregou (mesma janela de `montarEntrada`). */
  alocacoesDaJanela?: readonly AlocacaoDb[];
}

/**
 * Entrada do motor para o período `[inicio, fim do mês]`. Alocações fora do período (inclusive
 * os dias do mês antes de `inicio`) entram como fixas; os dias de meses já gerados contam
 * como planejados.
 */
export async function montarEntrada(
  db: Db,
  ctx: ContextoCliente,
  ano: number,
  mes: number,
  inicio: DataISO,
  opcoes: OpcoesEntrada,
): Promise<EntradaPlanejamento> {
  const { inicio: inicioMes, fim } = limitesDoMes(ano, mes);
  const de = inicio < inicioMes ? inicioMes : inicio > fim ? fim : inicio;
  const janelaIni = somarDias(de, -JANELA_VIZINHOS_DIAS);
  const janelaFim = somarDias(fim, JANELA_VIZINHOS_DIAS);
  const alocacoes = opcoes.alocacoesDaJanela ?? (await alocacoesEntre(db, ctx.clienteId, janelaIni, janelaFim));
  const alocacoesFixas = alocacoes.map(alocacaoParaMotor).filter((a) => a.data < de || a.data > fim);

  const datasPlanejadas = new Set<DataISO>();
  for (const m of ctx.meses) {
    const mi = primeiroDiaDoMes(m.ano, m.mes);
    const mf = ultimoDiaDoMes(m.ano, m.mes);
    const a = mi > janelaIni ? mi : janelaIni;
    const b = mf < janelaFim ? mf : janelaFim;
    if (b < a) continue;
    for (const d of datasDoIntervalo(a, b)) {
      if (d < de || d > fim) datasPlanejadas.add(d);
    }
  }

  const alem = typeof opcoes.funcionarios === "string" ? new Set<string>() : opcoes.funcionarios.alemDosAtivos;
  const listados = ctx.funcionarios.filter((f) => f.ativo || alem.has(f.id));
  return {
    inicio: de,
    fim,
    regras: ctx.regras,
    turnos: ctx.turnosAtivos,
    funcionarios: listados.map((f) => planoDoFuncionario(f, janelaIni, janelaFim, opcoes.saldos?.get(f.id) ?? 0)),
    alocacoesFixas,
    alocacoesTravadas: [],
    datasPlanejadas,
    regime: ctx.regime,
    minimoPorFuncao: minimosPorFuncao(ctx.funcionarios, ctx.funcoesMinimasDb),
    diasFechados: conjuntoDiasFechados(ctx),
  };
}
