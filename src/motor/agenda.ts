// Funções puras para a tela do Quadro: horas feitas × previstas por semana, pessoas por turno
// em cada dia e funções sem cobertura.

import type { Semana } from "./calendario";
import type { DataISO } from "./data";
import {
  type Alocacao,
  chaveFuncao,
  type FuncaoMinima,
  type FuncionarioPlano,
  horaExtraAtiva,
  minutosDaAlocacao,
  minutosExtras,
  type RegrasCarga,
  type Turno,
  turnoFuncionaEm,
} from "./modelo";
import { type EtapaRegime, limiteDoFuncionario, limitesDoFuncionarioNaSemana } from "./regime";
import { jornadaDaSemana, jornadaDeReferencia, previstoDaSemana, saldoDaSemana } from "./saldo";

export interface LinhaResumoSemanal {
  funcionarioId: string;
  /** Minutos trabalhados na semana (inclusive dias de meses vizinhos). */
  feitoMin: number;
  /** Horas que a pessoa deve cumprir na semana (ausências justificadas abonadas). */
  previstoMin: number;
  /** Teto semanal da pessoa (contrato, empresa e lei). */
  limiteMin: number;
  /** feito − previsto (positivo = horas a mais). */
  saldoMin: number;
  /**
   * Hora extra da semana: o maior entre o que as jornadas passam da jornada contratual (sem as
   * alteradas por compensação) e o que a semana passa do limite semanal. Já está dentro do saldo.
   */
  horaExtraMin: number;
}

export interface EntradaResumoSemanal {
  semana: Semana;
  funcionarios: readonly FuncionarioPlano[];
  turnos: readonly Turno[];
  regras: RegrasCarga;
  regime: readonly EtapaRegime[];
  /** Todas as alocações conhecidas da semana (do mês e dos vizinhos). */
  alocacoes: readonly Alocacao[];
  /** Previsto já gravado de semanas fechadas (por funcionário); tem prioridade sobre o cálculo. */
  previstosGravados?: ReadonlyMap<string, number>;
  /** Dias fechados (feriados): não contam como abertos no previsto. */
  diasFechados?: ReadonlySet<DataISO>;
}

/** Horas feitas × previstas de cada funcionário na semana. */
export function resumoSemanal(entrada: EntradaResumoSemanal): LinhaResumoSemanal[] {
  const { semana, turnos, regras, regime, alocacoes } = entrada;
  const turnosPorId = new Map(turnos.map((t) => [t.id, t]));
  const referencia = jornadaDeReferencia(turnos, regras.jornadaDiariaMaxMin);
  return entrada.funcionarios.map((f) => {
    const daSemana = alocacoes.filter((a) => a.funcionarioId === f.id && semana.contem(a.data));
    const feitoMin = daSemana.reduce((s, a) => s + minutosDaAlocacao(a), 0);
    const limites = limitesDoFuncionarioNaSemana(f, regras, regime, semana);
    const gravado = entrada.previstosGravados?.get(f.id);
    const jornada = jornadaDaSemana(daSemana, turnosPorId) ?? referencia ?? 0;
    const previstoMin = gravado ?? previstoDaSemana(f, turnos, limites, semana, jornada, { diasFechados: entrada.diasFechados });
    const limiteMin = limiteDoFuncionario(f, limites);
    const extraDiaria = daSemana.filter((a) => a.origem !== "compensacao").reduce((s, a) => s + minutosExtras(a, regras), 0);
    const extraSemanal = horaExtraAtiva(regras) ? Math.max(0, feitoMin - limiteMin) : 0;
    const horaExtraMin = horaExtraAtiva(regras) ? Math.max(extraDiaria, extraSemanal) : 0;
    return { funcionarioId: f.id, feitoMin, previstoMin, limiteMin, saldoMin: saldoDaSemana(feitoMin, previstoMin), horaExtraMin };
  });
}

/** Pessoas escaladas em cada turno em cada data (dias fechados ignorados): data → (turnoId → quantidade). */
export function pessoasPorTurnoDia(alocacoes: readonly Alocacao[], diasFechados?: ReadonlySet<DataISO>): Map<DataISO, Map<string, number>> {
  const mapa = new Map<DataISO, Map<string, number>>();
  for (const a of alocacoes) {
    if (diasFechados?.has(a.data)) continue;
    const doDia = mapa.get(a.data) ?? new Map<string, number>();
    doDia.set(a.turnoId, (doDia.get(a.turnoId) ?? 0) + 1);
    mapa.set(a.data, doDia);
  }
  return mapa;
}

export interface FuncaoDescobertaNoDia {
  data: DataISO;
  turnoId: string;
  /** Chave normalizada da função. */
  funcao: string;
  /** Nome para exibir (ex.: "Cozinheiro"). */
  nome: string;
  presentes: number;
  minimo: number;
}

export interface EntradaFuncoesDescobertas {
  datas: readonly DataISO[];
  alocacoes: readonly Alocacao[];
  funcionarios: readonly FuncionarioPlano[];
  turnos: readonly Turno[];
  minimoPorFuncao: ReadonlyMap<string, FuncaoMinima>;
  /** Dias fechados (feriados): sem exigência de cobertura. */
  diasFechados?: ReadonlySet<DataISO>;
}

/** Turnos e dias em que alguma função ficou abaixo do mínimo (só nos dias em que o turno funciona). */
export function funcoesDescobertas(entrada: EntradaFuncoesDescobertas): FuncaoDescobertaNoDia[] {
  const funcaoDe = new Map<string, string | undefined>(entrada.funcionarios.map((f) => [f.id, f.funcao === undefined ? undefined : chaveFuncao(f.funcao)]));
  const minimos = [...entrada.minimoPorFuncao.entries()]
    .map(([chave, m]) => ({ funcao: chaveFuncao(chave), nome: m.nome, minimo: m.minimo }))
    .filter((m) => m.minimo > 0);
  const resultado: FuncaoDescobertaNoDia[] = [];
  for (const data of entrada.datas) {
    if (entrada.diasFechados?.has(data)) continue;
    const doDia = entrada.alocacoes.filter((a) => a.data === data);
    for (const turno of entrada.turnos) {
      if (!turnoFuncionaEm(turno, data)) continue;
      for (const m of minimos) {
        const presentes = doDia.filter((a) => a.turnoId === turno.id && funcaoDe.get(a.funcionarioId) === m.funcao).length;
        if (presentes < m.minimo) resultado.push({ data, turnoId: turno.id, funcao: m.funcao, nome: m.nome, presentes, minimo: m.minimo });
      }
    }
  }
  return resultado;
}
