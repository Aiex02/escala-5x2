// Semanas de apuração. A carga semanal é apurada em semanas completas de 7 dias
// (segunda–domingo ou domingo–sábado): um mês que começa ou termina no meio da semana
// divide essa semana com o mês vizinho e o motor soma as horas dos dois lados.

import { type DataISO, diaDaSemana, somarDias } from "./data";

/** Dia em que começa a semana de apuração. */
export type InicioSemana = "segunda" | "domingo";

/** 7 dias consecutivos a partir de `inicio`. */
export interface Semana {
  inicio: DataISO;
  fim: DataISO;
  /** Os 7 dias, em ordem. */
  dias(): DataISO[];
  contem(data: DataISO): boolean;
}

function criarSemana(inicio: DataISO): Semana {
  const fim = somarDias(inicio, 6);
  return {
    inicio,
    fim,
    dias: () => Array.from({ length: 7 }, (_, i) => somarDias(inicio, i)),
    contem: (data) => inicio <= data && data <= fim,
  };
}

/** Semana de apuração que contém `data`. */
export function semanaContendo(data: DataISO, inicioSemana: InicioSemana): Semana {
  const idx = diaDaSemana(data);
  const recuo = inicioSemana === "segunda" ? idx : (idx + 1) % 7;
  return criarSemana(somarDias(data, -recuo));
}

/** Semanas completas que cobrem `[inicio, fim]` (inclusive), em ordem. */
export function semanasCobrindo(inicio: DataISO, fim: DataISO, inicioSemana: InicioSemana): Semana[] {
  const semanas: Semana[] = [];
  if (fim < inicio) return semanas;
  let atual = semanaContendo(inicio, inicioSemana);
  for (;;) {
    semanas.push(atual);
    if (atual.fim >= fim) break;
    atual = criarSemana(somarDias(atual.fim, 1));
  }
  return semanas;
}

/** Dia da semana (0 = segunda ... 6 = domingo) é domingo? */
export function ehDomingo(data: DataISO): boolean {
  return diaDaSemana(data) === 6;
}
