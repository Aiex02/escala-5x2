// Índice de alocações por funcionário e data, usado pelo motor para checar restrições de
// forma incremental. Uso interno do motor (não faz parte da API pública).

import type { Semana } from "./calendario";
import { type DataISO, diasDesdeEpoca, somarDias } from "./data";
import { type Alocacao, minutosDaAlocacao } from "./modelo";

/** Quantos dias para trás/frente procurar a jornada vizinha (descanso e histórico de turno). */
const ALCANCE_DIAS = 8;

export class IndiceAlocacoes {
  private readonly porFuncionario = new Map<string, Map<DataISO, Alocacao>>();

  inserir(a: Alocacao): void {
    let mapa = this.porFuncionario.get(a.funcionarioId);
    if (!mapa) {
      mapa = new Map();
      this.porFuncionario.set(a.funcionarioId, mapa);
    }
    mapa.set(a.data, a);
  }

  em(funcionarioId: string, data: DataISO): Alocacao | undefined {
    return this.porFuncionario.get(funcionarioId)?.get(data);
  }

  minutosNaSemana(funcionarioId: string, semana: Semana): number {
    const mapa = this.porFuncionario.get(funcionarioId);
    if (!mapa) return 0;
    let total = 0;
    for (const d of semana.dias()) {
      const a = mapa.get(d);
      if (a) total += minutosDaAlocacao(a);
    }
    return total;
  }

  /** Dias com jornada na semana (fixas e novas). */
  diasNaSemana(funcionarioId: string, semana: Semana): number {
    const mapa = this.porFuncionario.get(funcionarioId);
    if (!mapa) return 0;
    return semana.dias().filter((d) => mapa.has(d)).length;
  }

  /** Domingos (ou o mesmo dia da semana de `data`) trabalhados seguidos antes e depois, de 7 em 7 dias. */
  mesmosDiasSeguidos(funcionarioId: string, data: DataISO): [antes: number, depois: number] {
    const contar = (passo: number): number => {
      let total = 0;
      let d = somarDias(data, passo);
      while (this.em(funcionarioId, d)) {
        total++;
        d = somarDias(d, passo);
      }
      return total;
    };
    return [contar(-7), contar(7)];
  }

  /** Quantos dias iguais ao de `data` (ex.: domingos) trabalhou nas `semanas` anteriores. */
  mesmosDiasTrabalhados(funcionarioId: string, data: DataISO, semanas: number): number {
    let n = 0;
    for (let k = 1; k <= semanas; k++) {
      if (this.em(funcionarioId, somarDias(data, -7 * k))) n++;
    }
    return n;
  }

  /** Última alocação antes de `data` (procura até `ALCANCE_DIAS` dias para trás). */
  anterior(funcionarioId: string, data: DataISO): Alocacao | undefined {
    const mapa = this.porFuncionario.get(funcionarioId);
    if (!mapa) return undefined;
    for (let k = 1; k <= ALCANCE_DIAS; k++) {
      const a = mapa.get(somarDias(data, -k));
      if (a) return a;
    }
    return undefined;
  }

  /** Primeira alocação depois de `data` (procura até `ALCANCE_DIAS` dias para frente). */
  seguinte(funcionarioId: string, data: DataISO): Alocacao | undefined {
    const mapa = this.porFuncionario.get(funcionarioId);
    if (!mapa) return undefined;
    for (let k = 1; k <= ALCANCE_DIAS; k++) {
      const a = mapa.get(somarDias(data, k));
      if (a) return a;
    }
    return undefined;
  }

  /** Dias trabalhados imediatamente antes de `data`, sem interrupção. */
  diasSeguidosAntes(funcionarioId: string, data: DataISO): number {
    let total = 0;
    let d = somarDias(data, -1);
    while (this.em(funcionarioId, d)) {
      total++;
      d = somarDias(d, -1);
    }
    return total;
  }

  /** Dias trabalhados imediatamente depois de `data`, sem interrupção. */
  diasSeguidosDepois(funcionarioId: string, data: DataISO): number {
    let total = 0;
    let d = somarDias(data, 1);
    while (this.em(funcionarioId, d)) {
      total++;
      d = somarDias(d, 1);
    }
    return total;
  }
}

/** Minuto absoluto (desde 1970) em que a jornada começa. */
export function inicioAbsoluto(a: Alocacao): number {
  return diasDesdeEpoca(a.data) * 1440 + a.horario.inicioMin;
}

/** Minuto absoluto em que a jornada termina. */
export function fimAbsoluto(a: Alocacao): number {
  const h = a.horario;
  const duracao = h.fimMin <= h.inicioMin ? 1440 - h.inicioMin + h.fimMin : h.fimMin - h.inicioMin;
  return inicioAbsoluto(a) + duracao;
}
