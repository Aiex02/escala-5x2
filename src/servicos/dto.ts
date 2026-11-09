// Tipos serializáveis (sem Date, Set ou Map) trocados entre servidor e componentes client.

import type { JanelaDia } from "@/motor";

export type PreferenciaDto = "MANHA" | "TARDE" | "NOITE";
export type RegimeDto = "LIVRE" | "EC141";

export interface TurnoDto {
  id: string;
  nome: string;
  inicioMin: number;
  fimMin: number;
  intervaloMin: number;
  efetivoMinimo: number;
  ordem: number;
  /** Hex `#RRGGBB`. */
  cor: string;
  /** Máscara de bits (bit 0 = segunda ... bit 6 = domingo). */
  diasSemana: number;
}

export interface RegrasEmpresaDto {
  cargaSemanalMaxMin: number;
  jornadaDiariaMaxMin: number;
  descansoEntreJornadasMin: number;
  maxDiasConsecutivos: number;
  inicioSemana: "segunda" | "domingo";
  folgasSemanaisMin: number;
  domingosSeguidosMax: number;
}

/** Função (cargo agrupado) com a exigência mínima por turno. */
export interface FuncaoDto {
  chave: string;
  nome: string;
  pessoas: number;
  /** Mínimo por turno (0 = sem exigência). */
  minimo: number;
}

export interface ConfiguracaoDto {
  clienteId: string;
  nome: string;
  /** Id do modelo pronto; `null` = personalizado. */
  modelo: string | null;
  regras: RegrasEmpresaDto;
  regime: RegimeDto;
  /** Data de publicação da EC 141 (ISO). */
  publicacao: string;
  jornadaMin: number;
  intervaloMin: number;
  /** Estender a jornada de quem já trabalha para cobrir o mínimo, como último recurso. */
  permitirHoraExtra: boolean;
  /** Hora extra máxima por dia, em minutos. */
  horaExtraDiariaMaxMin: number;
  janelas: JanelaDia[];
  turnos: TurnoDto[];
  funcoes: FuncaoDto[];
  /** Dimensionamento da equipe na data de hoje. */
  dimensionamento: DimensionamentoDto;
  /** Hoje (ISO), para marcar a fase vigente da EC 141. */
  hoje: string;
}

export interface AusenciaDto {
  id: string;
  inicio: string;
  fim: string;
  motivo: string | null;
  justificada: boolean;
}

export interface FuncionarioDto {
  id: string;
  matricula: string;
  nome: string;
  cargo: string | null;
  secao: string | null;
  ctps: string | null;
  cargaSemanalMin: number | null;
  preferencia: PreferenciaDto | null;
  ativo: boolean;
  isentoEc141: boolean;
  ausencias: AusenciaDto[];
}

export interface ResultadoImportacaoDto {
  formato: "modelo" | "quadro";
  /** `true` quando só validou (nada foi gravado). */
  simulado: boolean;
  lidas: number;
  novas: number;
  atualizadas: number;
  ausenciasGravadas: number;
  rejeitadas: { aba: string; linha: number; matricula: string | null; erros: string[] }[];
  avisos: string[];
}

/** Uma função (ou o efetivo geral) no dimensionamento da equipe. */
export interface LinhaDimensionamentoDto {
  /** Chave da função; "" = efetivo mínimo geral dos turnos. */
  funcao: string;
  nome: string;
  minimoPorTurno: number;
  pessoas: number;
  demandaTurnosSemana: number;
  capacidadeTurnosSemana: number;
  /** Pessoas a contratar para cobrir sem hora extra (0 = suficiente). */
  faltamPessoas: number;
  horasExtrasSemanaMin: number;
  cobrivelComHoraExtra: boolean;
  mensagem: string;
}

/** Quantas pessoas faltam por função para cobrir o mínimo, na fase da lei vigente na data. */
export interface DimensionamentoDto {
  clienteId: string;
  /** Data de referência (ISO) que definiu a semana e a fase da lei. */
  dataReferencia: string;
  /** Ex.: "Semana de 14/12/2026 a 20/12/2026". */
  periodo: string;
  /** Ex.: "até 42h e 2 folgas por semana". */
  limites: string;
  margemAusenciasPct: number;
  linhas: LinhaDimensionamentoDto[];
  faltas: LinhaDimensionamentoDto[];
}
