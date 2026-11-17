// Horas previstas por semana e saldo de horas.
//
// O "previsto" é o que a pessoa deve cumprir numa semana completa: jornadas inteiras dentro
// do limite semanal, das folgas obrigatórias e dos dias em que o estabelecimento abre, menos
// uma jornada por ausência justificada nesses dias (a ausência em dia de folga não tira dias de
// trabalho). Falta não abona. O saldo (feito − previsto)
// é o que o motor compensa nos meses seguintes.

import type { Semana } from "./calendario";
import { type DataISO, diaDaSemana } from "./data";
import { minutosTrabalhados } from "./hora";
import { type Alocacao, contemDia, type FuncionarioPlano, indicesDias, minutosDaAlocacao, minutosDoTurnoPara, type Turno } from "./modelo";
import { diasTrabalhoMax, type LimitesSemana, limiteDoFuncionario } from "./regime";

/**
 * Jornada normal da equipe: a do turno (entre os que cabem na jornada diária máxima) que
 * funciona mais dias na semana; no empate, a mais longa. Um turno curto de um dia só não
 * muda a referência. `null` se nenhum turno serve. Com `funcionario`, as jornadas são medidas
 * com a hora não trabalhada dele (almoço próprio) no lugar do intervalo da loja.
 */
export function jornadaDeReferencia(
  turnos: readonly Turno[],
  jornadaDiariaMaxMin: number,
  funcionario?: Pick<FuncionarioPlano, "horasNaoTrabalhadasMin">,
): number | null {
  let melhor: { dias: number; minutos: number } | null = null;
  for (const t of turnos) {
    const minutos = funcionario === undefined ? minutosTrabalhados(t.horario) : minutosDoTurnoPara(funcionario, t);
    if (minutos <= 0 || minutos > jornadaDiariaMaxMin) continue;
    const dias = indicesDias(t.dias).length;
    if (melhor === null || dias > melhor.dias || (dias === melhor.dias && minutos >= melhor.minutos)) {
      melhor = { dias, minutos };
    }
  }
  return melhor?.minutos ?? null;
}

/**
 * Jornada da semana pelas jornadas que a pessoa fez: a duração normal do turno (sem
 * compensação) mais frequente; no empate, a mais longa. `null` sem jornadas na semana.
 * Com `funcionario`, a duração normal do turno já desconta a hora não trabalhada dele.
 */
export function jornadaDaSemana(
  alocacoes: readonly Alocacao[],
  turnosPorId: ReadonlyMap<string, Turno>,
  funcionario?: Pick<FuncionarioPlano, "horasNaoTrabalhadasMin">,
): number | null {
  const contagem = new Map<number, number>();
  for (const a of alocacoes) {
    const turno = turnosPorId.get(a.turnoId);
    const doTurno = turno === undefined ? 0 : funcionario === undefined ? minutosTrabalhados(turno.horario) : minutosDoTurnoPara(funcionario, turno);
    const minutos = turno && doTurno > 0 ? doTurno : minutosDaAlocacao(a);
    contagem.set(minutos, (contagem.get(minutos) ?? 0) + 1);
  }
  let melhor: { minutos: number; n: number } | null = null;
  for (const [minutos, n] of contagem) {
    if (melhor === null || n > melhor.n || (n === melhor.n && minutos > melhor.minutos)) melhor = { minutos, n };
  }
  return melhor?.minutos ?? null;
}

/** Ajustes ao previsto da semana: dias que a pessoa não pode trabalhar por razões da escala (não da lei). */
export interface OpcoesPrevisto {
  /** Dias fechados (feriados): não contam como abertos. */
  diasFechados?: ReadonlySet<DataISO>;
  /**
   * Dias abertos em que a pessoa não trabalha por folga obrigatória (ex.: domingo do rodízio),
   * sem ser ausência justificada: não são abonados, mas também não podem ser trabalhados.
   */
  diasDeFolga?: ReadonlySet<DataISO>;
  /** Jornadas a menos na semana porque o máximo de dias consecutivos impede (ver `folgasExtrasForcadas` do motor). */
  jornadasAMenos?: number;
}

/**
 * Horas previstas da semana completa para o funcionário, em minutos: as jornadas inteiras que
 * cabem no limite semanal, nos dias de trabalho permitidos e nos dias abertos em que a pessoa
 * pode estar (sem ausência justificada, folga obrigatória nem dia fechado). Uma ausência em dia
 * que seria folga não tira dias de trabalho: a folga passa a ser a ausência.
 */
export function previstoDaSemana(
  funcionario: Pick<FuncionarioPlano, "cargaSemanalMin" | "indisponivel">,
  turnos: readonly Turno[],
  limites: LimitesSemana,
  semana: Semana,
  jornadaMin: number,
  opcoes: OpcoesPrevisto = {},
): number {
  if (jornadaMin <= 0) return 0;
  const abertos = semana
    .dias()
    .filter((d) => turnos.some((t) => contemDia(t.dias, diaDaSemana(d))) && !opcoes.diasFechados?.has(d));
  const possiveis = abertos.filter((d) => !funcionario.indisponivel.has(d) && !opcoes.diasDeFolga?.has(d)).length;
  const jornadas = Math.max(
    0,
    Math.min(Math.floor(limiteDoFuncionario(funcionario, limites) / jornadaMin), diasTrabalhoMax(limites), possiveis - Math.max(0, opcoes.jornadasAMenos ?? 0)),
  );
  return jornadas * jornadaMin;
}

/** Minutos trabalhados pelo funcionário na semana (soma de todas as alocações dela). */
export function minutosNaSemana(alocacoes: readonly Alocacao[], funcionarioId: string, semana: Semana): number {
  let total = 0;
  for (const a of alocacoes) {
    if (a.funcionarioId === funcionarioId && semana.contem(a.data)) total += minutosDaAlocacao(a);
  }
  return total;
}

/** Saldo da semana: feito − previsto (positivo = horas a mais). */
export function saldoDaSemana(feitoMin: number, previstoMin: number): number {
  return feitoMin - previstoMin;
}
