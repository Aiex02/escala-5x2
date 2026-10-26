//! Objetos trocados com a interface (serializados em camelCase).
//! Espelho exato de `src/api/types.ts`: ao alterar um lado, altere o outro.

use chrono::NaiveDate;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClienteDto {
    pub id: i64,
    pub nome: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegrasDto {
    pub carga_semanal_max_horas: f64,
    pub jornada_diaria_max_horas: f64,
    pub descanso_entre_jornadas_horas: f64,
    pub max_dias_consecutivos: u32,
    /// "segunda" | "domingo"
    pub inicio_semana: String,
    /// Folgas mínimas por semana definidas pela empresa (o regime legal pode exigir mais).
    pub folgas_semanais_min: u32,
    /// Máximo de domingos seguidos de trabalho (0 = sem limite).
    pub domingos_seguidos_max: u32,
    /// "livre" | "ec141"
    pub regime: String,
    /// Data de publicação da EC 141/2026 (início da contagem dos prazos).
    pub ec141_publicacao: Option<NaiveDate>,
    /// Fases do regime legal (só leitura; ignorado ao salvar).
    #[serde(default)]
    pub fases: Vec<FaseRegimeDto>,
    /// Jornada usada para gerar os turnos (só leitura; salva pelo funcionamento).
    #[serde(default)]
    pub jornada_padrao_horas: f64,
    /// Intervalo de cada jornada (só leitura; salvo pelo funcionamento).
    #[serde(default)]
    pub intervalo_padrao_min: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FaseRegimeDto {
    /// `None` = desde sempre (regra anterior).
    pub desde: Option<NaiveDate>,
    /// Último dia da fase; `None` = sem fim.
    pub ate: Option<NaiveDate>,
    pub carga_semanal_max_horas: f64,
    pub folgas_semanais_min: u32,
    /// Ex.: "Até 42h e 2 folgas por semana"
    pub descricao: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnoDto {
    pub id: i64,
    pub nome: String,
    pub inicio: String,
    pub fim: String,
    pub intervalo_min: u32,
    pub efetivo_minimo: u32,
    pub ordem: i32,
    pub cor: String,
    pub minutos_trabalhados: u32,
    /// Dias em que o turno funciona: 0 = segunda ... 6 = domingo, em ordem crescente.
    pub dias_semana: Vec<u8>,
    /// "manha" | "tarde" | "noite", pela hora de início.
    pub periodo: String,
    /// Fora do funcionamento atual; só aparece em escalas já geradas.
    pub arquivado: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnoEntradaDto {
    pub id: Option<i64>,
    pub nome: String,
    pub inicio: String,
    pub fim: String,
    pub intervalo_min: u32,
    pub efetivo_minimo: u32,
    pub ordem: i32,
    pub cor: String,
    /// Dias em que o turno funciona: 0 = segunda ... 6 = domingo (ao menos um).
    pub dias_semana: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguracaoDto {
    pub regras: RegrasDto,
    /// Turnos em uso (sem os arquivados).
    pub turnos: Vec<TurnoDto>,
    /// Os 7 dias da semana, de segunda a domingo.
    pub funcionamento: Vec<DiaFuncionamentoDto>,
    /// Id do modelo em uso; `None` = personalizada.
    pub modelo: Option<String>,
    /// Funções dos funcionários ativos com o mínimo por turno.
    pub funcoes: Vec<FuncaoDto>,
}

/// Função (cargo) dos funcionários ativos e o mínimo dela em cada turno de cada dia.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuncaoDto {
    /// Cargo normalizado ("Farmacêutica (o)" → "farmaceutica").
    pub chave: String,
    /// Como o cargo aparece no cadastro (o mais comum).
    pub nome: String,
    /// Funcionários ativos com essa função.
    pub pessoas: u32,
    /// Pessoas da função exigidas em cada turno de cada dia (0 = sem exigência).
    pub minimo: u32,
    /// Quantas pessoas a função precisa para cobrir o mínimo em todos os turnos
    /// abertos da semana, com as folgas da regra final.
    pub pessoas_necessarias: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuncaoMinimoDto {
    pub chave: String,
    pub minimo: u32,
}

/// Modelo de funcionamento pronto: horário, jornada e regras (regime da EC 141).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeloDto {
    pub id: String,
    pub nome: String,
    pub descricao: String,
    /// Os 7 dias, de segunda a domingo.
    pub dias: Vec<DiaFuncionamentoDto>,
    pub jornada_horas: f64,
    pub intervalo_min: u32,
    pub regras: RegrasDto,
}

/// Configuração salva de uma vez: um modelo (`modelo` com o id; o resto é
/// ignorado) ou personalizada (`modelo` nulo, com `regras` e `funcionamento`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguracaoEntradaDto {
    pub modelo: Option<String>,
    #[serde(default)]
    pub regras: Option<RegrasDto>,
    #[serde(default)]
    pub funcionamento: Option<FuncionamentoEntradaDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaFuncionamentoDto {
    /// 0 = segunda ... 6 = domingo
    pub dia: u8,
    pub aberto: bool,
    /// "HH:MM"
    pub abre: String,
    pub fecha: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuncionamentoEntradaDto {
    pub dias: Vec<DiaFuncionamentoDto>,
    pub jornada_horas: f64,
    pub intervalo_min: u32,
}

/// Alterações feitas na tela de funcionários.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuncionarioEdicaoDto {
    pub cargo: Option<String>,
    /// `None` = usa o limite do cliente.
    pub carga_semanal_horas: Option<f64>,
    /// "manha" | "tarde" | "noite"; `None` = sem preferência.
    pub preferencia: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AusenciaDto {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub motivo: Option<String>,
    /// true = justificada (abona as horas do dia); false = falta.
    pub justificada: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuncionarioDto {
    pub id: i64,
    pub matricula: String,
    pub nome: String,
    pub cargo: Option<String>,
    pub ctps: Option<String>,
    pub secao: Option<String>,
    pub carga_semanal_horas: Option<f64>,
    /// "manha" | "tarde" | "noite"; `None` = sem preferência.
    pub preferencia: Option<String>,
    pub ativo: bool,
    pub ausencias: Vec<AusenciaDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinhaImportadaDto {
    pub linha: u32,
    pub matricula: String,
    pub nome: String,
    /// "criado" | "atualizado"
    pub acao: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinhaRejeitadaDto {
    pub planilha: String,
    pub linha: u32,
    pub matricula: Option<String>,
    pub erros: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelatorioImportacaoDto {
    pub arquivo: String,
    pub simulacao: bool,
    /// "padrao" (planilha modelo) | "quadro" (Quadro de Horário de Trabalho)
    pub formato: String,
    /// Empregador lido do quadro de horário.
    pub empregador: Option<String>,
    pub total_linhas: u32,
    pub importados: Vec<LinhaImportadaDto>,
    pub rejeitados: Vec<LinhaRejeitadaDto>,
    pub ausencias_importadas: u32,
    pub avisos: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MesGeradoDto {
    pub ano: i32,
    pub mes: u32,
    pub gerado_em: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvisoDto {
    pub tipo: String,
    pub data: Option<NaiveDate>,
    pub turno_id: Option<i64>,
    pub funcionario_id: Option<i64>,
    pub mensagem: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultadoGeracaoDto {
    pub mes: MesGeradoDto,
    pub total_alocacoes: u32,
    pub avisos: Vec<AvisoDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlocacaoDto {
    pub id: i64,
    pub funcionario_id: i64,
    pub turno_id: i64,
    pub data: NaiveDate,
    pub inicio: String,
    pub fim: String,
    pub minutos_trabalhados: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HorasSemanaFuncionarioDto {
    pub funcionario_id: i64,
    pub minutos: u32,
    pub limite_min: u32,
    /// Horas que a pessoa deve cumprir na semana: o limite, arredondado para
    /// jornadas inteiras, nos dias em que ela pode trabalhar (desconta folgas
    /// obrigatórias, indisponibilidade e férias).
    pub previsto_min: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumoSemanalDto {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    /// A semana tem dias em um mês ainda sem escala: as horas ainda vão completar.
    pub pendente: bool,
    pub funcionarios: Vec<HorasSemanaFuncionarioDto>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FuncionarioResumoDto {
    pub id: i64,
    pub nome: String,
    pub matricula: String,
    pub cargo: Option<String>,
    pub preferencia: Option<String>,
    /// Saldo das semanas fechadas antes do mês, em minutos (+ = horas a mais).
    pub saldo_anterior_min: i64,
    /// Chave da função (ver `FuncaoDto::chave`); `None` = sem cargo.
    pub funcao: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AusenciaAgendaDto {
    pub funcionario_id: i64,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub motivo: Option<String>,
    pub justificada: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AjusteManualDto {
    pub funcionario_id: i64,
    pub data: NaiveDate,
}

/// Resultado do reequilíbrio: a agenda do mês e os meses refeitos.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReequilibrioDto {
    pub agenda: AgendaMesDto,
    pub meses: Vec<MesGeradoDto>,
}

/// O que fica num dia do Quadro: `tipo` "turno" (com `turno_id`), "folga" ou
/// "ausencia" (com `justificada` e `motivo`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiaQuadroDto {
    pub tipo: String,
    #[serde(default)]
    pub turno_id: Option<i64>,
    #[serde(default)]
    pub justificada: Option<bool>,
    #[serde(default)]
    pub motivo: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgendaMesDto {
    pub ano: i32,
    pub mes: u32,
    pub gerado_em: Option<String>,
    pub inicio_semana: String,
    pub turnos: Vec<TurnoDto>,
    pub funcionarios: Vec<FuncionarioResumoDto>,
    pub alocacoes: Vec<AlocacaoDto>,
    pub semanas: Vec<ResumoSemanalDto>,
    pub avisos: Vec<AvisoDto>,
    /// Férias e afastamentos que tocam o mês.
    pub ausencias: Vec<AusenciaAgendaDto>,
    /// Funções e o mínimo de cada uma por turno (para marcar turno sem a função).
    pub funcoes: Vec<FuncaoDto>,
    /// Dias ajustados à mão no Quadro (ficam travados ao reequilibrar).
    pub ajustes: Vec<AjusteManualDto>,
    /// Limites que valem no mês, ex.: "Até 44h e 1 folga por semana; a partir de 16/12/2026, até 42h e 2 folgas".
    pub regra: String,
}
