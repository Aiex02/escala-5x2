// DTOs da agenda do mês: tudo serializável (sem Date/Set/Map) para atravessar server → client.

export type DataISO = string;

export type CelulaDto =
  | {
      tipo: "turno";
      turnoId: string;
      inicioMin: number;
      fimMin: number;
      intervaloMin: number;
      /** Horário diferente do horário do turno (jornada compensada). */
      compensada: boolean;
      /** Como a jornada nasceu; `horaExtra` = estendida além da jornada contratual. */
      origem: "normal" | "compensacao" | "horaExtra";
      /** Minutos além da jornada contratual (só em `horaExtra`; senão 0). */
      extraMin: number;
      ajustada: boolean;
    }
  | { tipo: "folga"; ajustada: boolean }
  | { tipo: "falta"; ajustada: boolean }
  | { tipo: "justificada"; motivo: string | null; ajustada: boolean }
  | { tipo: "fechado"; ajustada: boolean };

export type DiaDto = {
  data: DataISO;
  /** 0 = segunda … 6 = domingo. */
  diaSemana: number;
  /** O estabelecimento abre neste dia (falso também quando o dia foi fechado). */
  aberto: boolean;
  /** Dia fechado à mão (feriado, inventário): ninguém é escalado nele. */
  fechado: boolean;
  /** Motivo informado ao fechar o dia. */
  fechadoMotivo: string | null;
};

export type TurnoAgendaDto = {
  id: string;
  nome: string;
  sigla: string;
  /** Hex `#RRGGBB`. */
  cor: string;
  inicioMin: number;
  fimMin: number;
  intervaloMin: number;
  efetivoMinimo: number;
  /** Máscara de bits dos dias (bit 0 = segunda … bit 6 = domingo). */
  diasSemana: number;
  arquivado: boolean;
};

export type LinhaFuncionarioDto = {
  funcionarioId: string;
  nome: string;
  cargo: string | null;
  ativo: boolean;
  /** Uma célula por dia do mês (mesma ordem de `AgendaMesDto.dias`). */
  celulas: CelulaDto[];
  /** Hora não trabalhada da pessoa (almoço próprio) em minutos; `null` = segue o intervalo da loja. */
  horasNaoTrabalhadasMin: number | null;
  horasMesMin: number;
  saldoMesMin: number;
  saldoAnteriorMin: number;
  acumuladoMin: number;
  /** Total de hora extra do mês, em minutos. */
  horaExtraMesMin: number;
};

export type GrupoFuncaoDto = {
  /** Chave normalizada da função ("" = sem função). */
  chave: string;
  nome: string;
  linhas: LinhaFuncionarioDto[];
};

export type HorasSemanaDto = {
  feitoMin: number;
  previstoMin: number;
  limiteMin: number;
  saldoMin: number;
  /** Hora extra feita na semana, em minutos. */
  horaExtraMin: number;
};

export type SemanaDto = {
  inicio: DataISO;
  fim: DataISO;
  /** Todos os dias da semana estão em meses gerados (o saldo já conta). */
  fechada: boolean;
  /** Os 7 dias da semana. */
  dias: { data: DataISO; diaSemana: number; noMes: boolean }[];
  porFuncionario: Record<string, HorasSemanaDto>;
  /** Jornadas dos dias fora do mês (meses vizinhos): funcionarioId → data → célula. */
  foraDoMes: Record<string, Record<DataISO, CelulaDto>>;
};

export type TotalTurnoDto = {
  turnoId: string;
  /** Pessoas no turno em cada dia (mesma ordem de `dias`). */
  porDia: number[];
};

export type LacunaDto = {
  data: DataISO;
  turnoId: string;
  tipo: "efetivo" | "funcao";
  /** Nome da função (só em `funcao`). */
  funcao: string | null;
  presentes: number;
  minimo: number;
  /** Janela do turno (minutos desde a meia-noite; pode passar de 1440) que ficou descoberta depois da hora extra. */
  parcial: { inicioMin: number; fimMin: number } | null;
  /** Parte do furo já coberta por hora extra de quem trabalha em outro turno no dia. */
  cobertoPorExtra: boolean;
};

