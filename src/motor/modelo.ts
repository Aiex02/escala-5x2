// Tipos de domínio usados pelo motor de escalas.

import type { InicioSemana } from "./calendario";
import type { DataISO } from "./data";
import { diaDaSemana } from "./data";
import { ErroMotor } from "./erros";
import type { Periodo } from "./funcionamento";
import { formatarMinutos, type Horario, MINUTOS_DIA, minutosTrabalhados, duracaoTotal } from "./hora";

// ---------------------------------------------------------------------------
// Regras de carga
// ---------------------------------------------------------------------------

/** Regras de carga horária do cliente (política da empresa). Durações em minutos. */
export interface RegrasCarga {
  /** Teto de minutos trabalhados por semana. Nunca é ultrapassado (sem hora extra). */
  cargaSemanalMaxMin: number;
  /** Teto de minutos trabalhados em uma jornada. */
  jornadaDiariaMaxMin: number;
  /** Descanso mínimo entre o fim de uma jornada e o início da seguinte. */
  descansoEntreJornadasMin: number;
  /** Máximo de dias seguidos trabalhados. */
  maxDiasConsecutivos: number;
  inicioSemana: InicioSemana;
  /** Folgas mínimas por semana de apuração (1 = até 6x1; 2 = até 5x2). */
  folgasSemanaisMin: number;
  /** Máximo de domingos seguidos trabalhados (0 = sem limite). Lei 10.101/2000: use 2 no comércio. */
  domingosSeguidosMax: number;
  /**
   * Jornada contratual padrão (ex.: 6h). Minutos acima dela numa jornada são hora extra
   * (CLT art. 59). Ausente = igual à jornada diária máxima (nunca há hora extra por extensão).
   */
  jornadaContratualMin?: number;
  /**
   * Hora extra como último recurso para cobrir efetivo mínimo e função mínima quando ninguém
   * cabe dentro das regras (padrão: true). Nunca quebra folgas, descanso entre jornadas nem
   * dias consecutivos (EC 141: hora extra não substitui o repouso). O que exceder vira saldo
   * positivo, compensado nos meses seguintes (banco de horas).
   */
  permitirHoraExtra?: boolean;
  /** Teto de hora extra por jornada (padrão: 120 min; CLT art. 59: até 2h, jornada total ≤ 10h). */
  horaExtraDiariaMaxMin?: number;
  /**
   * Teto de hora extra por semana (padrão: `horaExtraDiariaMaxMin` × dias de trabalho da semana).
   * Respeitado pelo motor ao cobrir furos com hora extra.
   */
  horaExtraSemanalMaxMin?: number;
  /**
   * Descanso mínimo entre a última saída antes de uma folga e a entrada seguinte (padrão: 35h =
   * 24h de repouso + 11h de descanso, CLT art. 66 e 67 e Súmula 110 do TST). 0 desliga a regra.
   */
  descansoSemanalMin?: number;
}

/** Teto absoluto da jornada com hora extra (CLT art. 59). */
export const JORNADA_MAX_COM_EXTRA_MIN = 10 * 60;
/** Hora extra máxima por jornada quando a regra não diz. */
export const HORA_EXTRA_DIARIA_PADRAO_MIN = 2 * 60;

/** CLT para 5x2: 40h semanais, 8h por dia, 11h entre jornadas, até 6 dias seguidos, semana de segunda a domingo. */
export const REGRAS_PADRAO: RegrasCarga = {
  cargaSemanalMaxMin: 40 * 60,
  jornadaDiariaMaxMin: 8 * 60,
  descansoEntreJornadasMin: 11 * 60,
  maxDiasConsecutivos: 6,
  inicioSemana: "segunda",
  folgasSemanaisMin: 1,
  domingosSeguidosMax: 0,
};

/** Hora extra ativa: permitida (padrão) e com jornada contratual definida (sem ela, vale o comportamento sem extra). */
export function horaExtraAtiva(r: RegrasCarga): boolean {
  return r.permitirHoraExtra !== false && r.jornadaContratualMin !== undefined;
}

/** Descanso semanal padrão: 24h de repouso + 11h de descanso entre jornadas. */
export const DESCANSO_SEMANAL_PADRAO_MIN = 35 * 60;

