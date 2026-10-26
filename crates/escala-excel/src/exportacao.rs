//! Exportação da escala mensal para Excel (para imprimir, assinar e afixar).
//!
//! CONTRATO (não alterar assinaturas sem combinar): ver tipos abaixo.

use std::path::Path;

use chrono::{Datelike, NaiveDate, Weekday};
use escala_core::formatar_minutos;
use rust_xlsxwriter::{Color, Format, FormatAlign, FormatBorder, Workbook, Worksheet, XlsxError};

use crate::ErroImportacao;

const ABA_ESCALA: &str = "Escala";
const ABA_HORAS: &str = "Horas por semana";

/// Linhas (base 0) da aba "Escala".
const LINHA_CABECALHO: u32 = 4;
const PRIMEIRA_LINHA_DADOS: u32 = 5;
/// Matrícula, Nome e Função.
const COLUNAS_ID: usize = 3;
/// Altura de uma linha de funcionário (duas linhas de texto).
const ALTURA_LINHA: f64 = 26.0;
/// Abaixo desta fração do limite semanal a célula de horas ganha destaque âmbar.
const FRACAO_BAIXA: (u64, u64) = (3, 4);

const COR_CINZA_BASE: u32 = 0x808080;
const COR_CABECALHO: u32 = 0x1F3A5F;
const COR_CABECALHO_DOMINGO: u32 = 0x9B2C2C;
const COR_BORDA: u32 = 0xA0A7B0;
const COR_BORDA_DOMINGO: u32 = 0xC0504D;
const COR_TEXTO: u32 = 0x1F2937;
const COR_TEXTO_SUAVE: u32 = 0x6B7280;
const COR_FOLGA: u32 = 0xE9EAEC;
const COR_AUSENCIA: u32 = 0xFDE6A8;
const COR_ACIMA_FUNDO: u32 = 0xF8C9C9;
const COR_ACIMA_TEXTO: u32 = 0x9B1C1C;
const COR_TOTAL: u32 = 0xEEF2F7;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnoExportar {
    pub nome: String,
    /// "HH:MM"
    pub inicio: String,
    pub fim: String,
    /// "#RRGGBB"
    pub cor: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CelulaEscala {
    /// Plantão no dia.
    Trabalho {
        turno: String,
        inicio: String,
        fim: String,
        minutos: u32,
        cor: String,
    },
    /// Dia sem plantão (folga).
    Folga,
    /// Ausência registrada (férias, afastamento).
    Ausencia { motivo: Option<String> },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HorasSemanaExportar {
    /// Ex.: "05/10–11/10"
    pub rotulo: String,
    pub minutos: u32,
    pub limite_min: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LinhaEscalaExportar {
    pub matricula: String,
    pub nome: String,
    pub funcao: Option<String>,
    /// Uma célula por dia de `EscalaParaExportar::dias`, na mesma ordem.
    pub celulas: Vec<CelulaEscala>,
    pub semanas: Vec<HorasSemanaExportar>,
    pub total_min: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EscalaParaExportar {
    pub empregador: String,
    /// Ex.: "Escala de outubro de 2026"
    pub titulo: String,
    /// Regra aplicada, ex.: "Até 42h por semana e 2 folgas semanais (EC 141/2026)".
    pub regra: String,
    /// Dias do mês, em ordem.
    pub dias: Vec<NaiveDate>,
    pub turnos: Vec<TurnoExportar>,
    pub funcionarios: Vec<LinhaEscalaExportar>,
    /// Texto livre no rodapé (ex.: "Gerada em 22/10/2026 às 14:05").
    pub rodape: String,
}

/// Exporta a escala para um .xlsx em memória (abas "Escala" e "Horas por semana").
pub fn exportar_escala_bytes(escala: &EscalaParaExportar) -> Result<Vec<u8>, ErroImportacao> {
    validar(escala)?;
    let mut pasta = Workbook::new();
    montar_aba_escala(pasta.add_worksheet(), escala).map_err(erro)?;
    montar_aba_horas(pasta.add_worksheet(), escala).map_err(erro)?;
    pasta.save_to_buffer().map_err(erro)
}

fn erro(e: XlsxError) -> ErroImportacao {
    ErroImportacao::Exportacao(e.to_string())
}

/// Cada funcionário precisa de exatamente uma célula por dia.
fn validar(escala: &EscalaParaExportar) -> Result<(), ErroImportacao> {
    for f in &escala.funcionarios {
        if f.celulas.len() != escala.dias.len() {
            return Err(ErroImportacao::Exportacao(format!(
                "o funcionário {} ({}) tem {} célula(s), mas a escala tem {} dia(s)",
                f.matricula,
                f.nome,
                f.celulas.len(),
                escala.dias.len()
            )));
        }
    }
    Ok(())
}

fn linha(i: usize) -> Result<u32, XlsxError> {
    u32::try_from(i).map_err(|_| XlsxError::RowColumnLimitError)
}

fn coluna(i: usize) -> Result<u16, XlsxError> {
    u16::try_from(i).map_err(|_| XlsxError::RowColumnLimitError)
}

/// Interpreta "#RRGGBB"; qualquer outro valor vira cinza.
fn interpretar_cor(texto: &str) -> u32 {
    let t = texto.trim();
    let hex = t.strip_prefix('#').unwrap_or(t);
    if hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        u32::from_str_radix(hex, 16).unwrap_or(COR_CINZA_BASE)
    } else {
        COR_CINZA_BASE
    }
}

/// Mistura a cor com 75% de branco, para o fundo não ficar forte na impressão.
fn clarear(rgb: u32) -> u32 {
    let canal = |c: u32| ((c & 0xFF) * 25 + 255 * 75 + 50) / 100;
    (canal(rgb >> 16) << 16) | (canal(rgb >> 8) << 8) | canal(rgb)
}

fn abreviatura(dia: Weekday) -> &'static str {
    match dia {
        Weekday::Mon => "seg",
        Weekday::Tue => "ter",
        Weekday::Wed => "qua",
        Weekday::Thu => "qui",
        Weekday::Fri => "sex",
        Weekday::Sat => "sáb",
        Weekday::Sun => "dom",
    }
}

fn eh_domingo(dia: &NaiveDate) -> bool {
    dia.weekday() == Weekday::Sun
}

/// Base de toda célula da tabela: borda fina, centralizada na vertical e na horizontal.
fn formato_celula(fundo: u32, texto: u32, tamanho: f64, domingo: bool) -> Format {
    Format::new()
        .set_font_size(tamanho)
        .set_font_color(Color::RGB(texto))
        .set_background_color(Color::RGB(fundo))
        .set_border(FormatBorder::Thin)
        .set_border_color(Color::RGB(if domingo {
            COR_BORDA_DOMINGO
        } else {
            COR_BORDA
        }))
        .set_align(FormatAlign::Center)
        .set_align(FormatAlign::VerticalCenter)
}

fn formato_cabecalho(fundo: u32) -> Format {
    formato_celula(fundo, 0xFFFFFF, 10.0, false)
        .set_bold()
        .set_text_wrap()
}

/// Célula de texto à esquerda (matrícula, nome, função).
fn formato_identificacao() -> Format {
    formato_celula(0xFFFFFF, COR_TEXTO, 9.0, false)
        .set_align(FormatAlign::Left)
        .set_text_wrap()
        .set_indent(1)
}

/// Texto solto (títulos, legenda, rodapé), sem borda.
fn formato_texto(tamanho: f64, cor: u32) -> Format {
    Format::new()
        .set_font_size(tamanho)
        .set_font_color(Color::RGB(cor))
        .set_align(FormatAlign::Left)
        .set_align(FormatAlign::VerticalCenter)
}

fn escrever_celula(
    aba: &mut Worksheet,
    l: u32,
    c: u16,
    celula: &CelulaEscala,
    domingo: bool,
) -> Result<(), XlsxError> {
    match celula {
        CelulaEscala::Trabalho {
            inicio, fim, cor, ..
        } => {
            let fundo = clarear(interpretar_cor(cor));
            let fmt = formato_celula(fundo, COR_TEXTO, 8.0, domingo).set_text_wrap();
            aba.write_string_with_format(l, c, format!("{inicio}\n{fim}"), &fmt)?;
        }
        CelulaEscala::Folga => {
            let fmt = formato_celula(COR_FOLGA, COR_TEXTO_SUAVE, 9.0, domingo);
            aba.write_string_with_format(l, c, "F", &fmt)?;
        }
        CelulaEscala::Ausencia { motivo } => {
            let texto = motivo
                .as_deref()
                .and_then(|m| m.split_whitespace().next())
                .unwrap_or("AUS");
            // Palavras longas (ex.: "Afastamento") encolhem para caber no dia.
            let fmt = formato_celula(COR_AUSENCIA, COR_TEXTO, 8.0, domingo).set_shrink();
            aba.write_string_with_format(l, c, texto, &fmt)?;
        }
    }
    Ok(())
}

/// Papel A4 em paisagem, 1 página de largura, margens estreitas e rodapé com paginação.
fn configurar_impressao(aba: &mut Worksheet) {
    aba.set_landscape().set_paper_size(9);
    aba.set_print_fit_to_pages(1, 0);
    aba.set_margins(0.4, 0.4, 0.5, 0.6, 0.3, 0.3);
    aba.set_print_center_horizontally(true);
    aba.set_footer("&CPágina &P de &N");
    aba.set_screen_gridlines(false);
}

fn montar_aba_escala(aba: &mut Worksheet, escala: &EscalaParaExportar) -> Result<(), XlsxError> {
    aba.set_name(ABA_ESCALA)?;
    configurar_impressao(aba);

    let n_dias = escala.dias.len();
    let col_total = coluna(COLUNAS_ID + n_dias)?;
    aba.set_repeat_rows(0, LINHA_CABECALHO)?;
    aba.set_freeze_panes(PRIMEIRA_LINHA_DADOS, coluna(COLUNAS_ID)?)?;

    aba.set_column_width(0, 11.0)?;
    aba.set_column_width(1, 28.0)?;
    aba.set_column_width(2, 18.0)?;
    for i in 0..n_dias {
        aba.set_column_width(coluna(COLUNAS_ID + i)?, 6.0)?;
    }
    aba.set_column_width(col_total, 11.0)?;

    // Título, empregador e regra aplicada.
    let fmt_titulo = formato_texto(16.0, COR_TEXTO).set_bold();
    aba.merge_range(0, 0, 0, col_total, &escala.titulo, &fmt_titulo)?;
    aba.set_row_height(0, 24.0)?;
    let fmt_empregador = formato_texto(12.0, COR_TEXTO).set_bold();
    aba.merge_range(1, 0, 1, col_total, &escala.empregador, &fmt_empregador)?;
    let fmt_regra = formato_texto(10.0, COR_TEXTO_SUAVE);
    aba.merge_range(2, 0, 2, col_total, &escala.regra, &fmt_regra)?;

    // Cabeçalho: identificação, um dia por coluna (número + dia da semana) e total.
    let fmt_cab = formato_cabecalho(COR_CABECALHO);
    let fmt_cab_domingo = formato_cabecalho(COR_CABECALHO_DOMINGO);
    for (i, titulo) in ["Matrícula", "Nome", "Função"].iter().enumerate() {
        aba.write_string_with_format(LINHA_CABECALHO, coluna(i)?, *titulo, &fmt_cab)?;
    }
    for (i, dia) in escala.dias.iter().enumerate() {
        let fmt = if eh_domingo(dia) {
            &fmt_cab_domingo
        } else {
            &fmt_cab
        };
        let texto = format!("{}\n{}", dia.day(), abreviatura(dia.weekday()));
        aba.write_string_with_format(LINHA_CABECALHO, coluna(COLUNAS_ID + i)?, texto, fmt)?;
    }
    aba.write_string_with_format(LINHA_CABECALHO, col_total, "Horas no mês", &fmt_cab)?;
    aba.set_row_height(LINHA_CABECALHO, 30.0)?;

    // Uma linha por funcionário.
    let fmt_id = formato_identificacao();
    let fmt_total = formato_celula(COR_TOTAL, COR_TEXTO, 10.0, false).set_bold();
    for (idx, f) in escala.funcionarios.iter().enumerate() {
        let l = PRIMEIRA_LINHA_DADOS.saturating_add(linha(idx)?);
        aba.set_row_height(l, ALTURA_LINHA)?;
        aba.write_string_with_format(l, 0, &f.matricula, &fmt_id)?;
        aba.write_string_with_format(l, 1, &f.nome, &fmt_id)?;
        aba.write_string_with_format(l, 2, f.funcao.as_deref().unwrap_or(""), &fmt_id)?;
        for (i, (celula, dia)) in f.celulas.iter().zip(&escala.dias).enumerate() {
            escrever_celula(aba, l, coluna(COLUNAS_ID + i)?, celula, eh_domingo(dia))?;
        }
        aba.write_string_with_format(l, col_total, formatar_minutos(f.total_min), &fmt_total)?;
    }

    // Sem funcionários: uma linha avisando, para a planilha não ficar sem corpo.
    let mut l = PRIMEIRA_LINHA_DADOS.saturating_add(linha(escala.funcionarios.len())?);
    if escala.funcionarios.is_empty() {
        let fmt = formato_celula(0xFFFFFF, COR_TEXTO_SUAVE, 10.0, false).set_italic();
        aba.merge_range(l, 0, l, col_total, "Nenhum funcionário na escala", &fmt)?;
        l = l.saturating_add(1);
    }

    // Legenda: turnos (amostra + nome e horário), folga e ausência.
    l = l.saturating_add(1);
    let fmt_legenda = formato_texto(10.0, COR_TEXTO).set_bold();
    aba.write_string_with_format(l, 0, "Legenda", &fmt_legenda)?;
    let fmt_item = formato_texto(9.0, COR_TEXTO);
    let mut itens: Vec<(u32, String)> = escala
        .turnos
        .iter()
        .map(|t| {
            (
                clarear(interpretar_cor(&t.cor)),
                format!("{}  {}–{}", t.nome, t.inicio, t.fim),
            )
        })
        .collect();
    itens.push((COR_FOLGA, "F = folga".to_string()));
    itens.push((
        COR_AUSENCIA,
        "AUS (ou o motivo) = ausência, como férias ou afastamento".to_string(),
    ));
    for (fundo, texto) in &itens {
        l = l.saturating_add(1);
        aba.write_blank(l, 0, &formato_celula(*fundo, COR_TEXTO, 8.0, false))?;
        aba.write_string_with_format(l, 1, texto, &fmt_item)?;
    }

    // Rodapé e linha de assinatura.
    l = l.saturating_add(2);
    if !escala.rodape.trim().is_empty() {
        let fmt = formato_texto(9.0, COR_TEXTO_SUAVE).set_italic();
        aba.merge_range(l, 0, l, col_total, &escala.rodape, &fmt)?;
        l = l.saturating_add(2);
    }
    let fmt_assinatura = formato_texto(11.0, COR_TEXTO).set_align(FormatAlign::Bottom);
    aba.merge_range(
        l,
        0,
        l,
        col_total,
        "Responsável: ________________________________________",
        &fmt_assinatura,
    )?;
    aba.set_row_height(l, 30.0)?;

    aba.set_print_area(0, 0, l, col_total)?;
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum SituacaoSemana {
    Normal,
    /// Acima do limite semanal (não deveria acontecer).
    Acima,
    /// Abaixo de 75% do limite.
    Baixa,
}

fn situacao(s: &HorasSemanaExportar) -> SituacaoSemana {
    if s.minutos > s.limite_min {
        SituacaoSemana::Acima
    } else if u64::from(s.minutos) * FRACAO_BAIXA.1 < u64::from(s.limite_min) * FRACAO_BAIXA.0 {
        SituacaoSemana::Baixa
    } else {
        SituacaoSemana::Normal
    }
}

fn montar_aba_horas(aba: &mut Worksheet, escala: &EscalaParaExportar) -> Result<(), XlsxError> {
    aba.set_name(ABA_HORAS)?;
    configurar_impressao(aba);
    aba.set_repeat_rows(0, 0)?;
    aba.set_freeze_panes(1, 2)?;
    aba.set_column_width(0, 11.0)?;
    aba.set_column_width(1, 30.0)?;

    // O cabeçalho das semanas vem do primeiro funcionário (todos usam o mesmo mês).
    let semanas_cab: &[HorasSemanaExportar] = escala
        .funcionarios
        .first()
        .map_or(&[], |f| f.semanas.as_slice());
    let n_semanas = semanas_cab.len();
    let ultima_col = coluna(1 + n_semanas.max(1))?;

    let fmt_cab = formato_cabecalho(COR_CABECALHO);
    aba.write_string_with_format(0, 0, "Matrícula", &fmt_cab)?;
    aba.write_string_with_format(0, 1, "Nome", &fmt_cab)?;
    for (i, s) in semanas_cab.iter().enumerate() {
        let c = coluna(2 + i)?;
        aba.set_column_width(c, 16.0)?;
        aba.write_string_with_format(0, c, &s.rotulo, &fmt_cab)?;
    }
    aba.set_row_height(0, 24.0)?;

    let fmt_id = formato_identificacao();
    let fmt_normal = formato_celula(0xFFFFFF, COR_TEXTO, 10.0, false);
    let fmt_acima = formato_celula(COR_ACIMA_FUNDO, COR_ACIMA_TEXTO, 10.0, false).set_bold();
    let fmt_baixa = formato_celula(COR_AUSENCIA, COR_TEXTO, 10.0, false);
    let fmt_sem_dado = formato_celula(0xFFFFFF, COR_TEXTO_SUAVE, 10.0, false);
    for (idx, f) in escala.funcionarios.iter().enumerate() {
        let l = linha(1 + idx)?;
        aba.write_string_with_format(l, 0, &f.matricula, &fmt_id)?;
        aba.write_string_with_format(l, 1, &f.nome, &fmt_id)?;
        for i in 0..n_semanas {
            let c = coluna(2 + i)?;
            match f.semanas.get(i) {
                Some(s) => {
                    let fmt = match situacao(s) {
                        SituacaoSemana::Normal => &fmt_normal,
                        SituacaoSemana::Acima => &fmt_acima,
                        SituacaoSemana::Baixa => &fmt_baixa,
                    };
                    let texto = format!(
                        "{} / {}",
                        formatar_minutos(s.minutos),
                        formatar_minutos(s.limite_min)
                    );
                    aba.write_string_with_format(l, c, texto, fmt)?;
                }
                None => {
                    aba.write_string_with_format(l, c, "—", &fmt_sem_dado)?;
                }
            }
        }
    }

    let mut ultima_linha = linha(escala.funcionarios.len())?;
    if escala.funcionarios.is_empty() {
        let fmt = formato_texto(10.0, COR_TEXTO_SUAVE).set_italic();
        aba.write_string_with_format(1, 0, "Nenhum funcionário na escala", &fmt)?;
        ultima_linha = 1;
    } else {
        ultima_linha = ultima_linha.saturating_add(2);
        let fmt = formato_texto(9.0, COR_TEXTO_SUAVE).set_italic();
        aba.write_string_with_format(
            ultima_linha,
            0,
            "Formato: horas na semana / limite semanal. Vermelho = acima do limite; âmbar = abaixo de 75% do limite.",
            &fmt,
        )?;
    }
    aba.set_print_area(0, 0, ultima_linha, ultima_col)?;
    Ok(())
}

pub fn salvar_escala(caminho: &Path, escala: &EscalaParaExportar) -> Result<(), ErroImportacao> {
    let bytes = exportar_escala_bytes(escala)?;
    std::fs::write(caminho, bytes)
        .map_err(|e| ErroImportacao::Exportacao(format!("{}: {e}", caminho.display())))
}
