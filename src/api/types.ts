// Contrato entre a interface e o backend Rust (comandos Tauri).
// Cada tipo aqui espelha um DTO serializado em `crates/escala-app/src/dto.rs`
// (serde com `rename_all = "camelCase"`). Ao alterar um lado, altere o outro.
//
// Convenções:
// - Datas: string ISO "YYYY-MM-DD" (sem fuso horário).
// - Horários: string "HH:MM" (24h). Se fim <= início, o turno atravessa a meia-noite.
// - Dias da semana: 0 = segunda ... 6 = domingo.
// - Durações internas em minutos; regras de carga expostas em horas (decimais).

export type InicioSemana = "segunda" | "domingo";

/** Período do dia usado na preferência do funcionário (pela hora de início do turno). */
export type Periodo = "manha" | "tarde" | "noite";

export interface Cliente {
  id: number;
  nome: string;
}

export interface Regras {
  /** Limite semanal de horas trabalhadas (padrão 44). Nunca é ultrapassado. */
  cargaSemanalMaxHoras: number;
  /** Limite de horas trabalhadas em um único dia (padrão 8). */
  jornadaDiariaMaxHoras: number;
  /** Descanso mínimo entre o fim de uma jornada e o início da próxima (padrão 11). */
  descansoEntreJornadasHoras: number;
  /** Máximo de dias seguidos de trabalho antes de uma folga (padrão 6). */
  maxDiasConsecutivos: number;
  /** Dia em que a semana de apuração de horas começa (padrão segunda). */
  inicioSemana: InicioSemana;
  /** Folgas mínimas por semana definidas pela empresa (o regime legal pode exigir mais). */
  folgasSemanaisMin: number;
  /** Máximo de domingos seguidos de trabalho (0 = sem limite). */
  domingosSeguidosMax: number;
  /** "ec141" = fim da escala 6x1 (EC 141/2026); "livre" = só as regras da empresa. */
  regime: RegimeLegal;
  /** Data de publicação da EC 141 ("YYYY-MM-DD"); os prazos contam a partir dela. */
  ec141Publicacao: string | null;
  /** Fases do regime já combinadas com as regras da empresa (só leitura). */
  fases: FaseRegime[];
  /** Jornada dos funcionários usada para gerar os turnos (ex.: 6). */
  jornadaPadraoHoras: number;
  /** Intervalo não remunerado de cada jornada, em minutos (ex.: 15). */
  intervaloPadraoMin: number;
}

/** Funcionamento do estabelecimento em um dia da semana. */
export interface DiaFuncionamento {
  /** 0 = segunda ... 6 = domingo. */
  dia: number;
  aberto: boolean;
  /** "HH:MM" */
  abre: string;
  fecha: string;
}

/**
 * Modelo de funcionamento pronto (definido no backend): horário, jornada e regras de
 * jornada já alinhadas ao fim da escala 6x1 (regime da EC 141).
 */
export interface ModeloFuncionamento {
  id: string;
  nome: string;
  /** Para quem serve, em uma frase. */
  descricao: string;
  /** Os 7 dias, de segunda (0) a domingo (6). */
  dias: DiaFuncionamento[];
  jornadaHoras: number;
  intervaloMin: number;
  /** Regras que o modelo aplica (com as fases da EC 141 pela publicação padrão). */
  regras: Regras;
}

/**
 * Configuração salva de uma vez. Com `modelo`, horário, jornada e regras vêm do
 * modelo (o resto é ignorado); com `modelo` nulo é personalizada e usa `regras` e
 * `funcionamento`.
 */
export interface ConfiguracaoEntrada {
  modelo: string | null;
  regras: Regras | null;
  funcionamento: FuncionamentoEntrada | null;
}

export interface FuncionamentoEntrada {
  /** Os 7 dias da semana. */
  dias: DiaFuncionamento[];
  jornadaHoras: number;
  intervaloMin: number;
}

export type RegimeLegal = "livre" | "ec141";

export interface FaseRegime {
  /** null = regra anterior, desde sempre. */
  desde: string | null;
  /** Último dia da fase; null = sem fim. */
  ate: string | null;
  cargaSemanalMaxHoras: number;
  folgasSemanaisMin: number;
  /** Ex.: "Até 42h e 2 folgas por semana" */
  descricao: string;
}

