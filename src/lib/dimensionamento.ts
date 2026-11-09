import { formatarMinutos } from "./formato";

export interface FaltaTexto {
  nome: string;
  faltamPessoas: number;
  horasExtrasSemanaMin: number;
  cobrivelComHoraExtra: boolean;
}

/** "Contratar 1 Cozinheiro" ou "Contratar 2 Cozinheiro ou aceitar 6h extras/semana". */
export function textoContratar(f: FaltaTexto, geral = false): string {
  const alvo = geral ? (f.faltamPessoas === 1 ? "pessoa" : "pessoas") : f.nome;
  const base = `Contratar ${f.faltamPessoas} ${alvo}`;
  if (f.cobrivelComHoraExtra && f.horasExtrasSemanaMin > 0) return `${base} ou aceitar ${formatarMinutos(f.horasExtrasSemanaMin)} extras/semana`;
  return base;
}