/** Hora extra máxima por jornada. */
export function horaExtraDiariaMax(r: RegrasCarga): number {
  return r.horaExtraDiariaMaxMin ?? HORA_EXTRA_DIARIA_PADRAO_MIN;
}

/** Hora extra máxima por semana, dado o número de dias de trabalho permitidos nela. */
export function horaExtraSemanalMax(r: RegrasCarga, diasTrabalho: number): number {
  return r.horaExtraSemanalMaxMin ?? horaExtraDiariaMax(r) * Math.max(0, diasTrabalho);
}

/** Descanso mínimo ao redor de uma folga (nunca menor que o descanso entre jornadas). */
export function descansoSemanalMin(r: RegrasCarga): number {
  const valor = r.descansoSemanalMin ?? DESCANSO_SEMANAL_PADRAO_MIN;
  return valor <= 0 ? 0 : Math.max(valor, r.descansoEntreJornadasMin);
}

/**
 * Maior jornada (minutos trabalhados) aceita por dia: a jornada diária máxima e, com hora extra
 * ativa, até min(contratual + extra, 10h, diária máxima + extra).
 */
export function jornadaMaxComExtraMin(r: RegrasCarga): number {
  if (!horaExtraAtiva(r)) return r.jornadaDiariaMaxMin;
  const extra = horaExtraDiariaMax(r);
  const contratual = r.jornadaContratualMin ?? r.jornadaDiariaMaxMin;
  return Math.max(r.jornadaDiariaMaxMin, Math.min(contratual + extra, JORNADA_MAX_COM_EXTRA_MIN, r.jornadaDiariaMaxMin + extra));
}

/** Minutos da jornada acima da jornada contratual (0 sem jornada contratual). */
export function minutosExtras(a: Alocacao, regras: RegrasCarga): number {
  if (regras.jornadaContratualMin === undefined) return 0;
  return Math.max(0, minutosTrabalhados(a.horario) - regras.jornadaContratualMin);
}

/** A jornada passa da jornada contratual (hora extra por extensão)? */
export function ehHoraExtra(a: Alocacao, regras: RegrasCarga): boolean {
  return minutosExtras(a, regras) > 0;
}

/** Lista os problemas das regras (vazia se estiverem válidas). */
export function errosDasRegras(r: RegrasCarga): string[] {
  const erros: string[] = [];
  const inteiro = (n: number) => Number.isInteger(n);
  if (!inteiro(r.cargaSemanalMaxMin) || r.cargaSemanalMaxMin < 1 || r.cargaSemanalMaxMin > 7 * MINUTOS_DIA) {
    erros.push("A carga semanal máxima deve estar entre 1 minuto e 168 horas.");
  }
  if (!inteiro(r.jornadaDiariaMaxMin) || r.jornadaDiariaMaxMin < 1 || r.jornadaDiariaMaxMin > MINUTOS_DIA) {
    erros.push("A jornada diária máxima deve estar entre 1 minuto e 24 horas.");
  }
  if (erros.length === 0 && r.jornadaDiariaMaxMin > r.cargaSemanalMaxMin) {
    erros.push(
      `A jornada diária máxima (${formatarMinutos(r.jornadaDiariaMaxMin)}) não pode ser maior que a carga semanal (${formatarMinutos(r.cargaSemanalMaxMin)}).`,
    );
  }
  if (!inteiro(r.descansoEntreJornadasMin) || r.descansoEntreJornadasMin < 0 || r.descansoEntreJornadasMin > 2 * MINUTOS_DIA) {
    erros.push("O descanso entre jornadas deve ser de no máximo 48 horas.");
  }
  if (!inteiro(r.maxDiasConsecutivos) || r.maxDiasConsecutivos < 1 || r.maxDiasConsecutivos > 31) {
    erros.push("O máximo de dias consecutivos deve estar entre 1 e 31.");
  }
  if (r.inicioSemana !== "segunda" && r.inicioSemana !== "domingo") {
    erros.push("O início da semana deve ser segunda ou domingo.");
  }
  if (!inteiro(r.folgasSemanaisMin) || r.folgasSemanaisMin < 0 || r.folgasSemanaisMin > 6) {
    erros.push("As folgas semanais devem ficar entre 0 e 6.");
  }
  if (!inteiro(r.domingosSeguidosMax) || r.domingosSeguidosMax < 0 || r.domingosSeguidosMax > 52) {
    erros.push("O máximo de domingos seguidos deve ficar entre 0 (sem limite) e 52.");
  }
  if (r.horaExtraDiariaMaxMin !== undefined && (!inteiro(r.horaExtraDiariaMaxMin) || r.horaExtraDiariaMaxMin < 0 || r.horaExtraDiariaMaxMin > 240)) {
    erros.push("A hora extra diária máxima deve ficar entre 0 e 4 horas.");
  }
  if (r.horaExtraSemanalMaxMin !== undefined && (!inteiro(r.horaExtraSemanalMaxMin) || r.horaExtraSemanalMaxMin < 0 || r.horaExtraSemanalMaxMin > 40 * 60)) {
    erros.push("A hora extra semanal máxima deve ficar entre 0 e 40 horas.");
  }
  if (r.descansoSemanalMin !== undefined && (!inteiro(r.descansoSemanalMin) || r.descansoSemanalMin < 0 || r.descansoSemanalMin > 4 * MINUTOS_DIA)) {
    erros.push("O descanso semanal deve ser de no máximo 96 horas.");
  }
  if (r.jornadaContratualMin !== undefined) {
    if (!inteiro(r.jornadaContratualMin) || r.jornadaContratualMin < 1) {
      erros.push("A jornada contratual deve ter pelo menos 1 minuto.");
    } else if (inteiro(r.jornadaDiariaMaxMin) && r.jornadaContratualMin > r.jornadaDiariaMaxMin) {
      erros.push(
        `A jornada contratual (${formatarMinutos(r.jornadaContratualMin)}) não pode ser maior que a jornada diária máxima (${formatarMinutos(r.jornadaDiariaMaxMin)}).`,
      );
    }
  }
  return erros;
}