export interface Turno {
  id: number;
  nome: string;
  inicio: string;
  fim: string;
  intervaloMin: number;
  /** Quantidade mínima de pessoas por dia neste turno (0 = sem mínimo). */
  efetivoMinimo: number;
  ordem: number;
  /** Cor em hexadecimal, ex. "#F2B705". */
  cor: string;
  /** Dias em que o turno funciona: 0 = segunda ... 6 = domingo, ordenados. */
  diasSemana: number[];
  /** Duração do turno menos o intervalo. */
  minutosTrabalhados: number;
  /** Período pela hora de início (casa com a preferência dos funcionários). */
  periodo: Periodo;
  /** Turno antigo, fora do funcionamento atual: só aparece em escalas já geradas. */
  arquivado: boolean;
}

/** Para criar (id = null) ou atualizar um turno. */
export interface TurnoEntrada {
  id: number | null;
  nome: string;
  inicio: string;
  fim: string;
  intervaloMin: number;
  efetivoMinimo: number;
  ordem: number;
  cor: string;
  /** Ao menos um dia; 0 = segunda ... 6 = domingo. */
  diasSemana: number[];
}

/** Função (cargo) dos funcionários ativos e o mínimo dela em cada turno de cada dia. */
export interface Funcao {
  /** Cargo normalizado ("Farmacêutica (o)" → "farmaceutica"); liga ao `FuncionarioResumo.funcao`. */
  chave: string;
  /** Como o cargo aparece no cadastro (o mais comum). */
  nome: string;
  /** Funcionários ativos com essa função. */
  pessoas: number;
  /** Pessoas da função exigidas em cada turno de cada dia (0 = sem exigência; padrão 1). */
  minimo: number;
  /** Pessoas necessárias para cobrir o mínimo em todos os turnos da semana com as folgas da regra final (0 na agenda). */
  pessoasNecessarias: number;
}

export interface Configuracao {
  regras: Regras;
  /** Turnos em uso (sem os arquivados). */
  turnos: Turno[];
  /** Os 7 dias da semana, de segunda a domingo. */
  funcionamento: DiaFuncionamento[];
  /** Id do modelo em uso; null = configuração personalizada. */
  modelo: string | null;
  /** Funções dos funcionários ativos, com o mínimo por turno. */
  funcoes: Funcao[];
}

/** Alterações feitas na tela de funcionários. */
export interface FuncionarioEdicao {
  cargo: string | null;
  /** null = usa o limite do cliente. */
  cargaSemanalHoras: number | null;
  preferencia: Periodo | null;
}

export interface Ausencia {
  inicio: string;
  fim: string;
  motivo: string | null;
  /**
   * true = justificada (férias, atestado): abona as horas do dia, que deixam de ser cobradas.
   * false = falta: a pessoa não trabalha e fica devendo as horas do dia.
   */
  justificada: boolean;
}

export interface Funcionario {
  id: number;
  matricula: string;
  nome: string;
  cargo: string | null;
  /** Número/série da CTPS (quadro de horário). */
  ctps: string | null;
  secao: string | null;
  /** Carga contratual individual; null = usa o limite do cliente. */
  cargaSemanalHoras: number | null;
  /** Período preferido; a escala atende quando houver vaga. */
  preferencia: Periodo | null;
  ativo: boolean;
  ausencias: Ausencia[];
}

export interface LinhaImportada {
  linha: number;
  matricula: string;
  nome: string;
  acao: "criado" | "atualizado";
}

export interface LinhaRejeitada {
  planilha: string;
  /** Número da linha como aparece no Excel (1 = cabeçalho). */
  linha: number;
  matricula: string | null;
  erros: string[];
}

export interface RelatorioImportacao {
  arquivo: string;
  /** true = apenas validação, nada foi gravado. */
  simulacao: boolean;
  /** "padrao" = planilha modelo do app; "quadro" = Quadro de Horário (só os dados das pessoas). */
  formato: "padrao" | "quadro";
  /** Empregador lido do quadro de horário. */
  empregador: string | null;
  totalLinhas: number;
  importados: LinhaImportada[];
  rejeitados: LinhaRejeitada[];
  ausenciasImportadas: number;
  avisos: string[];
}

