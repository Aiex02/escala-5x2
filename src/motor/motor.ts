// Motor de distribuição automática de escalas.
//
// Garantias (restrições rígidas, nunca violadas)
// - Carga semanal: os minutos da semana completa de apuração (incluindo dias de meses vizinhos
//   já gerados, passados em `alocacoesFixas`) nunca passam de min(carga contratual, regra da
//   empresa, regime legal vigente), exceto pela hora extra de último recurso (abaixo).
// - Folgas semanais: dias trabalhados na semana ≤ 7 − folgas mínimas (a maior exigência entre
//   a empresa e o regime legal; 2 folgas no fim da escala 6x1).
// - Domingos seguidos: quando configurado, ninguém trabalha mais domingos em sequência que o
//   permitido (folga dominical periódica do comércio).
// - Jornada diária: turnos acima de `jornadaDiariaMaxMin` são descartados.
// - Descanso mínimo entre jornadas e máximo de dias consecutivos, também considerando as
//   alocações fixas antes e depois do período. Com um dia de folga no meio, o descanso sobe
//   para 35h (24h de repouso + 11h, `descansoSemanalMin`; CLT arts. 66 e 67, Súmula 110 do TST).
// - Dias fechados (feriados): ninguém é escalado, a cobertura mínima não vale e o dia não
//   conta como aberto no previsto da semana.
// - Dias indisponíveis (férias, atestados, afastamentos e faltas).
// - Dias de funcionamento do turno: ninguém é escalado num turno em dia da semana em que ele
//   não funciona.
// - No máximo uma jornada por funcionário por dia.
//
// Objetivo (heurística gulosa, determinística: mesma entrada, mesma saída)
// Cada funcionário recebe, por semana, uma carga-alvo igual ao previsto (jornadas inteiras
// dentro do teto, das folgas e dos dias de funcionamento) menos as horas já fixadas na semana.
// Quando parte da semana está em mês ainda não gerado, o alvo é proporcional aos dias
// disponíveis dentro do período, deixando saldo para o mês vizinho.
//
// Folgas da semana (`planejarFolgas`)
// Antes dos dias, cada pessoa recebe as folgas da semana (as que sobram do alvo): primeiro
// respeitando o máximo de dias consecutivos (olhando também as 3 semanas seguintes; a folga
// que mesmo assim for forçada tira uma jornada do alvo e do previsto, em vez de virar saldo
// negativo e jornada esticada), depois o efetivo mínimo de cada turno e função, folgas coladas
// (2 folgas em dias seguidos, inclusive sábado+domingo e domingo+segunda), revezamento de
// sábados e domingos livres por grupo (quem tem menos fim de semana livre folga primeiro) e,
// por fim, folgas uniformes entre os dias. O domingo do rodízio (`domingosSeguidosMax`) é a
// folga da semana. Depois os dias são processados em ordem: quem tem folga planejada no dia só
// entra se a cobertura mínima pedir; os demais são escalados (obrigatórios), repartidos pelos
// turnos pela cota do dia (demanda restante ÷ dias restantes, no mínimo o efetivo mínimo).
//
// Cobertura e hora extra
// A preferência de período e a faixa são só ponto de partida e desempate: em cada dia, se um
// turno fica abaixo do efetivo mínimo ou do mínimo de uma função, qualquer pessoa disponível
// que caiba nas regras rígidas entra (a função que falta primeiro). Quem cobre função ou
// efetivo mínimo com poucas pessoas tem as folgas escalonadas, para não esvaziar os mesmos
// dias. O que ainda sobrar vira hora extra (`permitirHoraExtra` e `jornadaContratualMin`):
// quem já trabalha no dia em outro turno tem a jornada estendida (quem abre fica mais tempo,
// quem fecha chega antes; até 2h extras e 10h no dia, com descanso de 11h) ou entra no turno
// inteiro quem só não cabe pelo limite semanal (o excedente é a hora extra). Folgas semanais,
// dias consecutivos, descanso e ausências nunca são quebrados. Escolhe-se quem deixa menos
// tempo descoberto e, empatando, quem tem menos hora extra no período e menor saldo. A faixa que
// mesmo assim ficar sem cobertura gera `coberturaParcial`; sem nenhuma alternativa, os avisos
// `coberturaInsuficiente` e `funcaoDescoberta`. A hora extra vira saldo positivo e não é
// desfeita na própria semana: é compensada nas semanas seguintes.
//
// Saldo de horas
// Cada semana fechada (sem dias em mês ainda não gerado) tem horas previstas. O saldo de meses
// anteriores e o que sobrar ou faltar na semana são compensados dentro das regras: com horas a
// mais, a pessoa ganha uma folga a mais na semana ou sai mais cedo (até 2h, nunca abaixo de
// 4h); devendo, ganha uma jornada a mais se o limite e as folgas deixarem, ou fica até mais
// tarde / chega mais cedo dentro do horário de funcionamento (passos de 15 min), sem passar da
// jornada diária máxima nem do limite semanal e respeitando o descanso. Acima de 6h o
// intervalo passa a 1h.
//
// Funções
// Com mínimo por função (ex.: 1 cozinheiro e 1 atendente em cada turno), cada função é
// espalhada pelas faixas antes da preferência de período; em cada dia, quem cobre a função
// entra antes dos demais e, se ainda faltar, alguém da função com saldo semanal é chamado
// (mesmo de outra faixa). Sem ninguém, a semana gera um aviso de função descoberta.
//
// Horários
// Quem pode fazer mais de um turno recebe uma faixa do dia (abertura, fechamento, ...) para o
// período inteiro, igual em todos os dias: na loja que abre das 10h às 22h com jornada de 6h,
// metade da equipe abre e metade fecha. As faixas ficam com o mesmo número de pessoas; a faixa
// do mês anterior e a preferência de período são atendidas enquanto houver vaga.

import { type Semana, semanasCobrindo } from "./calendario";
import { type DataISO, diaDaSemana, diasDesdeEra, diasEntre, ehValida, formatarDataBR, formatarDiaMes, somarDias } from "./data";
import { ErroMotor } from "./erros";
import { distanciaPeriodo, intervaloPadrao, type Periodo, periodoDeInicio } from "./funcionamento";
import { duracaoTotal, formatarHora, formatarHorario, formatarMinutos, type Horario, MINUTOS_DIA, minutosTrabalhados, tentarCriarHorario } from "./hora";
import { contarPosicoes, corridaDaSemana, escolhas, type MascaraSemana, posicoes } from "./folgas";
import { fimAbsoluto, IndiceAlocacoes, inicioAbsoluto } from "./indice";
import {
  type Alocacao,
  type Aviso,
  chaveFuncao,
  contemDia,
  descansoSemanalMin,
  type DiasSemana,
  disponivelEm,
  type FuncaoMinima,
  type FuncionarioPlano,
  horaExtraAtiva,
  horaExtraSemanalMax,
  horarioDoFuncionario,
  intervaloDoFuncionario,
  jornadaMaxComExtraMin,
  minutosDaAlocacao,
  minutosExtras,
  type OrigemAlocacao,
  NENHUM_DIA,
  type RegrasCarga,
  TIPOS_AVISO,
  type Turno,
  turnoFuncionaEm,
  uniaoDias,
  validarRegras,
} from "./modelo";
import { diasTrabalhoMax, type EtapaRegime, type LimitesSemana, limiteDoFuncionario, limitesDoFuncionarioNaSemana } from "./regime";
import { jornadaDeReferencia, type OpcoesPrevisto, previstoDaSemana } from "./saldo";

/** Maior período aceito em uma geração. */
export const MAX_DIAS_PERIODO = 366;

/** Passo dos ajustes de horário na compensação de saldo. */
const PASSO_AJUSTE_MIN = 15;
/** Quanto uma jornada pode encolher na compensação de horas a mais. */
const MAX_ENCURTAR_MIN = 2 * 60;
/** Jornada mínima depois de encurtada. */
const JORNADA_MIN_ENCURTADA = 4 * 60;
/** Semanas olhadas para trás ao decidir quem folga no domingo. */
const SEMANAS_HISTORICO_DOMINGO = 8;
/** Semanas olhadas para trás ao contar sábados e domingos livres de cada pessoa. */
const SEMANAS_EQUIDADE = 13;
/** Semanas à frente olhadas ao planejar folgas (dias consecutivos e domingos de rodízio). */
const SEMANAS_ANTECIPADAS = 3;
/** Pesos do planejamento de folgas (menor custo vence). */
const PESO_DIA_PERDIDO = 5;
const PESO_FURO = 50;
const PESO_EQUILIBRIO = 3;
const PESO_BLOCO = 1.25;
const PESO_COLADA = 0.2;
const PESO_FIM_DE_SEMANA = 2;
const PREFERENCIA_SABADO = 1.25;

/** Tudo o que o motor precisa para gerar a escala de um período. */
export interface EntradaPlanejamento {
  /** Primeiro dia do período (inclusive). */
  inicio: DataISO;
  /** Último dia do período (inclusive). */
  fim: DataISO;
  regras: RegrasCarga;
  turnos: Turno[];
  funcionarios: FuncionarioPlano[];
  /** Alocações já existentes fora do período (meses vizinhos): contam para os limites, mas não mudam. */
  alocacoesFixas: Alocacao[];
  /**
   * Jornadas dentro do período que ficam como estão (ajustes feitos à mão ao reequilibrar o
   * resto do mês): contam para limites, folgas e cobertura, não são mexidas na compensação e
   * não voltam no resultado.
   */
  alocacoesTravadas: Alocacao[];
  /**
   * Datas fora do período cujo planejamento está fechado (meses já gerados). Datas da semana
   * fora do período e fora deste conjunto estão "em aberto" e recebem parte proporcional da carga-alvo.
   */
  datasPlanejadas: Set<DataISO>;
  /** Regime legal com vigência por data (vazio = só as regras da empresa). */
  regime: EtapaRegime[];
  /** Mínimo de pessoas de cada função (chave de `chaveFuncao`) em cada turno de cada dia. */
  minimoPorFuncao: Map<string, FuncaoMinima>;
  /**
   * Dias em que o estabelecimento não abre (feriado, inventário): ninguém é escalado, o
   * mínimo não se aplica e o dia não conta como aberto no previsto da semana.
   */
  diasFechados?: Set<DataISO>;
}

/** Horas previstas de uma semana fechada, já descontadas as folgas que o motor não pôde evitar. */
export interface PrevistoDaSemana {
  funcionarioId: string;
  /** Primeiro dia da semana de apuração. */
  inicioSemana: DataISO;
  previstoMin: number;
}

export interface ResultadoPlanejamento {
  /** Alocações do período, ordenadas por data, turno e funcionário. */
  alocacoes: Alocacao[];
  avisos: Aviso[];
  /**
   * Previsto das semanas fechadas pela geração. Difere do `previstoDaSemana` puro quando o
   * máximo de dias consecutivos obriga uma folga a mais (ex.: domingo do rodízio logo depois de
   * um domingo trabalhado): gravar estes valores (`previstosGravados` do resumo semanal) evita
   * que essa folga estrutural vire saldo negativo a compensar.
   */
  previstos: PrevistoDaSemana[];
}

/** Gera a escala do período respeitando as restrições rígidas descritas no topo do módulo. */
export function gerarEscala(entrada: EntradaPlanejamento): ResultadoPlanejamento {
  validar(entrada);
  const motor = new Motor(entrada);
  for (const semana of semanasCobrindo(entrada.inicio, entrada.fim, entrada.regras.inicioSemana)) {
    motor.planejarSemana(semana);
  }
  return motor.concluir();
}

function validar(entrada: EntradaPlanejamento): void {
  const { inicio, fim } = entrada;
  if (!ehValida(inicio) || !ehValida(fim) || fim < inicio) {
    throw new ErroMotor("periodoInvalido", `Período inválido: ${inicio} a ${fim}.`);
  }
  const dias = diasEntre(inicio, fim) + 1;
  if (dias > MAX_DIAS_PERIODO) {
    throw new ErroMotor("periodoLongo", `O período de ${dias} dias excede o máximo de ${MAX_DIAS_PERIODO} dias.`);
  }
  validarRegras(entrada.regras);
  const turnos = new Set<string>();
  for (const t of entrada.turnos) {
    if (turnos.has(t.id)) throw new ErroMotor("turnoDuplicado", `Turno ${t.id} informado mais de uma vez.`);
    turnos.add(t.id);
  }
  const funcionarios = new Set<string>();
  for (const f of entrada.funcionarios) {
    if (funcionarios.has(f.id)) throw new ErroMotor("funcionarioDuplicado", `Funcionário ${f.id} informado mais de uma vez.`);
    funcionarios.add(f.id);
  }
  const fixa = entrada.alocacoesFixas.find((a) => inicio <= a.data && a.data <= fim);
  if (fixa) throw new ErroMotor("fixaDentroDoPeriodo", `A alocação fixa de ${formatarDataBR(fixa.data)} está dentro do período a gerar.`);
  const travada = entrada.alocacoesTravadas.find((a) => a.data < inicio || a.data > fim);
  if (travada) throw new ErroMotor("travadaForaDoPeriodo", `A jornada travada de ${formatarDataBR(travada.data)} está fora do período a gerar.`);
}

