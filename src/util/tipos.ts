// Tipos compartilhados apenas pela interface.

import type { TipoAviso } from "../api/types";

export type Tela = "agenda" | "funcionarios" | "importar" | "config";

export interface MesRef {
  ano: number;
  mes: number;
}

export const ROTULOS_AVISO: Record<TipoAviso, string> = {
  violacaoRegra: "Violação das regras atuais",
  coberturaInsuficiente: "Cobertura insuficiente",
  turnoExcedeJornada: "Turno acima da jornada diária",
  funcionarioSemTurno: "Funcionário sem turno",
  cargaAbaixoDoAlvo: "Carga abaixo do alvo",
  funcaoDescoberta: "Função sem o mínimo no turno",
};

/** Rótulo de um tipo de aviso; tipos desconhecidos (backend mais novo) aparecem pelo próprio nome. */
export function rotuloAviso(tipo: TipoAviso): string {
  return ROTULOS_AVISO[tipo] ?? tipo;
}