/** Lança `ErroMotor` ("regrasInvalidas") se as regras forem inválidas. */
export function validarRegras(regras: RegrasCarga): void {
  const erros = errosDasRegras(regras);
  if (erros.length > 0) throw new ErroMotor("regrasInvalidas", erros[0] ?? "Regras de carga inválidas.");
}

// ---------------------------------------------------------------------------
// Dias da semana (bits: bit 0 = segunda ... bit 6 = domingo)
// ---------------------------------------------------------------------------

/** Conjunto de dias da semana em bits (bit 0 = segunda ... bit 6 = domingo). */
export type DiasSemana = number;

export const TODOS_OS_DIAS: DiasSemana = 0b111_1111;
export const NENHUM_DIA: DiasSemana = 0;

/** Índices 0 = segunda ... 6 = domingo; valores fora da faixa são ignorados. */
export function diasDeIndices(indices: Iterable<number>): DiasSemana {
  let bits = 0;
  for (const i of indices) {
    if (Number.isInteger(i) && i >= 0 && i < 7) bits |= 1 << i;
  }
  return bits;
}

export function indicesDias(dias: DiasSemana): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((i) => (dias & (1 << i)) !== 0);
}

/** O conjunto contém o dia da semana de índice `indice` (0 = segunda)? */
export function contemDia(dias: DiasSemana, indice: number): boolean {
  return (dias & (1 << indice)) !== 0;
}

export function uniaoDias(a: DiasSemana, b: DiasSemana): DiasSemana {
  return (a | b) & TODOS_OS_DIAS;
}

// ---------------------------------------------------------------------------
// Turnos e funcionários
// ---------------------------------------------------------------------------

/** Turno do cliente (ex.: Manhã 10:00–16:15). */
export interface Turno {
  id: string;
  nome: string;
  horario: Horario;
  /** Pessoas mínimas por dia neste turno (0 = sem mínimo). */
  efetivoMinimo: number;
  ordem: number;
  /** Dias da semana em que o turno funciona; fora deles ninguém é escalado nele. */
  dias: DiasSemana;
}

/** O turno funciona na data? */
export function turnoFuncionaEm(turno: Pick<Turno, "dias">, data: DataISO): boolean {
  return contemDia(turno.dias, diaDaSemana(data));
}