// ---------------------------------------------------------------------------
// Utilitários de comparação (semântica de min/max_by_key: primeiro mínimo, último máximo)
// ---------------------------------------------------------------------------

type Chave = readonly number[];

function compararChaves(a: Chave, b: Chave): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Item de menor chave; no empate, o primeiro. */
function minPor<T>(itens: readonly T[], chave: (t: T) => Chave): T | undefined {
  let melhor: T | undefined;
  let chaveMelhor: Chave = [];
  for (const item of itens) {
    const c = chave(item);
    if (melhor === undefined || compararChaves(c, chaveMelhor) < 0) {
      melhor = item;
      chaveMelhor = c;
    }
  }
  return melhor;
}

/** Item de maior chave; no empate, o último. */
function maxPor<T>(itens: readonly T[], chave: (t: T) => Chave): T | undefined {
  let melhor: T | undefined;
  let chaveMelhor: Chave = [];
  for (const item of itens) {
    const c = chave(item);
    if (melhor === undefined || compararChaves(c, chaveMelhor) >= 0) {
      melhor = item;
      chaveMelhor = c;
    }
  }
  return melhor;
}

const bit = (b: boolean): number => (b ? 1 : 0);

/** `valor * parte / todo`, arredondado para baixo. */
function proporcional(valor: number, parte: number, todo: number): number {
  return todo === 0 ? 0 : Math.floor((valor * parte) / todo);
}

