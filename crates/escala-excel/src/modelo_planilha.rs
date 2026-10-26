//! Geração da planilha modelo com as colunas esperadas e exemplos.

use std::path::Path;

use rust_xlsxwriter::{Color, Format, Note, Workbook, Worksheet, XlsxError};

use crate::leitura::{ABA_AUSENCIAS, ABA_FUNCIONARIOS};
use crate::ErroImportacao;

const CABECALHO_FUNCIONARIOS: [&str; 5] =
    ["matricula", "nome", "cargo", "preferencia", "carga_semanal"];

const CABECALHO_AUSENCIAS: [&str; 5] = ["matricula", "inicio", "fim", "motivo", "justificada"];

/// Coluna "preferencia" (índice no cabeçalho) e o texto da nota que a explica.
const COLUNA_PREFERENCIA: u16 = 3;
const NOTA_PREFERENCIA: &str = "Opcional: Manhã, Tarde ou Noite. Vazia = sem preferência.";

/// Coluna "justificada" da aba de ausências e a nota que a explica.
const COLUNA_JUSTIFICADA: u16 = 4;
const NOTA_JUSTIFICADA: &str =
    "Opcional: Sim ou Não. Vazia = Sim. Não justificada (falta): a pessoa fica devendo as horas do dia.";

const INSTRUCOES: [(&str, &str, &str); 13] = [
    ("Aba Funcionarios", "", "Só funcionários são importados. Horários e turnos não vêm da planilha: são gerados a partir do funcionamento do cliente (Configurações → Funcionamento)."),
    ("matricula", "sim", "Código único do funcionário no cliente. Reimportar a mesma matrícula atualiza o cadastro."),
    ("nome", "sim", "Nome completo."),
    ("cargo", "não", "Função exibida na lista de funcionários."),
    ("preferencia", "não", "Período preferido: Manhã, Tarde ou Noite. Vazia = sem preferência. É atendida quando possível; os turnos e as folgas são escolhidos pela escala."),
    ("carga_semanal", "não", "Horas semanais do contrato (ex.: 36 ou 37,5). Nunca ultrapassa o limite do cliente."),
    ("", "", ""),
    ("Aba Ausencias", "", "Opcional. Férias, atestados, faltas e outros afastamentos."),
    ("matricula / inicio", "sim", "Matrícula do funcionário e data inicial (dd/mm/aaaa)."),
    ("fim / motivo", "não", "Data final (padrão = inicio) e descrição."),
    ("justificada", "não", "Sim ou Não; vazia = Sim. Justificada (férias, atestado) abona as horas do dia. Não justificada (falta): a pessoa fica devendo as horas do dia."),
    ("", "", ""),
    ("Colunas de horário", "", "turno, entrada, saida, intervalo_min e dias_disponiveis não são importadas: se existirem na planilha, são ignoradas."),
];

fn erro(e: XlsxError) -> ErroImportacao {
    ErroImportacao::Modelo(e.to_string())
}

fn cabecalho(aba: &mut Worksheet, colunas: &[&str], fmt: &Format) -> Result<(), XlsxError> {
    for (i, c) in colunas.iter().enumerate() {
        let col = u16::try_from(i).unwrap_or(u16::MAX);
        aba.write_string_with_format(0, col, *c, fmt)?;
        aba.set_column_width(col, (c.len() + 6).max(14) as f64)?;
    }
    aba.set_freeze_panes(1, 0)?;
    Ok(())
}

/// Escreve as linhas de exemplo abaixo do cabeçalho; células vazias ficam em branco.
fn exemplos_na_aba<const N: usize>(
    aba: &mut Worksheet,
    exemplos: &[[&str; N]],
) -> Result<(), XlsxError> {
    for (l, linha) in exemplos.iter().enumerate() {
        for (c, valor) in linha.iter().enumerate() {
            if !valor.is_empty() {
                aba.write_string(
                    u32::try_from(l + 1).unwrap_or(u32::MAX),
                    u16::try_from(c).unwrap_or(u16::MAX),
                    *valor,
                )?;
            }
        }
    }
    Ok(())
}

fn montar() -> Result<Workbook, XlsxError> {
    let negrito = Format::new()
        .set_bold()
        .set_background_color(Color::RGB(0xDDE7F3));
    let mut pasta = Workbook::new();

    let aba = pasta.add_worksheet();
    aba.set_name(ABA_FUNCIONARIOS)?;
    cabecalho(aba, &CABECALHO_FUNCIONARIOS, &negrito)?;
    aba.insert_note(0, COLUNA_PREFERENCIA, &Note::new(NOTA_PREFERENCIA))?;
    let exemplos: [[&str; 5]; 4] = [
        ["1001", "Ana Souza", "Vigilante", "Manhã", ""],
        ["1002", "Bruno Lima", "Vigilante", "Tarde", "36"],
        ["1003", "Carla Dias", "Supervisora", "", ""],
        ["1004", "Diego Rocha", "Vigilante", "Noite", ""],
    ];
    exemplos_na_aba(aba, &exemplos)?;

    let aba = pasta.add_worksheet();
    aba.set_name(ABA_AUSENCIAS)?;
    cabecalho(aba, &CABECALHO_AUSENCIAS, &negrito)?;
    aba.insert_note(0, COLUNA_JUSTIFICADA, &Note::new(NOTA_JUSTIFICADA))?;
    let exemplos: [[&str; 5]; 2] = [
        ["1002", "05/01/2026", "19/01/2026", "Férias", "Sim"],
        ["1003", "12/01/2026", "", "Falta", "Não"],
    ];
    exemplos_na_aba(aba, &exemplos)?;

    let aba = pasta.add_worksheet();
    aba.set_name("Instrucoes")?;
    cabecalho(aba, &["coluna", "obrigatória", "descrição"], &negrito)?;
    aba.set_column_width(0, 22)?;
    aba.set_column_width(2, 110)?;
    for (i, (coluna, obrig, desc)) in INSTRUCOES.iter().enumerate() {
        let l = u32::try_from(i + 1).unwrap_or(u32::MAX);
        aba.write_string(l, 0, *coluna)?;
        aba.write_string(l, 1, *obrig)?;
        aba.write_string(l, 2, *desc)?;
    }
    Ok(pasta)
}

/// Planilha modelo em memória.
pub fn modelo_em_bytes() -> Result<Vec<u8>, ErroImportacao> {
    montar().and_then(|mut p| p.save_to_buffer()).map_err(erro)
}

/// Grava a planilha modelo em `caminho`.
pub fn salvar_modelo(caminho: &Path) -> Result<(), ErroImportacao> {
    let bytes = modelo_em_bytes()?;
    std::fs::write(caminho, bytes)
        .map_err(|e| ErroImportacao::Modelo(format!("{}: {e}", caminho.display())))
}
