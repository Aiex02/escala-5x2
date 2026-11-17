/** Data civil no formato `AAAA-MM-DD`. */
export type DataISO = string;

export type Preferencia = "MANHA" | "TARDE" | "NOITE";

export type FormatoPlanilha = "modelo" | "quadro";

export type FuncionarioLido = {
  /** Linha no Excel (1 = primeira linha da aba). */
  linha: number;
  matricula: string;
  nome: string;
  cargo?: string;
  secao?: string;
  ctps?: string;
  /** Só preenchida no formato "quadro" (série da CTPS). */
  ctpsSerie?: string;
  preferencia?: Preferencia;
  /** Carga semanal contratual em minutos. */
  cargaSemanalMin?: number;
  /** Horas não trabalhadas (em minutos), digitadas pelo gestor; ausente = célula vazia. */
  horasNaoTrabalhadasMin?: number;
};

export type AusenciaLida = {
  aba: string;
  linha: number;
  matricula: string;
  inicio: DataISO;
  fim: DataISO;
  motivo?: string;
  justificada: boolean;
};

export type LinhaRejeitada = {
  aba: string;
  linha: number;
  matricula?: string;
  /** Todos os erros encontrados na linha. */
  erros: string[];
};

export type LeituraPlanilha = {
  formato: FormatoPlanilha;
  funcionarios: FuncionarioLido[];
  ausencias: AusenciaLida[];
  rejeitadas: LinhaRejeitada[];
  avisos: string[];
  /** Linhas de dados examinadas (válidas + rejeitadas) na aba de funcionários. */
  totalLinhas: number;
};

/** Erro de arquivo inteiro (não é xlsx, aba ou colunas obrigatórias ausentes). */
export class ErroPlanilha extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroPlanilha";
  }
}

/* ------------------------------ Exportação ------------------------------ */

export type CelulaExportavel =
  | {
      tipo: "turno";
      turnoId: string;
      inicioMin: number;
      fimMin: number;
      intervaloMin: number;
      compensada?: boolean;
      /** Jornada estendida além da contratual (hora extra); marcada com "+". */
      horaExtra?: boolean;
    }
  | { tipo: "folga" }
  | { tipo: "falta" }
  | { tipo: "justificada"; motivo?: string }
  | { tipo: "vazio" };

export type EscalaExportavel = {
  cliente: string;
  ano: number;
  /** 1..12 */
  mes: number;
  /** `diaSemana`: 0 = segunda ... 6 = domingo. */
  dias: { data: DataISO; diaSemana: number }[];
  turnos: {
    id: string;
    nome: string;
    sigla: string;
    /** Hex `#RRGGBB`. */
    cor: string;
    inicioMin: number;
    fimMin: number;
    intervaloMin: number;
  }[];
  linhas: {
    funcionario: string;
    cargo?: string;
    dias: CelulaExportavel[];
    horasMesMin: number;
    saldoMin: number;
    acumuladoMin: number;
  }[];
  semanas: { inicio: DataISO; fim: DataISO }[];
  horasSemana: {
    funcionario: string;
    semanas: { feitoMin: number; previstoMin: number }[];
  }[];
};

export type OpcoesExportacao = {
  /** Escreve o horário (entrada/saída) dentro da célula, em vez de só em comentário. */
  horarioNaCelula?: boolean;
};
