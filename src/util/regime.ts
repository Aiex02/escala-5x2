// Fases do regime da EC 141/2026 (fim da escala 6x1). Mesma regra do backend: a
// tela de configurações mostra a prévia com os valores do formulário e o backend
// simulado (`api/mock.ts`) usa a mesma conta ao salvar.

import type { FaseRegime, RegimeLegal, Regras } from "../api/types";
import { adicionarDias, formatarData, montarData, separarData } from "./datas";
import { formatarNumero } from "./formato";

/** Publicação da EC 141 usada quando o cliente ainda não informou outra data. */
export const PUBLICACAO_EC141_PADRAO = "2026-10-16";

export function somarMeses(data: string, meses: number): string {
  const { ano, mes, dia } = separarData(data);
  const total = ano * 12 + (mes - 1) + meses;
  return montarData(Math.floor(total / 12), (total % 12) + 1, dia);
}

/**
 * As três fases da lei, já combinadas com as regras da empresa (vale o mais restritivo):
 * regra anterior até 2 meses após a publicação, 42h e 2 folgas por 12 meses, depois 40h.
 * Sem o regime da EC 141 (ou sem data), não há fases.
 */
export function calcularFases(regime: RegimeLegal, publicacao: string | null, cargaSemanalMaxHoras: number, folgasSemanaisMin: number): FaseRegime[] {
  if (regime !== "ec141" || !publicacao) return [];
  const d1 = somarMeses(publicacao, 2);
  const d2 = somarMeses(d1, 12);
  const legais: [string | null, string | null, number, number][] = [
    [null, adicionarDias(d1, -1), 44, 1],
    [d1, adicionarDias(d2, -1), 42, 2],
    [d2, null, 40, 2],
  ];
  return legais.map(([desde, ate, carga, folgas]) => {
    const h = Number.isNaN(cargaSemanalMaxHoras) ? carga : Math.min(carga, cargaSemanalMaxHoras);
    const f = Number.isNaN(folgasSemanaisMin) ? folgas : Math.max(folgas, folgasSemanaisMin);
    return { desde, ate, cargaSemanalMaxHoras: h, folgasSemanaisMin: f, descricao: `Até ${formatarNumero(h)}h e ${f} ${f === 1 ? "folga" : "folgas"} por semana` };
  });
}

/** As regras com as fases recalculadas pelos próprios valores (regime, publicação, carga e folgas). */
export function comFases(r: Regras): Regras {
  return { ...r, fases: calcularFases(r.regime, r.ec141Publicacao, r.cargaSemanalMaxHoras, r.folgasSemanaisMin) };
}

/** Índice da fase em vigor em `hoje` (-1 sem fases). */
export function faseEmVigor(fases: readonly FaseRegime[], hoje: string): number {
  let atual = -1;
  fases.forEach((f, i) => {
    if (f.desde === null || f.desde <= hoje) atual = i;
  });
  return atual;
}

/** "Até 15/12/2026", "De 16/12/2026 a 15/12/2027", "A partir de 16/12/2027". */
export function periodoDaFase(f: FaseRegime): string {
  if (f.desde && f.ate) return `De ${formatarData(f.desde)} a ${formatarData(f.ate)}`;
  if (f.ate) return `Até ${formatarData(f.ate)}`;
  if (f.desde) return `A partir de ${formatarData(f.desde)}`;
  return "Sempre";
}