/** Funcionário como o motor o enxerga. Todos podem trabalhar em qualquer turno; só há preferência de período. */
export interface FuncionarioPlano {
  id: string;
  nome: string;
  /** Carga contratual individual; o teto efetivo é o menor entre ela e o limite da semana. */
  cargaSemanalMin?: number;
  /** Ausências justificadas (férias, atestados): não trabalha e a jornada do dia é abonada. */
  indisponivel: Set<DataISO>;
  /** Faltas (não justificadas): não trabalha, mas as horas do dia continuam previstas (fica devendo). */
  faltas: Set<DataISO>;
  /** Período preferido; atendido enquanto houver vaga nele. */
  preferencia?: Periodo;
  /** Saldo de horas de antes do período (positivo = horas a mais, negativo = devendo), em minutos. */
  saldoAnteriorMin: number;
  /** Função (cargo), de preferência já normalizada por `chaveFuncao`. */
  funcao?: string;
  /** Fora das regras de jornada da EC 141 (só valem as regras da empresa). */
  isentoRegime: boolean;
}

/** Pode ser escalado no dia (sem ausência nem falta). */
export function disponivelEm(f: Pick<FuncionarioPlano, "indisponivel" | "faltas">, data: DataISO): boolean {
  return !f.indisponivel.has(data) && !f.faltas.has(data);
}

/** Mínimo de pessoas de uma função em cada turno de cada dia. */
export interface FuncaoMinima {
  /** Nome para os avisos (ex.: "Cozinheiro"). */
  nome: string;
  minimo: number;
}

/**
 * Chave de uma função para agrupar cargos escritos de jeitos diferentes:
 * "Farmacêutica (o)" e "farmaceutica" viram "farmaceutica".
 */
export function chaveFuncao(cargo: string): string {
  return cargo
    .toLowerCase()
    .replace(/\((as|os|a|o)\)/g, "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

// ---------------------------------------------------------------------------
// Alocações e avisos
// ---------------------------------------------------------------------------

/** Um funcionário escalado em um turno em uma data, com o horário efetivo da jornada. */
export interface Alocacao {
  funcionarioId: string;
  turnoId: string;
  data: DataISO;
  horario: Horario;
  /**
   * Como a jornada nasceu: "normal" (ou ausente), "compensacao" (horário alterado para zerar
   * saldo de horas) ou "horaExtra" (estendida além da jornada contratual para cobrir um furo).
   */
  origem?: OrigemAlocacao;
}

export type OrigemAlocacao = "normal" | "compensacao" | "horaExtra";

export function minutosDaAlocacao(a: Alocacao): number {
  return minutosTrabalhados(a.horario);
}

export type TipoAviso =
  /** Turno ficou abaixo do efetivo mínimo em um dia. */
  | "coberturaInsuficiente"
  /** Horário do turno excede a jornada diária máxima; o turno é ignorado. */
  | "turnoExcedeJornada"
  /** Funcionário sem nenhum turno possível; não é escalado. */
  | "funcionarioSemTurno"
  /** Funcionário ficou pelo menos uma jornada abaixo da carga-alvo da semana. */
  | "cargaAbaixoDoAlvo"
  /** Alocação existente viola as regras. */
  | "violacaoRegra"
  /** Turno ficou sem o mínimo de pessoas de uma função em algum dia. */
  | "funcaoDescoberta"
  /** Jornada estendida com hora extra para cobrir efetivo ou função (informativo; vira saldo a compensar). */
  | "horaExtra"
  /** Furo coberto só em parte: sobrou uma faixa de horário descoberta no turno. */
  | "coberturaParcial"
  /** Semana acima do limite legal (hora extra; informativo, não é violação). */
  | "excessoSemanal";

export const TIPOS_AVISO: readonly TipoAviso[] = [
  "coberturaInsuficiente",
  "turnoExcedeJornada",
  "funcionarioSemTurno",
  "cargaAbaixoDoAlvo",
  "violacaoRegra",
  "funcaoDescoberta",
  "horaExtra",
  "coberturaParcial",
  "excessoSemanal",
];

export function ehTipoAviso(texto: string): texto is TipoAviso {
  return (TIPOS_AVISO as readonly string[]).includes(texto);
}

export interface Aviso {
  tipo: TipoAviso;
  data?: DataISO;
  turnoId?: string;
  funcionarioId?: string;
  mensagem: string;
}

/** Duração total (entrada à saída, com intervalo) da jornada da alocação. */
export function duracaoDaAlocacao(a: Alocacao): number {
  return duracaoTotal(a.horario);
}
