//! Gera uma planilha de exemplo pronta para importar (15 funcionários com preferência de
//! período e algumas ausências, justificadas ou não). Só dados de pessoas: os horários vêm
//! do funcionamento do cliente.
//!
//! ```text
//! cargo run -p escala-excel --example gerar_exemplo -- exemplos/funcionarios_exemplo.xlsx
//! ```

use std::process::ExitCode;

use rust_xlsxwriter::{Format, Workbook, XlsxError};

const LINHAS: &[[&str; 5]] = &[
    ["1001", "Ana Souza", "Vigilante", "Manhã", ""],
    ["1002", "Bruno Carvalho", "Vigilante", "Manhã", ""],
    ["1003", "Carla Mendes", "Vigilante", "Manhã", ""],
    ["1004", "Diego Ferreira", "Vigilante", "Manhã", "36"],
    ["1005", "Eduarda Nunes", "Supervisora", "Manhã", ""],
    ["1006", "Felipe Barbosa", "Vigilante", "Tarde", ""],
    ["1007", "Gabriela Rocha", "Vigilante", "Tarde", ""],
    ["1008", "Henrique Lopes", "Vigilante", "Tarde", ""],
    ["1009", "Isabela Martins", "Vigilante", "Tarde", "30"],
    ["1010", "João Pedro Silva", "Vigilante", "", ""],
    ["1011", "Karina Oliveira", "Vigilante", "Noite", ""],
    ["1012", "Lucas Araújo", "Vigilante", "Noite", ""],
    ["1013", "Mariana Costa", "Vigilante", "Noite", ""],
    ["1014", "Nelson Teixeira", "Vigilante", "Noite", ""],
    ["1015", "Olívia Ramos", "Folguista", "", ""],
];

fn gerar(caminho: &str) -> Result<(), XlsxError> {
    let negrito = Format::new().set_bold();
    let mut pasta = Workbook::new();
    let aba = pasta.add_worksheet();
    aba.set_name("Funcionarios")?;
    let cab = ["matricula", "nome", "cargo", "preferencia", "carga_semanal"];
    for (c, t) in cab.iter().enumerate() {
        aba.write_string_with_format(0, c as u16, *t, &negrito)?;
        aba.set_column_width(c as u16, 18)?;
    }
    for (l, linha) in LINHAS.iter().enumerate() {
        for (c, v) in linha.iter().enumerate() {
            if !v.is_empty() {
                aba.write_string(l as u32 + 1, c as u16, *v)?;
            }
        }
    }
    let aus = pasta.add_worksheet();
    aus.set_name("Ausencias")?;
    let cab = ["matricula", "inicio", "fim", "motivo", "justificada"];
    for (c, t) in cab.iter().enumerate() {
        aus.write_string_with_format(0, c as u16, *t, &negrito)?;
        aus.set_column_width(c as u16, 16)?;
    }
    for (l, linha) in [
        ["1002", "02/11/2026", "16/11/2026", "Férias", "Sim"],
        ["1012", "20/11/2026", "", "Consulta médica", "Sim"],
        ["1007", "09/11/2026", "", "Falta", "Não"],
    ]
    .iter()
    .enumerate()
    {
        for (c, v) in linha.iter().enumerate() {
            if !v.is_empty() {
                aus.write_string(l as u32 + 1, c as u16, *v)?;
            }
        }
    }
    pasta.save(caminho)
}

fn main() -> ExitCode {
    let caminho = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "funcionarios_exemplo.xlsx".to_string());
    match gerar(&caminho) {
        Ok(()) => {
            println!("Planilha de exemplo gravada em {caminho}");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("Falha ao gerar {caminho}: {e}");
            ExitCode::FAILURE
        }
    }
}