export type TipoAvisoDto =
  | "coberturaInsuficiente"
  | "turnoExcedeJornada"
  | "funcionarioSemTurno"
  | "cargaAbaixoDoAlvo"
  | "violacaoRegra"
  | "funcaoDescoberta"
  | "coberturaParcial"
  | "horaExtra"
  | "excessoSemanal";

export type AvisoAgendaDto = {
  tipo: TipoAvisoDto;
  data: DataISO | null;
  turnoId: string | null;
  funcionarioId: string | null;
  mensagem: string;
};

export type FaseDto = {
  numero: number;
  nome: string;
  /** Ex.: "Até 42h e 2 folgas por semana". */
  descricao: string;
  /** Ex.: "De 16/12/2026 a 15/12/2027". */
  periodo: string;
  /** Texto curto para o selo: "42h · 2 folgas". */
  resumo: string;
};

/** Falta de pessoal para cobrir o mínimo (diagnóstico do dimensionamento, não aviso do motor). */
export type FaltaPessoalDto = {
  nome: string;
  /** Falta de efetivo geral (sem função específica). */
  geral: boolean;
  faltamPessoas: number;
  horasExtrasSemanaMin: number;
  cobrivelComHoraExtra: boolean;
};

export type AgendaMesDto = {
  clienteId: string;
  clienteNome: string;
  ano: number;
  mes: number;
  gerado: boolean;
  geradoEm: string | null;
  dias: DiaDto[];
  turnos: TurnoAgendaDto[];
  grupos: GrupoFuncaoDto[];
  semanas: SemanaDto[];
  totaisPorTurno: TotalTurnoDto[];
  /** Pessoas trabalhando em cada dia (mesma ordem de `dias`). */
  trabalhandoPorDia: number[];
  lacunas: LacunaDto[];
  avisos: AvisoAgendaDto[];
  /** Fase da EC 141 em vigor no mês; `null` se o cliente não usa o regime. */
  fase: FaseDto | null;
  /** Descrição da regra de carga que vale nas semanas do mês. */
  regraDoMes: string;
  mesAnteriorGerado: boolean;
  mesSeguinteGerado: boolean;
  funcionariosAtivos: number;
  turnosAtivos: number;
  /** Dimensionamento da equipe na semana do último dia do mês. */
  dimensionamento: { faltas: FaltaPessoalDto[] };
};

/** Valor que o Quadro grava num dia de um funcionário. */
export type ValorDia =
  | { tipo: "turno"; turnoId: string }
  | { tipo: "folga" }
  | { tipo: "falta" }
  | { tipo: "justificada"; motivo?: string }
  | { tipo: "limpar" };

export type ResultadoGeracaoDto = {
  alocacoes: number;
  avisos: number;
};

export type ResultadoReequilibrioDto = {
  /** Meses refeitos (o atual e, se pedido, os seguintes). */
  meses: number;
  avisos: number;
};

/**
 * Siglas dos turnos: 1ª letra do nome em maiúscula; se duas coincidem, as duas
 * letras iniciais (e, persistindo o empate, mais letras / o índice).
 */
export function siglasDosTurnos(nomes: readonly string[]): string[] {
  const limpos = nomes.map((n) => n.trim().replace(/[^\p{L}\p{N}]/gu, "") || "?");
  const siglas = limpos.map((n) => n.slice(0, 1).toUpperCase());
  for (let tamanho = 2; tamanho <= 4; tamanho++) {
    for (let i = 0; i < siglas.length; i++) {
      const atual = siglas[i] ?? "";
      if (siglas.filter((s) => s === atual).length > 1) {
        const nome = limpos[i] ?? "?";
        siglas[i] = nome.slice(0, 1).toUpperCase() + nome.slice(1, tamanho).toLowerCase();
      }
    }
  }
  // Empate remanescente (nomes idênticos até 4 letras): acrescenta o índice.
  return siglas.map((s, i) => (siglas.filter((o) => o === s).length > 1 ? `${s}${i + 1}` : s));
}