export interface MesGerado {
  ano: number;
  /** 1..12 */
  mes: number;
  /** Data/hora local da geração, "YYYY-MM-DD HH:MM:SS". */
  geradoEm: string;
}

export type TipoAviso =
  | "coberturaInsuficiente"
  | "turnoExcedeJornada"
  | "funcionarioSemTurno"
  | "cargaAbaixoDoAlvo"
  /** Alocação existente que viola as regras atuais (ex.: limite reduzido após gerar). */
  | "violacaoRegra"
  /** Turno sem o mínimo de uma função em algum dia (aviso por semana, com os dias). */
  | "funcaoDescoberta";

export interface Aviso {
  tipo: TipoAviso;
  data: string | null;
  turnoId: number | null;
  funcionarioId: number | null;
  mensagem: string;
}

export interface ResultadoGeracao {
  mes: MesGerado;
  totalAlocacoes: number;
  avisos: Aviso[];
}

export interface Alocacao {
  id: number;
  funcionarioId: number;
  turnoId: number;
  data: string;
  inicio: string;
  fim: string;
  minutosTrabalhados: number;
}

export interface HorasSemanaFuncionario {
  funcionarioId: number;
  /** Minutos trabalhados na semana inteira (inclui dias de meses vizinhos já gerados). */
  minutos: number;
  limiteMin: number;
  /** Horas que a pessoa deve cumprir na semana (limite em jornadas inteiras, descontando folgas obrigatórias e ausências). */
  previstoMin: number;
}

export interface ResumoSemanal {
  /** Semana completa de apuração; pode começar/terminar fora do mês. */
  inicio: string;
  fim: string;
  /** A semana tem dias num mês ainda sem escala: as horas ainda vão completar. */
  pendente: boolean;
  funcionarios: HorasSemanaFuncionario[];
}

export interface FuncionarioResumo {
  id: number;
  nome: string;
  matricula: string;
  cargo: string | null;
  preferencia: Periodo | null;
  /**
   * Saldo de horas dos meses anteriores (semanas fechadas antes deste mês), em minutos:
   * positivo = horas a mais, negativo = devendo. A geração do mês tenta compensar.
   */
  saldoAnteriorMin: number;
  /** Chave da função (ver `Funcao.chave`); null = sem cargo. */
  funcao: string | null;
}

export interface AusenciaAgenda {
  funcionarioId: number;
  inicio: string;
  fim: string;
  motivo: string | null;
  /** Ver `Ausencia.justificada`. */
  justificada: boolean;
}

/** Resultado de `reequilibrar`: a agenda do mês e os meses refeitos. */
export interface ResultadoReequilibrio {
  agenda: AgendaMes;
  meses: MesGerado[];
}

/** O que fica num dia do Quadro para uma pessoa. */
export type DiaQuadro =
  | { tipo: "turno"; turnoId: number }
  | { tipo: "folga" }
  | { tipo: "ausencia"; justificada: boolean; motivo: string | null };

export interface AgendaMes {
  ano: number;
  mes: number;
  /** null = mês ainda não gerado (alocacoes vazio). */
  geradoEm: string | null;
  inicioSemana: InicioSemana;
  turnos: Turno[];
  funcionarios: FuncionarioResumo[];
  /** Somente datas dentro do mês. */
  alocacoes: Alocacao[];
  semanas: ResumoSemanal[];
  avisos: Aviso[];
  /** Férias e afastamentos que tocam o mês. */
  ausencias: AusenciaAgenda[];
  /** Funções com mínimo por turno (para marcar turno sem a função). */
  funcoes: Funcao[];
  /** Dias ajustados à mão no Quadro: ficam travados ao reequilibrar (gerar o mês de novo os descarta). */
  ajustes: { funcionarioId: number; data: string }[];
  /** Limites em vigor no mês, ex.: "Até 44h e 1 folga por semana; a partir da semana de 14/12, até 42h e 2 folgas por semana". */
  regra: string;
}
