import type { AgendaMes } from "../../api/types";

export interface Totais {
  minutos: number;
  dias: number;
  /** Soma de (horas − previstas) das semanas fechadas. */
  saldo: number;
  /** A pessoa tem ao menos uma semana fechada (senão o saldo não existe). */
  temSemana: boolean;
  /** Há semanas que continuam num mês sem escala e ficaram fora do saldo. */
  parcial: boolean;
}

/** Horas e dias do mês de cada pessoa; o saldo segue a mesma regra do resumo semanal. */
export function calcularTotais(agenda: AgendaMes): Map<number, Totais> {
  const mapa = new Map<number, Totais>();
  const diasTrabalhados = new Map<number, Set<string>>();
  const obter = (id: number): Totais => {
    const existente = mapa.get(id);
    if (existente) return existente;
    const novo: Totais = { minutos: 0, dias: 0, saldo: 0, temSemana: false, parcial: false };
    mapa.set(id, novo);
    return novo;
  };
  for (const a of agenda.alocacoes) {
    obter(a.funcionarioId).minutos += a.minutosTrabalhados;
    const datas = diasTrabalhados.get(a.funcionarioId) ?? new Set<string>();
    datas.add(a.data);
    diasTrabalhados.set(a.funcionarioId, datas);
  }
  for (const [id, datas] of diasTrabalhados) obter(id).dias = datas.size;
  for (const semana of agenda.semanas) {
    for (const h of semana.funcionarios) {
      const t = obter(h.funcionarioId);
      if (semana.pendente) {
        t.parcial = true;
      } else {
        t.temSemana = true;
        t.saldo += h.minutos - h.previstoMin;
      }
    }
  }
  return mapa;
}

/** Quantas pessoas têm saldo acumulado diferente de zero: o "Acumulado" do Quadro (saldo anterior + semanas fechadas do mês). */
export function pessoasComSaldoAcumulado(agenda: AgendaMes): number {
  const totais = calcularTotais(agenda);
  return agenda.funcionarios.filter((f) => f.saldoAnteriorMin + (totais.get(f.id)?.saldo ?? 0) !== 0).length;
}
