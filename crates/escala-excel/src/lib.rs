//! Importação de funcionários a partir de planilhas `.xlsx`.
//!
//! A planilha traz só dados de pessoas. Os horários e os turnos nunca são
//! importados: a escala os gera a partir do funcionamento do estabelecimento
//! (Configurações → Funcionamento).
//!
//! Esta camada só lê e valida: devolve dados prontos para gravar e um relatório
//! linha a linha do que foi aceito e rejeitado. Não acessa banco de dados.
//!
//! # Formato esperado
//! Aba **Funcionarios** (ou a primeira aba), cabeçalho na primeira linha não
//! vazia. Nomes de coluna sem diferenciar maiúsculas, acentos, espaços ou "_".
//!
//! | coluna            | obrigatória | formato                                              |
//! |-------------------|-------------|------------------------------------------------------|
//! | matricula         | sim         | texto ou número, única na planilha                   |
//! | nome              | sim         | texto                                                |
//! | cargo             | não         | texto                                                |
//! | preferencia       | não         | manhã, tarde ou noite; vazia = sem preferência       |
//! | carga_semanal     | não         | horas, ex. 36 ou 37,5 (padrão: limite do cliente)    |
//!
//! A preferência de período é atendida quando possível; os turnos e as folgas
//! são escolhidos pela escala. Um valor de `preferencia` fora de manhã, tarde ou
//! noite rejeita a linha.
//!
//! As colunas de horário (`turno`, `entrada`, `saida`, `intervalo_min` e
//! `dias_disponiveis`, com seus apelidos) são ignoradas: gera-se um único aviso
//! listando as presentes e seus valores nunca são validados.
//!
//! Aba opcional **Ausencias**:
//!
//! | coluna            | obrigatória | formato                                              |
//! |-------------------|-------------|------------------------------------------------------|
//! | matricula         | sim         | a mesma da aba de funcionários                       |
//! | inicio            | sim         | data (dd/mm/aaaa)                                    |
//! | fim               | não         | data (padrão = inicio)                               |
//! | motivo            | não         | texto                                                |
//! | justificada       | não         | sim/não, s/n, true/false, 1/0 ou x; vazia = sim      |
//!
//! Ausência justificada (férias, atestado) abona as horas do dia; a não
//! justificada (falta) deixa a pessoa devendo as horas.
//!
//! # Quadro de Horário
//! O "Quadro de Horário de Trabalho" ([`ler_quadro`]) é lido só pelos dados das
//! pessoas (código, nome, função, seção e CTPS). Os horários que ele traz não
//! são usados pelo app.
#![forbid(unsafe_code)]
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

mod celula;
mod exportacao;
mod leitura;
mod modelo_planilha;
mod quadro;
mod texto;

use std::path::Path;

use chrono::NaiveDate;
use escala_core::{Periodo, RegrasCarga};
use thiserror::Error;

pub use exportacao::{
    exportar_escala_bytes, salvar_escala, CelulaEscala, EscalaParaExportar, HorasSemanaExportar,
    LinhaEscalaExportar, TurnoExportar,
};
pub use leitura::{ABA_AUSENCIAS, ABA_FUNCIONARIOS};
pub use modelo_planilha::{modelo_em_bytes, salvar_modelo};
pub use quadro::{
    detectar_formato, ler_quadro, ler_quadro_bytes, FormatoPlanilha, FuncionarioQuadro,
    HorarioQuadro, QuadroHorario,
};

/// Dados do cliente necessários para validar a planilha.
#[derive(Debug, Clone, Copy)]
pub struct ContextoImportacao<'a> {
    pub regras: &'a RegrasCarga,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FuncionarioImportado {
    /// Linha no Excel (1 = primeira linha da aba).
    pub linha: u32,
    pub matricula: String,
    pub nome: String,
    pub cargo: Option<String>,
    pub carga_semanal_min: Option<u32>,
    /// Período preferido; `None` = sem preferência.
    pub preferencia: Option<Periodo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AusenciaImportada {
    /// Nome da aba como está no arquivo (ex.: "Ausências").
    pub aba: String,
    pub linha: u32,
    pub matricula: String,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub motivo: Option<String>,
    /// Justificada (férias, atestado) abona as horas do dia; não justificada
    /// (falta) deixa a pessoa devendo. Padrão: `true`.
    pub justificada: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinhaRejeitada {
    pub aba: String,
    pub linha: u32,
    pub matricula: Option<String>,
    pub erros: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResultadoLeitura {
    pub funcionarios: Vec<FuncionarioImportado>,
    pub ausencias: Vec<AusenciaImportada>,
    pub rejeitadas: Vec<LinhaRejeitada>,
    pub avisos: Vec<String>,
    /// Linhas de dados (não vazias) da aba de funcionários.
    pub total_linhas: u32,
}

/// Problemas que impedem ler a planilha inteira (linhas inválidas não entram
/// aqui: vão para [`ResultadoLeitura::rejeitadas`]).
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ErroImportacao {
    #[error("não foi possível ler o arquivo \"{caminho}\": {motivo}")]
    Leitura { caminho: String, motivo: String },
    #[error(
        "o arquivo \"{0}\" não é .xlsx; salve a planilha como Pasta de Trabalho do Excel (.xlsx)"
    )]
    Extensao(String),
    #[error("arquivo .xlsx inválido ou corrompido: {0}")]
    Arquivo(String),
    #[error("a planilha não tem aba de funcionários")]
    SemAbaDeFuncionarios,
    #[error("a aba \"{0}\" está vazia")]
    AbaVazia(String),
    #[error("aba \"{aba}\": faltam as colunas obrigatórias {}; colunas encontradas: {}", faltando.join(", "), if encontradas.is_empty() { "nenhuma".to_string() } else { encontradas.join(", ") })]
    ColunasAusentes {
        aba: String,
        faltando: Vec<String>,
        encontradas: Vec<String>,
    },
    #[error("não foi possível gerar a planilha modelo: {0}")]
    Modelo(String),
    #[error("não foi possível exportar a escala: {0}")]
    Exportacao(String),
}

/// Lê e valida a planilha em `caminho`.
pub fn ler_planilha(
    caminho: &Path,
    ctx: &ContextoImportacao<'_>,
) -> Result<ResultadoLeitura, ErroImportacao> {
    let extensao = caminho
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if extensao.as_deref() != Some("xlsx") {
        return Err(ErroImportacao::Extensao(caminho.display().to_string()));
    }
    let bytes = std::fs::read(caminho).map_err(|e| ErroImportacao::Leitura {
        caminho: caminho.display().to_string(),
        motivo: e.to_string(),
    })?;
    ler_bytes(bytes, ctx)
}

/// Lê e valida uma planilha já carregada em memória.
pub fn ler_bytes(
    bytes: Vec<u8>,
    ctx: &ContextoImportacao<'_>,
) -> Result<ResultadoLeitura, ErroImportacao> {
    leitura::ler(bytes, ctx)
}