function compararTexto(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Estruturas internas
// ---------------------------------------------------------------------------

/** Turno em que a pessoa pode trabalhar, com o horário dele. */
interface Opcao {
  turnoId: string;
  horario: Horario;
}

/** Funcionário apto a ser escalado, com os turnos que cabem na jornada diária. */
interface Apto {
  func: FuncionarioPlano;
  /** Chave normalizada da função (`chaveFuncao`), se houver. */
  funcao: string | undefined;
  opcoes: Opcao[];
  /** Duração de referência de uma jornada, para converter minutos em turnos. */
  duracaoRef: number;
  duracaoMin: number;
  /** Posição na ordem de ids (desempate e rodízio). */
  posicao: number;
  /** Dias da semana em que ao menos um dos turnos funciona. */
  diasTurnos: DiasSemana;
  /** Faixa do dia no período (0 = a que abre); `null` com um turno só. */
  faixa: number | null;
  /** Posição no rodízio de domingos, contada dentro do grupo (faixa, turno único, função). */
  rodizioDomingo: number;
}

/** Candidato a trabalhar em um dia, com sua urgência. */
interface Candidato {
  indice: number;
  /** Minutos que faltam para a carga-alvo da semana. */
  faltaMin: number;
  duracaoRef: number;
  /** Dias restantes da semana (no período) em que ainda pode trabalhar. */
  diasPossiveis: number;
  /** Precisa trabalhar todos os dias restantes para chegar ao alvo. */
  obrigatorio: boolean;
}

function turnosFaltando(c: Candidato): number {
  return c.faltaMin / Math.max(c.duracaoRef, 1);
}

/** Compara a pressão (turnos que faltam ÷ dias possíveis) sem ponto flutuante. */
function compararPressao(a: Candidato, b: Candidato): number {
  const esquerda = a.faltaMin * b.duracaoRef * b.diasPossiveis;
  const direita = b.faltaMin * a.duracaoRef * a.diasPossiveis;
  return esquerda - direita;
}

/**
 * Vagas por faixa: cada faixa tem uma base (pessoas × peso ÷ soma dos pesos, para baixo) e as
 * sobras podem ir para qualquer faixa. Com pesos iguais, as faixas ficam com o mesmo número de
 * pessoas (diferença máxima de 1); com pesos diferentes (efetivos mínimos diferentes), a
 * cobertura mínima de cada faixa manda no balanceamento.
 */
class Vagas {
  private readonly bases: number[];
  private extras: number;
  private readonly ocupadas: number[];

  constructor(pessoas: number, faixas: number, pesos: readonly number[] = []) {
    const k = Math.max(faixas, 1);
    const p = Array.from({ length: k }, (_, c) => Math.max(pesos[c] ?? 1, 1));
    const total = p.reduce((a, b) => a + b, 0);
    this.bases = p.map((w) => Math.floor((pessoas * w) / total));
    this.extras = pessoas - this.bases.reduce((a, b) => a + b, 0);
    this.ocupadas = new Array<number>(k).fill(0);
  }

  carga(faixa: number): number {
    return this.ocupadas[faixa] ?? Number.MAX_SAFE_INTEGER;
  }

  cabe(faixa: number): boolean {
    const n = this.carga(faixa);
    const base = this.bases[faixa] ?? 0;
    return n < base || (n === base && this.extras > 0);
  }

  ocupar(faixa: number): void {
    const n = this.ocupadas[faixa];
    if (n === undefined) return;
    if (n >= (this.bases[faixa] ?? 0)) this.extras = Math.max(0, this.extras - 1);
    this.ocupadas[faixa] = n + 1;
  }
}

// ---------------------------------------------------------------------------
// O motor
// ---------------------------------------------------------------------------

class Motor {
  private readonly turnos: Turno[];
  private readonly ordemDoTurno = new Map<string, number>();
  private readonly diasDoTurno = new Map<string, DiasSemana>();
  private readonly aptos: Apto[] = [];
  private readonly agenda = new IndiceAlocacoes();
  private readonly novas: Alocacao[] = [];
  private readonly avisos: Aviso[] = [];
  private readonly minutosNoPeriodo = new Map<string, number>();
  private readonly turnosSemEquipe = new Set<string>();
  /** Maior número de turnos num mesmo dia da semana (= número de faixas). */
  private readonly faixas: number;
  /** Saldo de horas de cada funcionário até a última semana fechada (minutos). */
  private readonly saldos = new Map<string, number>();
  /** Funcionamento por dia da semana (0 = segunda): do primeiro início ao último fim dos turnos do dia. */
  private readonly janelas: Array<[number, number] | null> = [];
  /** Funções abaixo do mínimo num turno na semana em curso, com os dias. */
  private funcoesDescobertas = new Map<string, { funcao: string; turnoId: string; dias: DataISO[] }>();
  /** Mínimos por função (chave normalizada), só os maiores que zero, em ordem de chave. */
  private readonly minimos: Array<{
    funcao: string;
    nome: string;
    minimo: number;
  }>;
  private readonly cacheLimites = new Map<string, LimitesSemana>();
  /** Hora extra como último recurso está ligada. */
  private readonly horaExtra: boolean;
  /** Jornadas estendidas para cobrir outro turno: `funcionario|data` → turno coberto. */
  private readonly extensoes = new Map<string, string>();
  /** Minutos de hora extra de cada jornada com origem `horaExtra`: `funcionario|data` → minutos. */
  private readonly extraPorAloc = new Map<string, number>();
  /** Hora extra acumulada no período por funcionário (minutos). */
  private readonly extraNoPeriodo = new Map<string, number>();
  /** Semanas de apuração do período, em ordem. */
  private readonly semanasDoPeriodo: Semana[];
  /** Sobra fracionária da cota de sábados / domingos livres de cada grupo, de uma semana para a outra. */
  private readonly sobraSabado = new Map<string, number>();
  private readonly sobraDomingo = new Map<string, number>();
  /** Folgas planejadas da semana em curso, por funcionário (índice em `aptos`). */
  private folgasPlanejadas = new Map<number, Set<DataISO>>();
  /** Previsto (minutos) da semana fechada, por `funcionario|inicioDaSemana`, depois das folgas forçadas. */
  readonly previstos = new Map<string, number>();
  /** Funcionários da entrada por id (inclusive os sem turno possível), para a hora não trabalhada. */
  private readonly funcPorId = new Map<string, FuncionarioPlano>();

  constructor(private readonly entrada: EntradaPlanejamento) {
    const regras = entrada.regras;
    this.horaExtra = horaExtraAtiva(regras);
    this.semanasDoPeriodo = semanasCobrindo(entrada.inicio, entrada.fim, regras.inicioSemana);
    this.turnos = [...entrada.turnos].sort((a, b) => a.ordem - b.ordem || compararTexto(a.id, b.id));
    this.turnos.forEach((t, i) => {
      this.ordemDoTurno.set(t.id, i);
      this.diasDoTurno.set(t.id, t.dias);
    });

    this.minimos = [...entrada.minimoPorFuncao.entries()]
      .map(([chave, m]) => ({
        funcao: chaveFuncao(chave),
        nome: m.nome,
        minimo: m.minimo,
      }))
      .filter((m) => m.minimo > 0)
      .sort((a, b) => compararTexto(a.funcao, b.funcao));

    // Turnos que cabem na jornada diária; os demais são ignorados, com um aviso cada.
    const turnosValidos: Turno[] = [];
    for (const t of this.turnos) {
      if (minutosTrabalhados(t.horario) > regras.jornadaDiariaMaxMin) {
        this.avisos.push({
          tipo: "turnoExcedeJornada",
          turnoId: t.id,
          mensagem: `O turno ${t.nome} (${formatarHorario(t.horario)}) soma ${formatarMinutos(minutosTrabalhados(t.horario))} e excede a jornada diária máxima de ${formatarMinutos(
            regras.jornadaDiariaMaxMin,
          )}; turno ignorado.`,
        });
      } else {
        turnosValidos.push(t);
      }
    }

    const ordenados = [...entrada.funcionarios].sort((a, b) => compararTexto(a.id, b.id));
    for (const func of ordenados) this.funcPorId.set(func.id, func);
    for (const func of ordenados) {
      // Quem tem hora não trabalhada própria cumpre o mesmo horário com o almoço dela: os
      // minutos do dia mudam, e um turno em que o almoço dela não cabe não serve para ela.
      const possiveis = turnosValidos.filter((t) => {
        const h = horarioDoFuncionario(func, t.horario);
        if (h === null) return false;
        const m = minutosTrabalhados(h);
        return m > 0 && m <= regras.jornadaDiariaMaxMin;
      });
      const opcoes: Opcao[] = possiveis.map((t) => ({ turnoId: t.id, horario: horarioDoFuncionario(func, t.horario) ?? t.horario }));
      if (opcoes.length === 0) {
        this.avisos.push({
          tipo: "funcionarioSemTurno",
          funcionarioId: func.id,
          mensagem: `${func.nome} não tem turno possível e não foi escalado.`,
        });
        continue;
      }
      this.aptos.push({
        func,
        funcao: func.funcao === undefined ? undefined : chaveFuncao(func.funcao),
        opcoes,
        duracaoRef: Math.max(jornadaDeReferencia(possiveis, regras.jornadaDiariaMaxMin, func) ?? 1, 1),
        duracaoMin: Math.max(Math.min(...opcoes.map((o) => minutosTrabalhados(o.horario))), 1),
        diasTurnos: opcoes.reduce((acc, o) => uniaoDias(acc, this.diasDoTurno.get(o.turnoId) ?? NENHUM_DIA), NENHUM_DIA),
        posicao: this.aptos.length,
        faixa: null,
        rodizioDomingo: 0,
      });
    }

    // Turnos com efetivo mínimo mas sem ninguém habilitado: um aviso só, em vez de um por dia.
    for (const t of this.turnos) {
      const temEquipe = this.aptos.some((a) => a.opcoes.some((o) => o.turnoId === t.id));
      if (t.efetivoMinimo > 0 && !temEquipe) {
        this.turnosSemEquipe.add(t.id);
        this.avisos.push({
          tipo: "coberturaInsuficiente",
          turnoId: t.id,
          mensagem: `O turno ${t.nome} não tem funcionários habilitados; o efetivo mínimo de ${t.efetivoMinimo} pessoa(s) não será atendido.`,
        });
      }
    }

    for (const a of [...entrada.alocacoesFixas, ...entrada.alocacoesTravadas]) this.agenda.inserir(a);

    this.faixas = Math.max(0, ...[0, 1, 2, 3, 4, 5, 6].map((d) => this.turnos.filter((t) => contemDia(t.dias, d)).length));
    for (const a of this.aptos) this.saldos.set(a.func.id, a.func.saldoAnteriorMin);
    for (let d = 0; d < 7; d++) {
      let janela: [number, number] | null = null;
      for (const t of this.turnos) {
        if (!contemDia(t.dias, d)) continue;
        const ini = t.horario.inicioMin;
        const fim = ini + duracaoTotal(t.horario);
        janela = janela === null ? [ini, fim] : [Math.min(janela[0], ini), Math.max(janela[1], fim)];
      }
      this.janelas.push(janela);
    }

    this.atribuirFaixas();
    this.distribuirRodizioDomingo();
    this.avisarContratoParcial();
  }

  // ------------------------------------------------------------------ faixas e rodízio

  /**
   * Quem pode fazer mais de um turno recebe uma faixa do dia (0 = a que abre) para o período
   * inteiro, para não trocar de horário a cada dia. As faixas ficam com o mesmo número de
   * pessoas (diferença máxima de 1). Primeiro fica quem mantém a faixa do mês anterior (se
   * combina com a preferência), depois quem tem preferência de período, e os demais vão para
   * as faixas com vaga, o mais perto possível do período preferido.
   */
  private atribuirFaixas(): void {
    const k = this.faixas;
    const flexiveis = this.aptos.map((_, i) => i).filter((i) => (this.aptos[i]?.opcoes.length ?? 0) > 1);
    if (k < 2 || flexiveis.length === 0) return;

    // Período de cada faixa, pelos turnos do dia da semana com mais turnos (o primeiro em empate).
    let diaCheio = 0;
    let maior = -1;
    for (let d = 0; d < 7; d++) {
      const n = this.turnos.filter((t) => contemDia(t.dias, d)).length;
      if (n > maior) {
        maior = n;
        diaCheio = d;
      }
    }
    const doDia = this.turnos
      .filter((t) => contemDia(t.dias, diaCheio))
      .sort((a, b) => a.horario.inicioMin - b.horario.inicioMin || a.ordem - b.ordem || compararTexto(a.id, b.id));
    const periodos: Periodo[] = doDia.map((t) => periodoDeInicio(t.horario.inicioMin));
    const distancia = (preferencia: Periodo | undefined, faixa: number): number => {
      const p = periodos[faixa];
      return preferencia !== undefined && p !== undefined ? distanciaPeriodo(preferencia, p) : 0;
    };
    const preferenciaDe = (i: number): Periodo | undefined => this.aptos[i]?.func.preferencia;

    const vagas = new Vagas(
      flexiveis.length,
      k,
      doDia.map((t) => t.efetivoMinimo),
    );
    const escolha: Array<number | null> = new Array<number | null>(this.aptos.length).fill(null);

    // Funções com mínimo vêm antes da preferência: cada faixa recebe as pessoas da função que a
    // cobertura diária pede (mínimo × 7 dias ÷ 5 dias de trabalho, ou o que a função tiver),
    // escolhendo primeiro quem prefere aquele período. O resto segue a preferência.
    const grupos = new Map<string, number[]>();
    for (const i of flexiveis) {
      const f = this.funcaoComMinimo(i);
      if (f !== undefined) grupos.set(f, [...(grupos.get(f) ?? []), i]);
    }
    for (const funcao of [...grupos.keys()].sort(compararTexto)) {
      let livres = grupos.get(funcao) ?? [];
      const minimo = this.minimos.find((m) => m.funcao === funcao)?.minimo ?? 0;
      const porFaixa = Math.min(Math.floor(livres.length / k), Math.ceil((minimo * 7) / 5));
      for (let rodada = 0; rodada < porFaixa; rodada++) {
        for (let c = 0; c < k; c++) {
          if (!vagas.cabe(c)) continue;
          // Quanto a pessoa perde indo para esta faixa em vez da melhor para ela.
          const perda = (i: number): number => {
            const preferencia = preferenciaDe(i);
            const melhor = Math.min(...Array.from({ length: k }, (_, x) => distancia(preferencia, x)));
            return distancia(preferencia, c) - melhor;
          };
          const melhor = minPor(livres, (i) => [perda(i), bit(preferenciaDe(i) === undefined), bit(this.faixaAnterior(i) !== c), i]);
          if (melhor !== undefined) {
            vagas.ocupar(c);
            escolha[melhor] = c;
            livres = livres.filter((x) => x !== melhor);
          }
        }
      }
    }
    for (const i of flexiveis) {
      if (escolha[i] !== null) continue;
      const c = this.faixaAnterior(i);
      if (c !== null && distancia(preferenciaDe(i), c) === 0 && vagas.cabe(c)) {
        vagas.ocupar(c);
        escolha[i] = c;
      }
    }
    for (const i of flexiveis) {
      const p = preferenciaDe(i);
      if (p === undefined || escolha[i] !== null) continue;
      const candidatas = Array.from({ length: k }, (_, c) => c).filter((c) => periodos[c] === p && vagas.cabe(c));
      const c = minPor(candidatas, (x) => [vagas.carga(x), x]);
      if (c !== undefined) {
        vagas.ocupar(c);
        escolha[i] = c;
      }
    }
    // Quem tem preferência e ficou sem vaga escolhe antes de quem não tem.
    const restantes = flexiveis
      .filter((i) => escolha[i] === null)
      .sort((a, b) => bit(preferenciaDe(a) === undefined) - bit(preferenciaDe(b) === undefined) || a - b);
    for (const i of restantes) {
      const preferencia = preferenciaDe(i);
      const candidatas = Array.from({ length: k }, (_, c) => c).filter((c) => vagas.cabe(c));
      const c = minPor(candidatas, (x) => [distancia(preferencia, x), vagas.carga(x), x]);
      if (c !== undefined) {
        vagas.ocupar(c);
        escolha[i] = c;
      }
    }
    this.aptos.forEach((apto, i) => {
      apto.faixa = escolha[i] ?? null;
    });
  }

  /** Numera as pessoas de cada faixa e função (e as de turno único, por turno) para o rodízio de domingos. */
  private distribuirRodizioDomingo(): void {
    const contagem = new Map<string, number>();
    for (const apto of this.aptos) {
      const unico = apto.opcoes.length === 1 ? (apto.opcoes[0]?.turnoId ?? "") : "";
      const chave = `${apto.faixa ?? "-"}|${unico}|${apto.funcao ?? ""}`;
      const n = contagem.get(chave) ?? 0;
      apto.rodizioDomingo = n;
      contagem.set(chave, n + 1);
    }
  }

  /** Função do funcionário, se ela tem mínimo por turno. */
  private funcaoComMinimo(indice: number): string | undefined {
    const f = this.aptos[indice]?.funcao;
    return f !== undefined && this.minimos.some((m) => m.funcao === f) ? f : undefined;
  }

  /** Pessoas da função escaladas no turno no dia. */
  private daFuncaoNoTurno(funcao: string, turnoId: string, dia: DataISO): number {
    return this.aptos.filter((a) => a.funcao === funcao && this.agenda.em(a.func.id, dia)?.turnoId === turnoId).length;
  }

  // ------------------------------------------------------------------ consultas

  private limites(apto: Apto, semana: Semana): LimitesSemana {
    const chave = `${apto.func.isentoRegime ? 1 : 0}|${semana.inicio}`;
    let l = this.cacheLimites.get(chave);
    if (!l) {
      l = limitesDoFuncionarioNaSemana(apto.func, this.entrada.regras, this.entrada.regime, semana);
      this.cacheLimites.set(chave, l);
    }
    return l;
  }

  private noPeriodo(data: DataISO): boolean {
    return this.entrada.inicio <= data && data <= this.entrada.fim;
  }

  private podeTrabalharEm(apto: Apto, data: DataISO): boolean {
    return disponivelEm(apto.func, data) && contemDia(apto.diasTurnos, diaDaSemana(data)) && !this.fechado(data);
  }

  /** Dia em que o estabelecimento não abre (feriado, inventário). */
  private fechado(data: DataISO): boolean {
    return this.entrada.diasFechados?.has(data) ?? false;
  }

  /** Pode ser escalado pela distribuição normal: disponível e fora da folga dominical programada. */
  private livreEm(indice: number, dia: DataISO): boolean {
    const apto = this.aptos[indice];
    return apto !== undefined && this.podeTrabalharEm(apto, dia) && !this.folgaDominical(indice, dia);
  }

  /**
   * Domingo de folga programado. Com no máximo `k` domingos seguidos, cada pessoa folga um
   * domingo a cada `k + 1`, em rodízio escalonado: sem isso, a equipe inteira chegaria ao
   * limite no mesmo domingo e ele ficaria vazio.
   */
  private folgaDominical(indice: number, dia: DataISO): boolean {
    const k = this.entrada.regras.domingosSeguidosMax;
    if (k === 0 || diaDaSemana(dia) !== 6) return false;
    const ciclo = k + 1;
    const semana = Math.floor(diasDesdeEra(dia) / 7);
    const posicao = this.aptos[indice]?.rodizioDomingo ?? 0;
    return (semana + posicao) % ciclo === 0;
  }

  /** Ajustes do previsto da pessoa na semana: dias fechados e domingos de folga do rodízio. */
  private opcoesPrevisto(indice: number, semana: Semana, jornadasAMenos = 0): OpcoesPrevisto {
    const diasDeFolga = new Set(semana.dias().filter((d) => this.folgaDominical(indice, d)));
    return { diasFechados: this.entrada.diasFechados, diasDeFolga, jornadasAMenos };
  }

  /** Faixa do último turno antes do período (até 7 dias antes), se houver. */
  private faixaAnterior(indice: number): number | null {
    const apto = this.aptos[indice];
    if (!apto) return null;
    const anterior = this.agenda.anterior(apto.func.id, this.entrada.inicio);
    if (!anterior || diasEntre(anterior.data, this.entrada.inicio) > 7) return null;
    const doDia = this.opcoesOrdenadas(indice, anterior.data);
    const posicao = doDia.findIndex((o) => o.turnoId === anterior.turnoId);
    if (posicao < 0) return null;
    // Menor faixa que cai nessa posição (ver `opcoesDoDia`).
    const faixa = Math.ceil((posicao * this.faixas) / doDia.length);
    return faixa < this.faixas ? faixa : null;
  }

  /** Opções do funcionário que funcionam no dia, da que começa mais cedo à mais tarde. */
  private opcoesOrdenadas(indice: number, dia: DataISO): Opcao[] {
    const apto = this.aptos[indice];
    if (!apto) return [];
    return apto.opcoes
      .filter((o) => this.turnoFunciona(o.turnoId, dia))
      .sort((a, b) => a.horario.inicioMin - b.horario.inicioMin || this.ordemTurno(a.turnoId) - this.ordemTurno(b.turnoId));
  }

  /**
   * Opções do funcionário que funcionam no dia: o turno da sua faixa (na mesma posição
   * proporcional entre os turnos do dia); sem faixa, ou com `todas`, qualquer uma que funcione.
   */
  private opcoesDoDia(indice: number, dia: DataISO, todas: boolean): Opcao[] {
    const apto = this.aptos[indice];
    if (!apto) return [];
    if (apto.faixa !== null && !todas) {
      const doDia = this.opcoesOrdenadas(indice, dia);
      const o = doDia[Math.floor((apto.faixa * doDia.length) / Math.max(this.faixas, 1))];
      if (o) return [o];
    }
    return apto.opcoes.filter((o) => this.turnoFunciona(o.turnoId, dia));
  }

  /** O turno funciona no dia da semana de `dia` (turno desconhecido nunca funciona). */
  private turnoFunciona(turnoId: string, dia: DataISO): boolean {
    const dias = this.diasDoTurno.get(turnoId);
    return dias !== undefined && contemDia(dias, diaDaSemana(dia));
  }

  private ordemTurno(turnoId: string): number {
    return this.ordemDoTurno.get(turnoId) ?? Number.MAX_SAFE_INTEGER;
  }

  private minutosPeriodo(indice: number): number {
    const apto = this.aptos[indice];
    return apto ? (this.minutosNoPeriodo.get(apto.func.id) ?? 0) : 0;
  }

  private minutosNovosNaSemana(funcionarioId: string, semana: Semana): number {
    let total = 0;
    for (const a of this.novas) {
      if (a.funcionarioId === funcionarioId && semana.contem(a.data)) total += minutosDaAlocacao(a);
    }
    return total;
  }

  /** Horário em que trabalhou por último (até 7 dias antes) ou, sem histórico recente, o primeiro turno. */
  private turnoPreferido(indice: number, dia: DataISO): string | undefined {
    const apto = this.aptos[indice];
    if (!apto) return undefined;
    const anterior = this.agenda.anterior(apto.func.id, dia);
    const recente = anterior && diasEntre(anterior.data, dia) <= 7 && apto.opcoes.some((o) => o.turnoId === anterior.turnoId) ? anterior.turnoId : undefined;
    return recente ?? apto.opcoes[0]?.turnoId;
  }

  /** Opções do funcionário que respeitam todas as restrições rígidas no dia. */
  private opcoesElegiveis(indice: number, dia: DataISO, semana: Semana, todas: boolean, ignorarLimiteSemanal = false): Opcao[] {
    const apto = this.aptos[indice];
    if (!apto) return [];
    const id = apto.func.id;
    const regras = this.entrada.regras;
    if (!this.noPeriodo(dia) || !this.podeTrabalharEm(apto, dia) || this.agenda.em(id, dia)) return [];
    const seguidos = this.agenda.diasSeguidosAntes(id, dia) + 1 + this.agenda.diasSeguidosDepois(id, dia);
    if (seguidos > regras.maxDiasConsecutivos) return [];
    const limites = this.limites(apto, semana);
    if (this.agenda.diasNaSemana(id, semana) + 1 > diasTrabalhoMax(limites)) return [];
    if (regras.domingosSeguidosMax > 0 && diaDaSemana(dia) === 6) {
      const [antes, depois] = this.agenda.mesmosDiasSeguidos(id, dia);
      if (antes + 1 + depois > regras.domingosSeguidosMax) return [];
    }
    const limiteSemanal = limiteDoFuncionario(apto.func, limites);
    const usado = this.agenda.minutosNaSemana(id, semana);
    const anterior = this.agenda.anterior(id, dia);
    const seguinte = this.agenda.seguinte(id, dia);

    return this.opcoesDoDia(indice, dia, todas).filter((o) => {
      const candidata: Alocacao = {
        funcionarioId: id,
        turnoId: o.turnoId,
        data: dia,
        horario: o.horario,
      };
      const trabalhado = minutosDaAlocacao(candidata);
      return (
        (ignorarLimiteSemanal || usado + trabalhado <= limiteSemanal) &&
        trabalhado <= regras.jornadaDiariaMaxMin &&
        this.respeitaDescansos(candidata, anterior, seguinte)
      );
    });
  }

  /**
   * Descanso entre a jornada e as vizinhas: o de entre jornadas (11h) e, quando há um dia de
   * folga no meio, o descanso semanal (35h = 24h de repouso + 11h, CLT arts. 66 e 67).
   */
  private respeitaDescansos(c: Alocacao, anterior: Alocacao | undefined, seguinte: Alocacao | undefined): boolean {
    const regras = this.entrada.regras;
    const semanal = descansoSemanalMin(regras);
    const exigido = (dias: number): number => (dias > 1 ? Math.max(semanal, regras.descansoEntreJornadasMin) : regras.descansoEntreJornadasMin);
    return (
      (!anterior || inicioAbsoluto(c) - fimAbsoluto(anterior) >= exigido(diasEntre(anterior.data, c.data))) &&
      (!seguinte || inicioAbsoluto(seguinte) - fimAbsoluto(c) >= exigido(diasEntre(c.data, seguinte.data)))
    );
  }

  private alocar(indice: number, dia: DataISO, opcao: Opcao, origem: OrigemAlocacao = "normal"): void {
    const apto = this.aptos[indice];
    if (!apto) return;
    const alocacao: Alocacao = {
      funcionarioId: apto.func.id,
      turnoId: opcao.turnoId,
      data: dia,
      horario: opcao.horario,
      origem,
    };
    this.minutosNoPeriodo.set(apto.func.id, (this.minutosNoPeriodo.get(apto.func.id) ?? 0) + minutosDaAlocacao(alocacao));
    this.agenda.inserir(alocacao);
    this.novas.push(alocacao);
  }

  // ------------------------------------------------------------------ planejamento da semana

  planejarSemana(semana: Semana): void {
    const dias = semana.dias().filter((d) => this.noPeriodo(d));
    if (dias.length === 0) return;

    // Carga-alvo de cada funcionário nesta semana (dentro do período).
    const alvos: Array<{ alvo: number; disponiveis: number }> = [];
    // Horas previstas da semana inteira e se ela fecha nesta geração.
    const fechamento: Array<{ previsto: number; fechada: boolean }> = [];
    this.aptos.forEach((apto, indice) => {
      const id = apto.func.id;
      const dur = apto.duracaoRef;
      const limites = this.limites(apto, semana);
      const fixos = this.agenda.minutosNaSemana(id, semana);
      const teto = Math.max(0, limiteDoFuncionario(apto.func, limites) - fixos);
      // Alvo em jornadas inteiras (turnos de 7h20 e teto de 40h: 36h40), nunca mais jornadas
      // do que os dias que as folgas mínimas deixam livres.
      const diasLivres = Math.max(0, diasTrabalhoMax(limites) - this.agenda.diasNaSemana(id, semana));
      const tetoInteiro = Math.min(Math.floor(teto / dur), diasLivres) * dur;
      // O previsto da semana (ausências justificadas abonadas) menos o que já está feito nos
      // meses vizinhos, em jornadas inteiras.
      const previsto = previstoDaSemana(apto.func, this.entrada.turnos, limites, semana, dur, this.opcoesPrevisto(indice, semana));
      let base = Math.min(Math.floor((Math.max(0, previsto - fixos) + Math.floor(dur / 2)) / dur) * dur, tetoInteiro);
      const disponiveis = dias.filter((d) => this.livreEm(indice, d)).length;
      const emAberto = semana
        .dias()
        .filter((d) => !this.noPeriodo(d) && !this.entrada.datasPlanejadas.has(d) && !this.agenda.em(id, d) && this.livreEm(indice, d)).length;
      const fechada = emAberto === 0;
      if (fechada) {
        // Saldo de semanas anteriores: até uma jornada por semana, uma folga a mais para quem
        // tem horas sobrando ou um dia a mais para quem deve.
        const saldo = this.saldos.get(id) ?? 0;
        const meia = Math.max(Math.floor(dur / 2), 1);
        if (saldo >= meia && base >= dur) base -= dur;
        else if (saldo <= -meia && base + dur <= tetoInteiro) base += dur;
      }
      const alvo = disponiveis === 0 ? 0 : fechada ? base : proporcional(base, disponiveis, disponiveis + emAberto);
      alvos.push({ alvo, disponiveis });
      fechamento.push({ previsto, fechada });
    });

    // Folgas da semana: escolhidas antes dos dias, em blocos, repartidas entre os dias e entre
    // as pessoas (fim de semana revezado). Folga que o máximo de dias consecutivos impõe além
    // das mínimas tira uma jornada do alvo e do previsto da pessoa: é folga estrutural, não saldo.
    this.planejarFolgas(semana, alvos).forEach((forcadas, indice) => {
      const apto = this.aptos[indice];
      const alvo = alvos[indice];
      const fecha = fechamento[indice];
      if (forcadas === 0 || !apto || !alvo || !fecha) return;
      alvo.alvo = Math.max(0, alvo.alvo - forcadas * apto.duracaoRef);
      fecha.previsto = Math.max(0, fecha.previsto - forcadas * apto.duracaoRef);
    });
    this.prealocarFuncoes(semana, dias, alvos);
    dias.forEach((dia, i) => this.planejarDia(dia, semana, dias.slice(i), alvos));
    this.folgasPlanejadas = new Map();

    // Semana fechada: o que ainda sobra ou falta do saldo vira ajuste de horário nas jornadas
    // desta semana, e o saldo segue para a próxima.
    fechamento.forEach(({ previsto, fechada }, indice) => {
      if (!fechada) return;
      const apto = this.aptos[indice];
      if (!apto) return;
      const id = apto.func.id;
      const saldo = this.saldos.get(id) ?? 0;
      const feito = this.agenda.minutosNaSemana(id, semana);
      this.previstos.set(`${id}|${semana.inicio}`, previsto);
      const projetado = saldo + feito - previsto;
      // A hora extra da semana não é desfeita na própria semana: fica como saldo e é
      // compensada nas semanas e meses seguintes.
      const extras = this.extraNaSemana(id, semana);
      if (projetado < 0) this.estender(indice, semana, -projetado);
      else if (projetado > extras) this.encurtar(indice, semana, projetado - extras);
      this.saldos.set(id, saldo + this.agenda.minutosNaSemana(id, semana) - previsto);
    });

    this.avisarFuncoesDescobertas();
    this.avisarExcessoSemanal(semana);

    // Quem ficou pelo menos uma jornada abaixo do alvo, tendo dias para cumpri-lo.
    this.aptos.forEach((apto, indice) => {
      const { alvo, disponiveis } = alvos[indice] ?? {
        alvo: 0,
        disponiveis: 0,
      };
      const feito = this.minutosNovosNaSemana(apto.func.id, semana);
      const falta = Math.max(0, alvo - feito);
      const diasSuficientes = disponiveis >= Math.ceil(alvo / Math.max(apto.duracaoRef, 1));
      if (falta >= apto.duracaoMin && diasSuficientes) {
        this.avisos.push({
          tipo: "cargaAbaixoDoAlvo",
          data: semana.inicio,
          funcionarioId: apto.func.id,
          mensagem: `${apto.func.nome} ficou com ${formatarMinutos(feito)} de ${formatarMinutos(alvo)} previstas na semana de ${formatarDiaMes(semana.inicio)} a ${formatarDiaMes(
            semana.fim,
          )} (folgas, descanso ou cobertura impediram completar).`,
        });
      }
    });
  }

  // ------------------------------------------------------------------ folgas da semana

  /** A pessoa tem folga planejada no dia. */
  private folgaPlanejada(indice: number, dia: DataISO): boolean {
    return this.folgasPlanejadas.get(indice)?.has(dia) ?? false;
  }

  /** Turno que a pessoa faria no dia (o da sua faixa); `undefined` se não pode trabalhar. */
  private turnoDaPessoaNoDia(indice: number, dia: DataISO): string | undefined {
    return this.opcoesDoDia(indice, dia, false)[0]?.turnoId;
  }

  /** O dia é folga conhecida da pessoa: fechado, sem como trabalhar ou sem jornada em escala já planejada. */
  private diaDeFolga(indice: number, dia: DataISO, jaPlanejado: boolean): boolean {
    const apto = this.aptos[indice];
    if (!apto || this.agenda.em(apto.func.id, dia)) return false;
    if (this.fechado(dia) || !contemDia(apto.diasTurnos, diaDaSemana(dia)) || !disponivelEm(apto.func, dia) || this.folgaDominical(indice, dia)) return true;
    return jaPlanejado && (this.noPeriodo(dia) || this.entrada.datasPlanejadas.has(dia));
  }

  /** Sábados e domingos sem trabalho nas últimas semanas em que a pessoa tem escala. */
  private fimDeSemanaLivre(id: string, inicio: DataISO): { sabados: number; domingos: number; completos: number; ultimoSabado: number; ultimoDomingo: number } {
    let sabados = 0;
    let domingos = 0;
    let completos = 0;
    // Dias desde a última folga no sábado / domingo (o maior possível sem nenhuma na janela).
    let ultimoSabado = SEMANAS_EQUIDADE * 7 + 1;
    let ultimoDomingo = SEMANAS_EQUIDADE * 7 + 1;
    for (let k = 1; k <= SEMANAS_EQUIDADE * 7; k++) {
      const d = somarDias(inicio, -k);
      const dow = diaDaSemana(d);
      if ((dow !== 5 && dow !== 6) || this.agenda.em(id, d)) continue;
      // Só vale onde há escala conhecida em volta (sem histórico, todos ficariam "livres").
      const conhecido = [-3, -2, -1, 1, 2, 3].some((x) => this.agenda.em(id, somarDias(d, x)));
      if (!conhecido) continue;
      if (dow === 5) {
        sabados++;
        ultimoSabado = Math.min(ultimoSabado, k);
        if (!this.agenda.em(id, somarDias(d, 1))) completos++;
      } else {
        domingos++;
        ultimoDomingo = Math.min(ultimoDomingo, k);
      }
    }
    return { sabados, domingos, completos, ultimoSabado, ultimoDomingo };
  }

  /**
   * Escolhe, para cada pessoa, os dias de folga da semana (dentro do período). Cada pessoa tem
   * que ficar com `livres − jornadas do alvo` folgas, e a escolha considera, em ordem:
   * 1. o máximo de dias consecutivos (nas semanas seguintes também: uma folga a mais agora pode
   *    poupar outra adiante; a que sobrar é "forçada" e é devolvida em jornadas a menos);
   * 2. o efetivo mínimo de cada turno e de cada função em cada dia;
   * 3. folgas juntas (2 folgas em dias seguidos) e, para quem tem menos sábados e domingos
   *    livres, folga no fim de semana;
   * 4. a distribuição uniforme das folgas entre os dias.
   * Devolve, por pessoa (índice em `aptos`), as folgas forçadas além das mínimas.
   */
  private planejarFolgas(semana: Semana, alvos: ReadonlyArray<{ alvo: number; disponiveis: number }>): number[] {
    this.folgasPlanejadas = new Map();
    const forcadas = this.aptos.map(() => 0);
    const maxSeguidos = this.entrada.regras.maxDiasConsecutivos;
    const datas = semana.dias();
    const posSabado = datas.findIndex((d) => diaDaSemana(d) === 5);
    const posDomingo = datas.findIndex((d) => diaDaSemana(d) === 6);
    const idxSemana = this.semanasDoPeriodo.findIndex((x) => x.inicio === semana.inicio);

    interface Pessoa {
      indice: number;
      id: string;
      funcao: string | undefined;
      trab: MascaraSemana;
      livres: MascaraSemana;
      bloqueados: MascaraSemana;
      jornadas: number;
      antes: number;
      depois: number;
      /** Folga no dia anterior / posterior à semana (dia fechado, ausência ou já planejado sem jornada). */
      folgaAntes: boolean;
      folgaDepois: boolean;
      /** O último dia da semana é a folga do rodízio de domingo (a segunda seguinte aproveita a folga colada). */
      rodizioNoFim: boolean;
      slots: Array<string | undefined>;
      sabados: number;
      domingos: number;
      /** Fins de semana completos livres (sábado e domingo). */
      completos: number;
      /** Dias desde a última folga no sábado / domingo. */
      ultimoSabado: number;
      ultimoDomingo: number;
      /** Grupo do rodízio: mesma faixa, turno único e função. */
      grupo: string;
    }
    const pessoas: Pessoa[] = [];
    const potencial = new Map<string, number>();
    const potencialFuncao = new Map<string, number>();
    /** Pessoas de cada turno em cada dia, contando as que não podem trabalhar (rodízio, ausência). */
    const elenco = new Map<string, number>();
    const somarPotencial = (mapa: Map<string, number>, chave: string): void => {
      mapa.set(chave, (mapa.get(chave) ?? 0) + 1);
    };

    this.aptos.forEach((apto, indice) => {
      const id = apto.func.id;
      let trab = 0;
      let livres = 0;
      let bloqueados = 0;
      const slots: Array<string | undefined> = [];
      datas.forEach((d, i) => {
        const alocada = this.agenda.em(id, d);
        let turno: string | undefined;
        if (alocada) {
          trab |= 1 << i;
          turno = alocada.turnoId;
        } else if (this.noPeriodo(d)) {
          if (this.livreEm(indice, d)) {
            livres |= 1 << i;
            turno = this.turnoDaPessoaNoDia(indice, d);
          } else {
            bloqueados |= 1 << i;
          }
        }
        slots.push(turno);
        const doElenco = turno ?? (this.noPeriodo(d) ? this.turnoDaPessoaNoDia(indice, d) : undefined);
        if (doElenco !== undefined) somarPotencial(elenco, `${doElenco}|${i}`);
        if (turno !== undefined) {
          somarPotencial(potencial, `${turno}|${i}`);
          if (apto.funcao !== undefined) somarPotencial(potencialFuncao, `${apto.funcao}|${turno}|${i}`);
        }
      });
      const alvo = alvos[indice]?.alvo ?? 0;
      const jornadas = Math.min(contarPosicoes(livres), Math.max(0, Math.round(alvo / Math.max(apto.duracaoRef, 1))));
      pessoas.push({
        indice,
        id,
        funcao: apto.funcao,
        trab,
        livres,
        bloqueados,
        jornadas,
        antes: this.agenda.diasSeguidosAntes(id, semana.inicio),
        depois: this.agenda.diasSeguidosDepois(id, semana.fim),
        folgaAntes: this.diaDeFolga(indice, somarDias(semana.inicio, -1), true),
        folgaDepois: this.diaDeFolga(indice, somarDias(semana.fim, 1), false),
        rodizioNoFim: this.folgaDominical(indice, semana.fim),
        slots,
        ...this.fimDeSemanaLivre(id, semana.inicio),
        grupo: `${apto.faixa ?? "-"}|${apto.opcoes.length === 1 ? (apto.opcoes[0]?.turnoId ?? "") : ""}|${apto.funcao ?? ""}`,
      });
    });

    // Sábados e domingos livres são revezados por grupo (mesma faixa e função): a cota de cada fim
    // de semana é a parte justa das folgas do grupo (com uma leve preferência pelo sábado) menos
    // quem já está de folga no dia; ficam com ela os que têm menos dias livres acumulados e para
    // quem os dias consecutivos deixam folgar naquele dia. O domingo, mais disputado, escolhe antes.
    const viavelCom = (p: Pessoa, mascara: MascaraSemana): boolean => {
      const base = contarPosicoes(p.livres) - p.jornadas;
      if ((mascara & ~p.livres) !== 0 || contarPosicoes(mascara) > base) return false;
      return escolhas(p.livres, base).some((combo) => (combo & mascara) === mascara && corridaDaSemana(p.trab | (p.livres & ~combo), p.antes, p.depois).maxima <= maxSeguidos);
    };
    const grupos = new Map<string, Pessoa[]>();
    for (const p of pessoas) grupos.set(p.grupo, [...(grupos.get(p.grupo) ?? []), p]);
    const vencedoresSabado = new Set<number>();
    const vencedoresDomingo = new Set<number>();
    const giroOrdem = Math.floor(diasDesdeEra(semana.inicio) / 7);
    const quantidade = Math.max(pessoas.length, 1);
    const sorteio = (dia: "sabado" | "domingo", membros: Pessoa[], pos: number, cota: number, aceita: (p: Pessoa) => boolean): void => {
      const conta = (p: Pessoa): number => (dia === "sabado" ? p.sabados : p.domingos);
      const faz = (p: Pessoa): number => (dia === "sabado" ? p.ultimoSabado : p.ultimoDomingo);
      const escolhidos = membros
        .filter((p) => (p.livres & (1 << pos)) !== 0 && viavelCom(p, 1 << pos) && aceita(p))
        .sort((x, y) => conta(x) - conta(y) || faz(y) - faz(x) || x.completos - y.completos || ((x.indice + giroOrdem) % quantidade) - ((y.indice + giroOrdem) % quantidade) || x.indice - y.indice)
        .slice(0, cota);
      for (const e of escolhidos) (dia === "sabado" ? vencedoresSabado : vencedoresDomingo).add(e.indice);
    };
    for (const [grupo, membros] of grupos) {
      const folgasPorDia = membros.reduce((t, p) => t + (7 - contarPosicoes(p.trab) - p.jornadas), 0) / 7;
      for (const dia of ["domingo", "sabado"] as const) {
        const pos = dia === "sabado" ? posSabado : posDomingo;
        if (pos < 0) continue;
        const sobras = dia === "sabado" ? this.sobraSabado : this.sobraDomingo;
        const parte = folgasPorDia * (dia === "sabado" ? PREFERENCIA_SABADO : 1) + (sobras.get(grupo) ?? 0);
        const jaFolga = membros.filter((p) => (p.bloqueados & (1 << pos)) !== 0).length;
        const candidatos = membros.filter((p) => (p.livres & (1 << pos)) !== 0).length;
        const cota = Math.max(0, Math.min(candidatos, Math.round(parte) - jaFolga));
        sobras.set(grupo, Math.max(-1, Math.min(1, parte - jaFolga - cota)));
        // Quem ganhou o domingo só ganha também o sábado se puder folgar nos dois dias.
        const doisDias = posSabado >= 0 && posDomingo >= 0 ? (1 << posSabado) | (1 << posDomingo) : 0;
        sorteio(dia, membros, pos, cota, (p) => dia === "domingo" || !vencedoresDomingo.has(p.indice) || viavelCom(p, doisDias));
      }
    }

    // Quem tem menos fins de semana livres escolhe primeiro; o resto gira de semana a semana.
    const giro = Math.floor(diasDesdeEra(semana.inicio) / 7);
    const total = Math.max(pessoas.length, 1);
    const ordem = [...pessoas].sort((a, b) => a.sabados - b.sabados || b.ultimoSabado - a.ultimoSabado || a.domingos - b.domingos || ((a.indice + giro) % total) - ((b.indice + giro) % total) || a.indice - b.indice);

    // Estrutura das semanas seguintes de cada pessoa, para a antecipação dos dias consecutivos.
    const futuras = (p: Pessoa): Array<{ trab: MascaraSemana; livres: MascaraSemana; jornadas: number; depois: number }> => {
      const apto = this.aptos[p.indice];
      const resultado: Array<{ trab: MascaraSemana; livres: MascaraSemana; jornadas: number; depois: number }> = [];
      if (!apto || idxSemana < 0) return resultado;
      for (let j = idxSemana + 1; j < Math.min(this.semanasDoPeriodo.length, idxSemana + 1 + SEMANAS_ANTECIPADAS); j++) {
        const sj = this.semanasDoPeriodo[j];
        if (!sj) break;
        let trab = 0;
        let livres = 0;
        sj.dias().forEach((d, i) => {
          if (this.agenda.em(p.id, d)) trab |= 1 << i;
          else if (this.noPeriodo(d) && this.livreEm(p.indice, d)) livres |= 1 << i;
        });
        const previsto = previstoDaSemana(apto.func, this.entrada.turnos, this.limites(apto, sj), sj, apto.duracaoRef, this.opcoesPrevisto(p.indice, sj));
        const jornadas = Math.min(contarPosicoes(livres), Math.max(0, Math.round(previsto / Math.max(apto.duracaoRef, 1)) - contarPosicoes(trab)));
        resultado.push({ trab, livres, jornadas, depois: this.agenda.diasSeguidosDepois(p.id, sj.fim) });
      }
      return resultado;
    };

    const ofs = new Map<string, number>();
    const ofsFuncao = new Map<string, number>();
    const minimoDoTurno = new Map(this.turnos.map((t) => [t.id, t.efetivoMinimo]));
    const minimoDaFuncao = new Map(this.minimos.map((m) => [m.funcao, m.minimo]));

    for (const p of ordem) {
      const nL = contarPosicoes(p.livres);
      if (nL === 0) continue;
      const base = nL - p.jornadas;

      // Menos folgas forçadas nas semanas seguintes (memória por estado: dias seguidos no fim da semana).
      const seguintes = futuras(p);
      const memo = new Map<number, number>();
      const custoFuturo = (corrida: number, j: number): number => {
        const f = seguintes[j];
        if (!f) return 0;
        const chave = corrida * 8 + j;
        const guardado = memo.get(chave);
        if (guardado !== undefined) return guardado;
        const n = contarPosicoes(f.livres);
        const minimo = n - f.jornadas;
        let melhor = Number.POSITIVE_INFINITY;
        for (let k = minimo; k <= Math.min(minimo + 2, n) && melhor > k - minimo; k++) {
          for (const combo of escolhas(f.livres, k)) {
            const c = corridaDaSemana(f.trab | (f.livres & ~combo), corrida, f.depois);
            if (c.maxima > maxSeguidos) continue;
            melhor = Math.min(melhor, k - minimo + custoFuturo(c.final, j + 1));
          }
        }
        if (!Number.isFinite(melhor)) melhor = 3;
        memo.set(chave, melhor);
        return melhor;
      };

      const custoDaEscolha = (combo: MascaraSemana): number => {
        let custo = 0;
        for (const i of posicoes(combo)) {
          // Desempate que gira entre os dias da semana (senão toda folga cairia nos primeiros dias).
          custo += 0.01 * ((i - ((giro + p.indice) % 7) + 7) % 7);
          const turno = p.slots[i];
          if (turno === undefined) continue;
          const chave = `${turno}|${i}`;
          const pot = potencial.get(chave) ?? 0;
          const fora = ofs.get(chave) ?? 0;
          const furo = (minimoDoTurno.get(turno) ?? 0) - (pot - fora - 1);
          if (furo > 0) custo += PESO_FURO * furo;
          // Folgas já no dia (inclusive as impostas por rodízio e ausência) em relação ao elenco do turno.
          const jaFora = Math.max(0, (elenco.get(chave) ?? 0) - pot) + fora;
          custo += (PESO_EQUILIBRIO * (2 * jaFora + 1)) / Math.max(elenco.get(chave) ?? 1, 1);
          if (p.funcao !== undefined) {
            const chaveF = `${p.funcao}|${turno}|${i}`;
            const furoF = (minimoDaFuncao.get(p.funcao) ?? 0) - ((potencialFuncao.get(chaveF) ?? 0) - (ofsFuncao.get(chaveF) ?? 0) - 1);
            if (furoF > 0) custo += PESO_FURO * furoF;
          }
        }
        const folgas = combo | p.bloqueados;
        // Folga logo depois de uma folga (ex.: segunda depois do domingo de rodízio) forma bloco.
        if (p.folgaAntes && (combo & 1) !== 0) custo -= PESO_COLADA;
        // Duas folgas na semana pedem pelo menos duas coladas: entre si ou com a folga do dia
        // vizinho (a semana seguinte é planejada depois e aproveita uma folga no fim desta).
        if (contarPosicoes(folgas) >= 2) {
          const depois = p.folgaDepois || (p.rodizioNoFim && idxSemana >= 0 && idxSemana + 1 < this.semanasDoPeriodo.length);
          const estendida = (p.folgaAntes ? 1 : 0) | (folgas << 1) | (depois ? 1 << 8 : 0);
          const coladas = posicoes(folgas).some((i) => (estendida & (1 << i)) !== 0 || (estendida & (1 << (i + 2))) !== 0);
          if (!coladas) custo += PESO_BLOCO;
        }
        const sabado = posSabado >= 0 && (combo & (1 << posSabado)) !== 0;
        const domingo = posDomingo >= 0 && (combo & (1 << posDomingo)) !== 0;
        // Fim de semana: quem tem a vez ganha, os outros perdem (revezamento entre o grupo).
        if (sabado) custo += vencedoresSabado.has(p.indice) ? -PESO_FIM_DE_SEMANA : PESO_FIM_DE_SEMANA;
        if (domingo) custo += vencedoresDomingo.has(p.indice) ? -PESO_FIM_DE_SEMANA : PESO_FIM_DE_SEMANA;
        return custo;
      };

      let melhor: { combo: MascaraSemana; k: number; custo: number } | undefined;
      for (let k = base; k <= Math.min(base + 2, nL); k++) {
        for (const combo of escolhas(p.livres, k)) {
          const c = corridaDaSemana(p.trab | (p.livres & ~combo), p.antes, p.depois);
          if (c.maxima > maxSeguidos) continue;
          const custo = PESO_DIA_PERDIDO * (k - base + custoFuturo(c.final, 0)) + custoDaEscolha(combo);
          if (!melhor || custo < melhor.custo - 1e-9) melhor = { combo, k, custo };
        }
        // Folga a mais só compensa se poupar folgas adiante; sem custo futuro, não há o que ganhar.
        if (melhor && melhor.k === base && melhor.custo < PESO_DIA_PERDIDO) break;
      }
      if (!melhor) {
        // Sem como respeitar os dias consecutivos: usa o mínimo; a elegibilidade do dia decide o resto.
        for (const combo of escolhas(p.livres, base)) {
          const custo = custoDaEscolha(combo);
          if (!melhor || custo < melhor.custo - 1e-9) melhor = { combo, k: base, custo };
        }
      }
      if (!melhor) continue;
      const dias = new Set<DataISO>();
      for (const i of posicoes(melhor.combo)) {
        const d = datas[i];
        const turno = p.slots[i];
        if (d === undefined) continue;
        dias.add(d);
        if (turno !== undefined) {
          ofs.set(`${turno}|${i}`, (ofs.get(`${turno}|${i}`) ?? 0) + 1);
          if (p.funcao !== undefined) ofsFuncao.set(`${p.funcao}|${turno}|${i}`, (ofsFuncao.get(`${p.funcao}|${turno}|${i}`) ?? 0) + 1);
        }
      }
      this.folgasPlanejadas.set(p.indice, dias);
      forcadas[p.indice] = melhor.k - base;
    }
    return forcadas;
  }

  // ------------------------------------------------------------------ compensação de saldo

  /**
   * Estica jornadas novas da semana até cobrir `falta` minutos (passos de 15 min): sem passar
   * da jornada diária máxima nem do limite semanal, dentro do horário de funcionamento do dia
   * e respeitando o descanso entre jornadas.
   */
  private estender(indice: number, semana: Semana, faltaInicial: number): void {
    const apto = this.aptos[indice];
    if (!apto) return;
    const id = apto.func.id;
    const limite = limiteDoFuncionario(apto.func, this.limites(apto, semana));
    const jornadaMax = this.entrada.regras.jornadaDiariaMaxMin;
    let falta = faltaInicial;
    for (const dia of this.diasNovos(id, semana)) {
      const atual = this.agenda.em(id, dia);
      if (!atual) continue;
      const livreSemana = Math.max(0, limite - this.agenda.minutosNaSemana(id, semana));
      const livreDia = Math.max(0, jornadaMax - minutosDaAlocacao(atual));
      let x = Math.floor(Math.min(falta, livreSemana, livreDia) / PASSO_AJUSTE_MIN) * PASSO_AJUSTE_MIN;
      while (x >= PASSO_AJUSTE_MIN) {
        const nova = this.esticada(atual, x);
        if (nova && this.cabe(nova)) {
          this.substituir({ ...nova, origem: "compensacao" });
          falta -= x;
          break;
        }
        x -= PASSO_AJUSTE_MIN;
      }
      if (falta < PASSO_AJUSTE_MIN) break;
    }
  }

  /** Encurta jornadas novas da semana até tirar `sobra` minutos: no máximo 2h por jornada e nunca abaixo de 4h trabalhadas. */
  private encurtar(indice: number, semana: Semana, sobraInicial: number): void {
    const apto = this.aptos[indice];
    if (!apto) return;
    const id = apto.func.id;
    let sobra = sobraInicial;
    for (const dia of this.diasNovos(id, semana)) {
      const atual = this.agenda.em(id, dia);
      if (!atual) continue;
      const trabalhado = minutosDaAlocacao(atual);
      const piso = Math.max(JORNADA_MIN_ENCURTADA, Math.floor(trabalhado / 2));
      const x = Math.floor(Math.min(sobra, MAX_ENCURTAR_MIN, Math.max(0, trabalhado - piso)) / PASSO_AJUSTE_MIN) * PASSO_AJUSTE_MIN;
      if (x === 0) continue;
      const nova = this.encurtada(atual, x);
      if (nova) {
        this.substituir({ ...nova, origem: "compensacao" });
        sobra -= x;
      }
      if (sobra < PASSO_AJUSTE_MIN) break;
    }
  }

  /** Datas das jornadas novas do funcionário na semana que a compensação pode mexer (não as de hora extra). */
  private diasNovos(id: string, semana: Semana): DataISO[] {
    return this.novas.filter((a) => a.funcionarioId === id && semana.contem(a.data) && a.origem !== "horaExtra").map((a) => a.data);
  }

  /** Minutos de hora extra do funcionário nas jornadas da semana. */
  private extraNaSemana(id: string, semana: Semana): number {
    let total = 0;
    for (const a of this.novas) {
      if (a.funcionarioId === id && semana.contem(a.data)) total += this.extraPorAloc.get(`${id}|${a.data}`) ?? 0;
    }
    return total;
  }

  /**
   * Intervalo da jornada ajustada: a hora não trabalhada da pessoa, quando ela tem uma (o almoço
   * dela não muda porque a jornada encurtou ou esticou); senão o `calculado` pela CLT.
   */
  private intervaloDe(funcionarioId: string, calculado: number): number {
    return intervaloDoFuncionario(this.funcPorId.get(funcionarioId), calculado);
  }

  /** Funcionamento do dia, incluindo a própria jornada. */
  private janela(a: Alocacao): [number, number] {
    const inicio = a.horario.inicioMin;
    const fim = inicio + duracaoTotal(a.horario);
    const j = this.janelas[diaDaSemana(a.data)];
    return j ? [Math.min(j[0], inicio), Math.max(j[1], fim)] : [inicio, fim];
  }

  /**
   * A jornada com `minutos` a mais: quem abre fica até mais tarde, quem fecha chega mais cedo e
   * quem está no meio tenta os dois. O intervalo cresce se a nova jornada exigir (CLT: acima de 6h, 1h).
   */
  private esticada(a: Alocacao, minutos: number): Alocacao | null {
    const [abre, fecha] = this.janela(a);
    const inicio = a.horario.inicioMin;
    const fim = inicio + duracaoTotal(a.horario);
    const trabalhado = minutosDaAlocacao(a) + minutos;
    const intervalo = this.intervaloDe(a.funcionarioId, Math.max(a.horario.intervaloMin, intervaloPadrao(trabalhado)));
    const duracao = trabalhado + intervalo;
    const depois: [number, number] = [inicio, inicio + duracao];
    const antes: [number, number] | null = fim - duracao >= 0 ? [fim - duracao, fim] : null;
    const opcoes: Array<[number, number] | null> = inicio <= abre ? [depois] : fim >= fecha ? [antes] : [depois, antes];
    for (const o of opcoes) {
      if (o && o[0] >= abre && o[1] <= fecha) return this.comHorario(a, o[0], o[1], intervalo);
    }
    return null;
  }

  /** A jornada com `minutos` a menos: quem fecha chega mais tarde; os demais saem mais cedo. */
  private encurtada(a: Alocacao, minutos: number): Alocacao | null {
    const [, fecha] = this.janela(a);
    const inicio = a.horario.inicioMin;
    const fim = inicio + duracaoTotal(a.horario);
    const trabalhado = minutosDaAlocacao(a) - minutos;
    if (trabalhado < 0) return null;
    const intervalo = this.intervaloDe(a.funcionarioId, Math.min(a.horario.intervaloMin, intervaloPadrao(trabalhado)));
    const duracao = trabalhado + intervalo;
    if (fim >= fecha && inicio > 0) {
      if (fim - duracao < 0) return null;
      return this.comHorario(a, fim - duracao, fim, intervalo);
    }
    return this.comHorario(a, inicio, inicio + duracao, intervalo);
  }

  private comHorario(a: Alocacao, inicio: number, fim: number, intervalo: number): Alocacao | null {
    if (inicio < 0 || inicio >= MINUTOS_DIA) return null;
    const horario = tentarCriarHorario(inicio, fim % MINUTOS_DIA, intervalo);
    return horario ? { ...a, horario } : null;
  }

  /** A jornada ajustada respeita a jornada diária e o descanso entre jornadas. */
  private cabe(nova: Alocacao): boolean {
    const regras = this.entrada.regras;
    const id = nova.funcionarioId;
    return (
      minutosDaAlocacao(nova) <= regras.jornadaDiariaMaxMin &&
      this.respeitaDescansos(nova, this.agenda.anterior(id, nova.data), this.agenda.seguinte(id, nova.data))
    );
  }

  /** Troca a jornada nova do mesmo funcionário e dia por `nova`. */
  private substituir(nova: Alocacao): void {
    const i = this.novas.findIndex((a) => a.funcionarioId === nova.funcionarioId && a.data === nova.data);
    const antiga = this.novas[i];
    if (i < 0 || !antiga) return;
    const total = this.minutosNoPeriodo.get(nova.funcionarioId) ?? 0;
    this.minutosNoPeriodo.set(nova.funcionarioId, Math.max(0, total + minutosDaAlocacao(nova) - minutosDaAlocacao(antiga)));
    this.novas[i] = nova;
    this.agenda.inserir(nova);
  }

  // ------------------------------------------------------------------ planejamento do dia

  private planejarDia(dia: DataISO, semana: Semana, restantes: readonly DataISO[], alvos: ReadonlyArray<{ alvo: number; disponiveis: number }>): void {
    if (this.fechado(dia)) return;
    const deslocamento = Math.max(0, diasEntre(this.entrada.inicio, dia));
    const totalAptos = Math.max(this.aptos.length, 1);

    // 1. Candidatos com carga a cumprir e sua urgência.
    const candidatos: Candidato[] = [];
    this.aptos.forEach((apto, indice) => {
      const id = apto.func.id;
      if (!this.livreEm(indice, dia) || this.agenda.em(id, dia)) return;
      // Folga planejada: só entra mais adiante, se a cobertura mínima pedir.
      if (this.folgaPlanejada(indice, dia)) return;
      const alvo = alvos[indice]?.alvo ?? 0;
      const falta = Math.max(0, alvo - this.minutosNovosNaSemana(id, semana));
      if (falta === 0) return;
      const diasPossiveis = Math.max(1, restantes.filter((d) => this.livreEm(indice, d) && !this.agenda.em(id, d) && !this.folgaPlanejada(indice, d)).length);
      candidatos.push({
        indice,
        faltaMin: falta,
        duracaoRef: apto.duracaoRef,
        diasPossiveis,
        // Quem tem folgas planejadas trabalha em todos os outros dias.
        obrigatorio: this.folgasPlanejadas.has(indice) || falta >= diasPossiveis * apto.duracaoRef,
      });
    });

    // 2. Cota de cada turno que funciona no dia: demanda restante distribuída pelos dias
    //    restantes em que o turno funciona. A demanda de cada candidato é repartida só entre
    //    os turnos dele que funcionam hoje.
    const demanda = new Map<string, number>();
    for (const c of candidatos) {
      const ativas = this.opcoesDoDia(c.indice, dia, false);
      const fatia = turnosFaltando(c) / Math.max(ativas.length, 1);
      for (const o of ativas) demanda.set(o.turnoId, (demanda.get(o.turnoId) ?? 0) + fatia);
    }
    const doDia = this.turnos.filter((t) => turnoFuncionaEm(t, dia));
    const cotas = new Map<string, number>();
    for (const t of doDia) {
      const diasDoTurno = Math.max(1, restantes.filter((d) => turnoFuncionaEm(t, d)).length);
      const media = (demanda.get(t.id) ?? 0) / diasDoTurno;
      // Arredonda a média com um deslocamento que varia por turno e por dia (sequência de baixa
      // discrepância): a parte fracionária vira, ao longo da semana, a quantidade certa de vagas,
      // sem que toda equipe pequena folgue sempre no último dia. Médias inteiras não mudam.
      const posicao = this.ordemTurno(t.id) + 1;
      const bruto = posicao * 0.6180339887 + diasDesdeEra(dia) * 0.7548776662;
      const desloc = bruto - Math.floor(bruto);
      const cota = Math.max(0, Math.floor(media + desloc - 1e-9));
      // Quem já está reservado no dia (cobertura de função, jornada travada) soma à cota.
      const reservados = [...this.novas, ...this.entrada.alocacoesTravadas].filter((a) => a.data === dia && a.turnoId === t.id).length;
      cotas.set(t.id, Math.max(cota + reservados, t.efetivoMinimo));
    }

    // 3. Ordem de prioridade: obrigatórios, maior pressão, (aos domingos) menos domingos
    //    trabalhados, menos horas no período, rodízio.
    const domingo = diaDaSemana(dia) === 6;
    const domingosTrabalhados = (c: Candidato): number =>
      this.agenda.mesmosDiasTrabalhados(this.aptos[c.indice]?.func.id ?? "", dia, SEMANAS_HISTORICO_DOMINGO);
    const rodizio = (c: Candidato): number => ((this.aptos[c.indice]?.posicao ?? 0) + deslocamento) % totalAptos;
    candidatos.sort(
      (a, b) =>
        bit(b.obrigatorio) - bit(a.obrigatorio) ||
        compararPressao(b, a) ||
        (domingo ? domingosTrabalhados(a) - domingosTrabalhados(b) : 0) ||
        this.minutosPeriodo(a.indice) - this.minutosPeriodo(b.indice) ||
        rodizio(a) - rodizio(b) ||
        a.indice - b.indice,
    );

    // Quem já está no dia (cobertura de função reservada no início da semana) conta para a cota.
    const contagem = new Map<string, number>();
    for (const a of [...this.novas, ...this.entrada.alocacoesTravadas]) {
      if (a.data === dia) contagem.set(a.turnoId, (contagem.get(a.turnoId) ?? 0) + 1);
    }
    const somar = (turnoId: string): void => {
      contagem.set(turnoId, (contagem.get(turnoId) ?? 0) + 1);
    };
    const total = (turnoId: string): number => contagem.get(turnoId) ?? 0;

    // Funções com mínimo: em cada turno do dia, os primeiros da fila de cada função entram
    // antes dos demais (só quem ainda tem horas a cumprir na semana).
    for (const turno of doDia) {
      for (const { funcao, minimo } of this.minimos) {
        let presentes = this.daFuncaoNoTurno(funcao, turno.id, dia);
        for (const c of candidatos) {
          if (presentes >= minimo) break;
          if (this.aptos[c.indice]?.funcao !== funcao) continue;
          const opcao = this.opcoesElegiveis(c.indice, dia, semana, false).find((o) => o.turnoId === turno.id);
          if (opcao) {
            this.alocar(c.indice, dia, opcao);
            somar(turno.id);
            presentes++;
          }
        }
      }
    }
    for (const c of candidatos) {
      const elegiveis = this.opcoesElegiveis(c.indice, dia, semana, false);
      // Quem pode fazer mais de um horário fica no mesmo da última jornada (ou no preferido)
      // enquanto ele tiver vaga; senão vai para o horário mais desfalcado.
      const preferido = this.turnoPreferido(c.indice, dia);
      const abaixoDaCota = maxPor(
        elegiveis.filter((o) => total(o.turnoId) < (cotas.get(o.turnoId) ?? 0)),
        (o) => [bit(o.turnoId === preferido), (cotas.get(o.turnoId) ?? 0) - total(o.turnoId), -this.ordemTurno(o.turnoId)],
      );
      const escolha =
        abaixoDaCota ?? (c.obrigatorio ? minPor(elegiveis, (o) => [bit(o.turnoId !== preferido), total(o.turnoId), this.ordemTurno(o.turnoId)]) : undefined);
      if (escolha) {
        this.alocar(c.indice, dia, escolha);
        somar(escolha.turnoId);
      }
    }

    // 4. Efetivo mínimo: completa com quem ainda tem saldo semanal (mesmo já no alvo).
    for (const turno of this.turnos) {
      if (!turnoFuncionaEm(turno, dia) || this.turnosSemEquipe.has(turno.id)) continue;
      while (total(turno.id) < turno.efetivoMinimo) {
        const opcoes: Array<{ indice: number; apto: Apto; opcao: Opcao }> = [];
        this.aptos.forEach((apto, indice) => {
          const opcao = this.opcoesElegiveis(indice, dia, semana, true).find((o) => o.turnoId === turno.id);
          if (opcao) opcoes.push({ indice, apto, opcao });
        });
        // Função que falta no turno vem primeiro (a preferência de período só desempata).
        const faltam = new Set(this.minimos.filter((m) => this.daFuncaoNoTurno(m.funcao, turno.id, dia) < m.minimo).map((m) => m.funcao));
        const reforco = minPor(opcoes, ({ indice, apto }) => {
          // Primeiro quem ainda não cumpriu as horas da semana.
          const alvo = alvos[indice]?.alvo ?? 0;
          const passa = this.minutosNovosNaSemana(apto.func.id, semana) + apto.duracaoRef > alvo;
          return [
            bit(apto.funcao === undefined || !faltam.has(apto.funcao)),
            bit(this.folgaPlanejada(indice, dia)),
            bit(passa),
            bit(this.turnoPreferido(indice, dia) !== turno.id),
            this.agenda.minutosNaSemana(apto.func.id, semana),
            this.minutosPeriodo(indice),
            (apto.posicao + deslocamento) % totalAptos,
            apto.posicao,
          ];
        });
        if (reforco) {
          this.alocar(reforco.indice, dia, reforco.opcao);
          somar(turno.id);
        } else {
          break;
        }
      }
    }

    // 5. Funções ainda abaixo do mínimo: chama alguém da função com saldo semanal, mesmo de
    //    outra faixa. Sem ninguém, o dia entra no aviso da semana.
    for (const turno of doDia) {
      for (const { funcao, minimo } of this.minimos) {
        let presentes = this.daFuncaoNoTurno(funcao, turno.id, dia);
        while (presentes < minimo) {
          const opcoes: Array<{ indice: number; apto: Apto; opcao: Opcao }> = [];
          this.aptos.forEach((apto, indice) => {
            if (apto.funcao !== funcao) return;
            const opcao = this.opcoesElegiveis(indice, dia, semana, true).find((o) => o.turnoId === turno.id);
            if (opcao) opcoes.push({ indice, apto, opcao });
          });
          const reforco = minPor(opcoes, ({ indice, apto }) => {
            // Primeiro quem ainda não cumpriu as horas da semana (não quem está com a semana
            // reduzida por férias, por exemplo).
            const alvo = alvos[indice]?.alvo ?? 0;
            const passa = this.minutosNovosNaSemana(apto.func.id, semana) + apto.duracaoRef > alvo;
            return [
              bit(this.folgaPlanejada(indice, dia)),
              bit(passa),
              bit(this.turnoPreferido(indice, dia) !== turno.id),
              this.agenda.minutosNaSemana(apto.func.id, semana),
              this.minutosPeriodo(indice),
              apto.posicao,
            ];
          });
          if (reforco) {
            this.alocar(reforco.indice, dia, reforco.opcao);
            presentes++;
          } else {
            break;
          }
        }
      }
    }

    // 6. Furos que sobraram: hora extra como último recurso e, no que não der, os avisos.
    this.fecharFuros(dia, semana, doDia);
  }

  private presentesNoTurno(turnoId: string, dia: DataISO): number {
    return [...this.novas, ...this.entrada.alocacoesTravadas].filter((a) => a.data === dia && a.turnoId === turnoId).length;
  }

  private funcaoDe(funcionarioId: string): string | undefined {
    return this.aptos.find((a) => a.func.id === funcionarioId)?.funcao;
  }

  /**
   * Turnos do dia ainda abaixo do efetivo mínimo ou do mínimo de uma função: tenta cobrir com
   * hora extra (estendendo jornadas ou chamando quem passou do limite semanal) e avisa o que
   * ficou de fora. Sem hora extra possível, os avisos são os de cobertura insuficiente e função
   * descoberta.
   */
  private fecharFuros(dia: DataISO, semana: Semana, doDia: readonly Turno[]): void {
    for (const turno of doDia) {
      // Primeiro as funções (a hora extra sai de quem é da função); o efetivo geral depois,
      // já contando as jornadas estendidas.
      for (const { funcao, nome, minimo } of this.minimos) {
        if (this.daFuncaoNoTurno(funcao, turno.id, dia) >= minimo) continue;
        const r = this.cobrirComExtra(dia, semana, turno, funcao, minimo);
        if (r.janelas.length === 0) continue;
        if (r.aplicadas > 0) {
          this.avisos.push({
            tipo: "coberturaParcial",
            data: dia,
            turnoId: turno.id,
            mensagem: this.textoParcial(`${nome}: turno ${turno.nome}`, dia, r.janelas),
          });
        } else {
          const chave = `${funcao}|${turno.id}`;
          const item = this.funcoesDescobertas.get(chave) ?? { funcao, turnoId: turno.id, dias: [] };
          item.dias.push(dia);
          this.funcoesDescobertas.set(chave, item);
        }
      }
      if (!this.turnosSemEquipe.has(turno.id) && turno.efetivoMinimo > 0 && this.presentesNoTurno(turno.id, dia) < turno.efetivoMinimo) {
        const r = this.cobrirComExtra(dia, semana, turno, undefined, turno.efetivoMinimo);
        // Jornadas já estendidas para esse turno (por causa de uma função) já geraram o aviso de cobertura parcial.
        const estendido = [...this.extensoes.entries()].some(([chave, alvo]) => alvo === turno.id && chave.endsWith(`|${dia}`));
        if (estendido && r.aplicadas === 0) continue;
        if (r.janelas.length > 0 && r.aplicadas > 0) {
          this.avisos.push({ tipo: "coberturaParcial", data: dia, turnoId: turno.id, mensagem: this.textoParcial(`Turno ${turno.nome}`, dia, r.janelas) });
        } else if (r.janelas.length > 0) {
          this.avisos.push({
            tipo: "coberturaInsuficiente",
            data: dia,
            turnoId: turno.id,
            mensagem: `${formatarDataBR(dia)}: turno ${turno.nome} com ${this.presentesNoTurno(turno.id, dia)} de ${turno.efetivoMinimo} pessoa(s) mínimas (sem funcionários com saldo de horas ou descanso suficiente).`,
          });
        }
      }
    }
  }

  private textoParcial(quem: string, dia: DataISO, janelas: ReadonlyArray<readonly [number, number]>): string {
    const faixas = janelas.map(([a, b]) => `das ${formatarHora(a)} às ${formatarHora(b)}`).join(" e ");
    return `${quem} de ${formatarDiaMes(dia)} descoberto ${faixas}.`;
  }

  /** Faixas do turno (minutos desde a meia-noite do dia) com menos de `minimo` pessoas cobrindo. */
  private janelasDescobertas(
    dia: DataISO,
    turno: Turno,
    funcao: string | undefined,
    minimo: number,
    adicional?: readonly [number, number],
  ): Array<[number, number]> {
    return this.coberturaDoTurno(dia, turno, funcao, minimo, adicional).janelas;
  }

  /** Janelas descobertas e total de minutos-pessoa que faltam (soma de `minimo − presentes` por minuto). */
  private coberturaDoTurno(
    dia: DataISO,
    turno: Turno,
    funcao: string | undefined,
    minimo: number,
    adicional?: readonly [number, number],
  ): { janelas: Array<[number, number]>; falta: number } {
    const ini = turno.horario.inicioMin;
    const fim = ini + duracaoTotal(turno.horario);
    const contagem = new Array<number>(fim - ini).fill(0);
    const cobrir = (a: number, b: number): void => {
      for (let m = Math.max(a, ini); m < Math.min(b, fim); m++) contagem[m - ini] = (contagem[m - ini] ?? 0) + 1;
    };
    for (const a of [...this.novas, ...this.entrada.alocacoesTravadas]) {
      if (a.data !== dia) continue;
      if (funcao !== undefined && this.funcaoDe(a.funcionarioId) !== funcao) continue;
      if (a.turnoId === turno.id) cobrir(ini, fim);
      else if (this.extensoes.get(`${a.funcionarioId}|${a.data}`) === turno.id) cobrir(a.horario.inicioMin, a.horario.inicioMin + duracaoTotal(a.horario));
    }
    if (adicional) cobrir(adicional[0], adicional[1]);
    const janelas: Array<[number, number]> = [];
    let inicio = -1;
    let faltaTotal = 0;
    for (let i = 0; i <= contagem.length; i++) {
      const faltam = i < contagem.length && (contagem[i] ?? 0) < minimo;
      if (faltam) faltaTotal += minimo - (contagem[i] ?? 0);
      if (faltam && inicio < 0) inicio = i;
      if (!faltam && inicio >= 0) {
        janelas.push([ini + inicio, ini + i]);
        inicio = -1;
      }
    }
    return { janelas, falta: faltaTotal };
  }

  /**
   * Cobre com hora extra a faixa descoberta do turno (efetivo ou mínimo de uma função):
   * estende a jornada de quem já trabalha no dia em outro turno (quem abre fica até mais tarde,
   * quem fecha chega mais cedo) ou chama quem só não cabe por causa do limite semanal. Escolhe
   * quem deixa menos tempo descoberto e, empatando, quem tem menos hora extra no período.
   */
  private cobrirComExtra(
    dia: DataISO,
    semana: Semana,
    turno: Turno,
    funcao: string | undefined,
    minimo: number,
  ): { aplicadas: number; janelas: Array<[number, number]> } {
    const regras = this.entrada.regras;
    const periodoTurno = periodoDeInicio(turno.horario.inicioMin);
    const tetoJornada = jornadaMaxComExtraMin(regras);
    const nomeFuncao = funcao === undefined ? undefined : (this.minimos.find((m) => m.funcao === funcao)?.nome ?? funcao);
    let aplicadas = 0;

    interface Proposta {
      indice: number;
      nova: Alocacao;
      opcao?: Opcao;
      extraMin: number;
      ganho: number;
    }

    for (let rodada = 0; rodada <= this.aptos.length; rodada++) {
      const { janelas, falta: antes } = this.coberturaDoTurno(dia, turno, funcao, minimo);
      if (janelas.length === 0 || !this.horaExtra) return { aplicadas, janelas };
      const inicioFalta = Math.min(...janelas.map((j) => j[0]));
      const fimFalta = Math.max(...janelas.map((j) => j[1]));
      const propostas: Proposta[] = [];

      this.aptos.forEach((apto, indice) => {
        if (funcao !== undefined && apto.funcao !== funcao) return;
        const id = apto.func.id;
        const atual = this.novas.find((a) => a.funcionarioId === id && a.data === dia);
        if (atual) {
          // Já trabalha no dia em outro turno: estende o fim (se começa antes) ou antecipa o início.
          if (atual.turnoId === turno.id || atual.origem === "horaExtra") return;
          const trabalhado = minutosDaAlocacao(atual);
          if (trabalhado >= tetoJornada) return;
          const ini = atual.horario.inicioMin;
          const fimAtual = ini + duracaoTotal(atual.horario);
          const paraFrente = ini <= turno.horario.inicioMin;
          if (paraFrente ? fimAtual >= fimFalta : ini <= inicioFalta) return;
          for (let x = Math.floor((tetoJornada - trabalhado) / PASSO_AJUSTE_MIN) * PASSO_AJUSTE_MIN; x >= PASSO_AJUSTE_MIN; x -= PASSO_AJUSTE_MIN) {
            const novoTrabalho = trabalhado + x;
            const intervalo = this.intervaloDe(id, Math.max(atual.horario.intervaloMin, intervaloPadrao(novoTrabalho)));
            const duracao = novoTrabalho + intervalo;
            const novoInicio = paraFrente ? ini : fimAtual - duracao;
            const novoFim = paraFrente ? ini + duracao : fimAtual;
            if (paraFrente ? novoFim > fimFalta : novoInicio < inicioFalta || novoInicio < 0) continue;
            const nova = this.comHorario(atual, novoInicio, novoFim, intervalo);
            if (!nova || !this.cabeComExtra(nova)) continue;
            const marcada: Alocacao = { ...nova, origem: "horaExtra" };
            if (!this.cabeNoTetoSemanalDeExtra(id, semana, apto, minutosExtras(marcada, regras))) continue;
            const ganho = antes - this.coberturaDoTurno(dia, turno, funcao, minimo, [novoInicio, novoFim]).falta;
            if (ganho > 0)
              propostas.push({
                indice,
                nova: marcada,
                extraMin: minutosExtras(marcada, regras),
                ganho,
              });
            break;
          }
        } else {
          // Livre no dia, mas sem limite semanal: entra no turno inteiro; o que passar do limite é hora extra.
          const opcao = this.opcoesElegiveis(indice, dia, semana, true, true).find((o) => o.turnoId === turno.id);
          if (!opcao) return;
          const limites = this.limites(apto, semana);
          const excesso = Math.max(0, this.agenda.minutosNaSemana(id, semana) + minutosTrabalhados(opcao.horario) - limiteDoFuncionario(apto.func, limites));
          const ini = turno.horario.inicioMin;
          const ganho = antes - this.coberturaDoTurno(dia, turno, funcao, minimo, [ini, ini + duracaoTotal(turno.horario)]).falta;
          if (ganho <= 0 || !this.cabeNoTetoSemanalDeExtra(id, semana, apto, excesso)) return;
          const nova: Alocacao = {
            funcionarioId: id,
            turnoId: turno.id,
            data: dia,
            horario: opcao.horario,
            origem: "horaExtra",
          };
          propostas.push({ indice, nova, opcao, extraMin: excesso, ganho });
        }
      });

      const melhor = minPor(propostas, (p) => {
        const apto = this.aptos[p.indice];
        const id = apto?.func.id ?? "";
        return [-p.ganho, this.extraNoPeriodo.get(id) ?? 0, this.saldos.get(id) ?? 0, bit(apto?.func.preferencia !== periodoTurno), p.indice];
      });
      if (!melhor) return { aplicadas, janelas };

      const apto = this.aptos[melhor.indice];
      if (!apto) return { aplicadas, janelas };
      const chave = `${apto.func.id}|${dia}`;
      if (melhor.opcao) {
        this.alocar(melhor.indice, dia, melhor.opcao, "horaExtra");
      } else {
        this.substituir(melhor.nova);
        this.extensoes.set(chave, turno.id);
      }
      this.extraPorAloc.set(chave, melhor.extraMin);
      this.extraNoPeriodo.set(apto.func.id, (this.extraNoPeriodo.get(apto.func.id) ?? 0) + melhor.extraMin);
      aplicadas++;
      const quem = nomeFuncao === undefined ? `o turno ${turno.nome}` : `${nomeFuncao} no turno ${turno.nome}`;
      this.avisos.push({
        tipo: "horaExtra",
        data: dia,
        turnoId: turno.id,
        funcionarioId: apto.func.id,
        mensagem: `${apto.func.nome}: ${formatarMinutos(melhor.extraMin)} extra em ${formatarDiaMes(dia)} (${formatarHorario(melhor.nova.horario)}) para cobrir ${quem}.`,
      });
    }
    return {
      aplicadas,
      janelas: this.janelasDescobertas(dia, turno, funcao, minimo),
    };
  }

  /** A hora extra da semana (já feita + `extraMin`) cabe no teto semanal de hora extra. */
  private cabeNoTetoSemanalDeExtra(id: string, semana: Semana, apto: Apto, extraMin: number): boolean {
    const teto = horaExtraSemanalMax(this.entrada.regras, diasTrabalhoMax(this.limites(apto, semana)));
    return this.extraNaSemana(id, semana) + extraMin <= teto;
  }

  /** A jornada estendida (com hora extra) respeita o teto diário com extra e o descanso entre jornadas. */
  private cabeComExtra(nova: Alocacao): boolean {
    const regras = this.entrada.regras;
    const id = nova.funcionarioId;
    return (
      minutosDaAlocacao(nova) <= jornadaMaxComExtraMin(regras) &&
      this.respeitaDescansos(nova, this.agenda.anterior(id, nova.data), this.agenda.seguinte(id, nova.data))
    );
  }

  /**
   * Antes dos dias da semana, reserva o mínimo de cada função nos turnos e dias apertados (no
   * máximo uma pessoa da função disponível além do mínimo, como o domingo da folga dominical),
   * começando pelos mais apertados. As folgas da semana se ajeitam em volta dessas jornadas.
   * Nos dias folgados, a prioridade diária de `planejarDia` basta, e reservar tudo de antemão
   * tiraria flexibilidade (sobrecarregando o fim da semana).
   */
  private prealocarFuncoes(semana: Semana, dias: readonly DataISO[], alvos: ReadonlyArray<{ alvo: number; disponiveis: number }>): void {
    if (this.minimos.length === 0 && !this.turnos.some((t) => t.efetivoMinimo > 0)) return;
    // `funcao` indefinida = o efetivo mínimo do turno (qualquer pessoa).
    const daFuncao = (i: number, funcao: string | undefined): boolean => funcao === undefined || this.aptos[i]?.funcao === funcao;
    const presentesNo = (funcao: string | undefined, turnoId: string, dia: DataISO): number =>
      funcao === undefined ? this.presentesNoTurno(turnoId, dia) : this.daFuncaoNoTurno(funcao, turnoId, dia);
    const pendencias: Array<{
      disponiveis: number;
      fatia: number;
      ordemDia: number;
      dia: DataISO;
      turnoId: string;
      funcao: string | undefined;
      minimo: number;
    }> = [];
    dias.forEach((dia, posicaoDia) => {
      if (this.fechado(dia)) return;
      // `fatia`: posição do turno no dia. Os dias de cada turno são percorridos a partir de um
      // ponto diferente (`ordemDia`), o que escalona as folgas de quem cobre faixas diferentes
      // em vez de esvaziar os mesmos dias da semana.
      this.turnos
        .filter((t) => turnoFuncionaEm(t, dia))
        .forEach((turno, fatia) => {
          const requisitos: Array<{ funcao: string | undefined; minimo: number }> = [...this.minimos];
          if (turno.efetivoMinimo > 0 && !this.turnosSemEquipe.has(turno.id)) requisitos.push({ funcao: undefined, minimo: turno.efetivoMinimo });
          for (const { funcao, minimo } of requisitos) {
            const disponiveis = this.aptos.filter(
              (_, i) => daFuncao(i, funcao) && this.livreEm(i, dia) && this.opcoesDoDia(i, dia, false).some((o) => o.turnoId === turno.id),
            ).length;
            if (disponiveis <= minimo + 1) {
              const ordemDia = (posicaoDia - fatia * Math.ceil(dias.length / 2) + dias.length * 4) % dias.length;
              pendencias.push({
                disponiveis,
                fatia,
                ordemDia,
                dia,
                turnoId: turno.id,
                funcao,
                minimo,
              });
            }
          }
        });
    });
    pendencias.sort(
      (a, b) =>
        a.disponiveis - b.disponiveis ||
        a.fatia - b.fatia ||
        a.ordemDia - b.ordemDia ||
        compararTexto(a.dia, b.dia) ||
        this.ordemTurno(a.turnoId) - this.ordemTurno(b.turnoId) ||
        compararTexto(a.funcao ?? "", b.funcao ?? ""),
    );
    for (const { dia, turnoId, funcao, minimo } of pendencias) {
      let presentes = presentesNo(funcao, turnoId, dia);
      while (presentes < minimo) {
        const possiveis: Array<{ indice: number; opcao: Opcao }> = [];
        this.aptos.forEach((apto, indice) => {
          if (!daFuncao(indice, funcao) || !this.livreEm(indice, dia)) return;
          const alvo = alvos[indice]?.alvo ?? 0;
          if (this.minutosNovosNaSemana(apto.func.id, semana) + apto.duracaoRef > alvo) return;
          const opcao = this.opcoesElegiveis(indice, dia, semana, false).find((o) => o.turnoId === turnoId);
          if (opcao) possiveis.push({ indice, opcao });
        });
        const escolhido = minPor(possiveis, ({ indice }) => {
          const apto = this.aptos[indice];
          return [bit(this.folgaPlanejada(indice, dia)), this.agenda.diasNaSemana(apto?.func.id ?? "", semana), this.minutosPeriodo(indice), apto?.posicao ?? 0];
        });
        if (!escolhido) break;
        this.alocar(escolhido.indice, dia, escolhido.opcao);
        presentes++;
      }
    }
  }

  /** Quem passou do limite legal da semana (só possível com hora extra): um aviso informativo por pessoa. */
  private avisarExcessoSemanal(semana: Semana): void {
    if (!this.horaExtra) return;
    for (const apto of this.aptos) {
      const id = apto.func.id;
      if (this.minutosNovosNaSemana(id, semana) === 0) continue;
      const limite = limiteDoFuncionario(apto.func, this.limites(apto, semana));
      const feito = this.agenda.minutosNaSemana(id, semana);
      if (feito <= limite) continue;
      this.avisos.push({
        tipo: "excessoSemanal",
        data: semana.inicio,
        funcionarioId: id,
        mensagem: `${apto.func.nome}: ${formatarMinutos(feito)} na semana de ${formatarDiaMes(semana.inicio)} (limite ${formatarMinutos(limite)}), ${formatarMinutos(feito - limite)} de hora extra.`,
      });
    }
  }

  /**
   * Contrato menor que a jornada × dias (ex.: 30h com turno de 8h): a escala só fecha jornadas
   * inteiras, então sobra carga contratual sem escala. Só avisa; não encurta turnos.
   */
  private avisarContratoParcial(): void {
    const semana = semanasCobrindo(this.entrada.inicio, this.entrada.inicio, this.entrada.regras.inicioSemana)[0];
    if (!semana) return;
    for (const apto of this.aptos) {
      const contrato = apto.func.cargaSemanalMin;
      if (contrato === undefined || apto.duracaoRef <= 0) continue;
      const limites = this.limites(apto, semana);
      if (contrato > limites.cargaMaxMin) continue;
      const jornadas = Math.floor(contrato / apto.duracaoRef);
      if (jornadas > diasTrabalhoMax(limites) || jornadas * apto.duracaoRef >= contrato) continue;
      this.avisos.push({
        tipo: "cargaAbaixoDoAlvo",
        funcionarioId: apto.func.id,
        mensagem: `${apto.func.nome}: contrato de ${formatarMinutos(contrato)}, mas a escala fecha ${formatarMinutos(jornadas * apto.duracaoRef)} por semana porque o turno tem ${formatarMinutos(
          apto.duracaoRef,
        )}; ajuste a jornada da pessoa ou aceite.`,
      });
    }
  }

  /** Avisos da semana: cada função que ficou abaixo do mínimo num turno, com os dias. */
  private avisarFuncoesDescobertas(): void {
    const descobertas = [...this.funcoesDescobertas.values()].sort((a, b) => compararTexto(a.funcao, b.funcao) || compararTexto(a.turnoId, b.turnoId));
    this.funcoesDescobertas = new Map();
    for (const { funcao, turnoId, dias } of descobertas) {
      const turno = this.turnos.find((t) => t.id === turnoId)?.nome ?? "?";
      const m = this.entrada.minimoPorFuncao.get(funcao) ?? [...this.entrada.minimoPorFuncao.entries()].find(([k]) => chaveFuncao(k) === funcao)?.[1];
      const nome = m?.nome ?? funcao;
      const minimo = m?.minimo ?? 1;
      this.avisos.push({
        tipo: "funcaoDescoberta",
        data: dias[0],
        turnoId,
        mensagem: `${nome}: turno ${turno} sem o mínimo de ${minimo} pessoa(s) da função em ${dias.map(formatarDiaMes).join(", ")} (faltam pessoas da função com horas ou descanso livres).`,
      });
    }
  }

  concluir(): ResultadoPlanejamento {
    const alocacoes = [...this.novas].sort(
      (a, b) => compararTexto(a.data, b.data) || this.ordemTurno(a.turnoId) - this.ordemTurno(b.turnoId) || compararTexto(a.funcionarioId, b.funcionarioId),
    );
    // Avisos gerais (sem data) primeiro, depois em ordem cronológica.
    const avisos = [...this.avisos].sort(
      (a, b) =>
        bit(a.data !== undefined) - bit(b.data !== undefined) ||
        compararTexto(a.data ?? "", b.data ?? "") ||
        TIPOS_AVISO.indexOf(a.tipo) - TIPOS_AVISO.indexOf(b.tipo),
    );
    const previstos = [...this.previstos.entries()]
      .map(([chave, previstoMin]) => {
        const [funcionarioId = "", inicioSemana = ""] = chave.split("|");
        return { funcionarioId, inicioSemana, previstoMin };
      })
      .sort((a, b) => compararTexto(a.inicioSemana, b.inicioSemana) || compararTexto(a.funcionarioId, b.funcionarioId));
    return { alocacoes, avisos, previstos };
  }
}
