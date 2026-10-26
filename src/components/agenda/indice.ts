import type { AgendaMes, Alocacao, FuncionarioResumo, Turno } from "../../api/types";
import { diaDaSemana } from "../../util/datas";
import { compararTexto, normalizarTexto } from "../../util/formato";

/** Estruturas derivadas da agenda para consulta rápida nas grades. */
export interface IndiceAgenda {
  funcionarios: Map<number, FuncionarioResumo>;
  turnos: Map<number, Turno>;
  /** data -> turnoId -> alocações (ordenadas por nome). */
  porDia: Map<string, Map<number, Alocacao[]>>;
  turnosOrdenados: Turno[];
}

export function indexarAgenda(agenda: AgendaMes): IndiceAgenda {
  const funcionarios = new Map(agenda.funcionarios.map((f) => [f.id, f]));
  const turnosOrdenados = [...agenda.turnos].sort((a, b) => a.ordem - b.ordem);
  const turnos = new Map(turnosOrdenados.map((t) => [t.id, t]));
  const nomeDe = (id: number) => funcionarios.get(id)?.nome ?? "";

  const porDia = new Map<string, Map<number, Alocacao[]>>();
  for (const a of agenda.alocacoes) {
    const doDia = porDia.get(a.data) ?? new Map<number, Alocacao[]>();
    doDia.set(a.turnoId, [...(doDia.get(a.turnoId) ?? []), a]);
    porDia.set(a.data, doDia);
  }
  for (const doDia of porDia.values()) {
    for (const lista of doDia.values()) lista.sort((x, y) => compararTexto(nomeDe(x.funcionarioId), nomeDe(y.funcionarioId)));
  }
  return { funcionarios, turnos, porDia, turnosOrdenados };
}

/** O turno funciona neste dia da semana? (dados antigos sem `diasSemana` = todos os dias) */
export function turnoFuncionaEm(turno: Turno, data: string): boolean {
  return !turno.diasSemana || turno.diasSemana.includes(diaDaSemana(data));
}

export function nomeFuncionario(indice: IndiceAgenda, id: number): string {
  return indice.funcionarios.get(id)?.nome ?? `Funcionário ${id}`;
}

/** Cria o teste de busca (nome ou matrícula, sem acentos); `null` quando não há busca. */
export function criarFiltroBusca(indice: IndiceAgenda, busca: string): ((a: Alocacao) => boolean) | null {
  const termo = normalizarTexto(busca);
  if (!termo) return null;
  return (a) => {
    const f = indice.funcionarios.get(a.funcionarioId);
    return f !== undefined && (normalizarTexto(f.nome).includes(termo) || normalizarTexto(f.matricula).includes(termo));
  };
}

/** Primeiro nome + inicial do último sobrenome: "Ana Paula Souza" -> "Ana S." */
export function nomeCurto(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  if (partes.length < 2) return nome;
  return `${partes[0]} ${partes[partes.length - 1]?.charAt(0) ?? ""}.`;
}
