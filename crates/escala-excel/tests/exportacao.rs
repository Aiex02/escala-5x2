//! Testes da exportação da escala: gera o .xlsx e relê com calamine.

use std::io::Cursor;

use calamine::{Data, Range, Reader, Xlsx};
use chrono::NaiveDate;
use escala_excel::{
    exportar_escala_bytes, salvar_escala, CelulaEscala, ErroImportacao, EscalaParaExportar,
    HorasSemanaExportar, LinhaEscalaExportar, TurnoExportar,
};

const LINHA_CABECALHO: u32 = 4;
const PRIMEIRA_LINHA_DADOS: u32 = 5;
const PRIMEIRA_COLUNA_DIA: u32 = 3;

fn dias_do_mes(ano: i32, mes: u32, quantidade: u32) -> Vec<NaiveDate> {
    (1..=quantidade)
        .map(|d| NaiveDate::from_ymd_opt(ano, mes, d).expect("data"))
        .collect()
}

fn turnos() -> Vec<TurnoExportar> {
    vec![
        TurnoExportar {
            nome: "Manhã".into(),
            inicio: "06:00".into(),
            fim: "14:00".into(),
            cor: "#2F80ED".into(),
        },
        TurnoExportar {
            nome: "Tarde".into(),
            inicio: "14:00".into(),
            fim: "22:00".into(),
            cor: "#F2994A".into(),
        },
    ]
}

fn trabalho(turno: &str, inicio: &str, fim: &str, cor: &str) -> CelulaEscala {
    CelulaEscala::Trabalho {
        turno: turno.into(),
        inicio: inicio.into(),
        fim: fim.into(),
        minutos: 480,
        cor: cor.into(),
    }
}

fn semanas(horas: &[(u32, u32)]) -> Vec<HorasSemanaExportar> {
    horas
        .iter()
        .enumerate()
        .map(|(i, (minutos, limite_min))| HorasSemanaExportar {
            rotulo: format!("semana {}", i + 1),
            minutos: *minutos,
            limite_min: *limite_min,
        })
        .collect()
}

/// Outubro de 2026 (1º = quinta-feira; domingos nos dias 4, 11, 18 e 25), 3 funcionários.
fn escala_exemplo() -> EscalaParaExportar {
    let dias = dias_do_mes(2026, 10, 31);
    // Ana: manhã em dias úteis, folga nos fins de semana.
    let ana: Vec<CelulaEscala> = dias
        .iter()
        .map(|d| match d.format("%u").to_string().as_str() {
            "6" | "7" => CelulaEscala::Folga,
            _ => trabalho("Manhã", "06:00", "14:00", "#2F80ED"),
        })
        .collect();
    // Bruno: tarde, com férias do dia 5 ao 11 (motivo com várias palavras).
    let bruno: Vec<CelulaEscala> = (1..=31)
        .map(|d| match d {
            5..=11 => CelulaEscala::Ausencia {
                motivo: Some("Férias de verão".into()),
            },
            12 | 19 | 26 => CelulaEscala::Folga,
            _ => trabalho("Tarde", "14:00", "22:00", "#F2994A"),
        })
        .collect();
    // Carla: ausência sem motivo no dia 1, o resto folga, exceto o dia 2 (turno com cor inválida).
    let carla: Vec<CelulaEscala> = (1..=31)
        .map(|d| match d {
            1 => CelulaEscala::Ausencia { motivo: None },
            2 => trabalho("Manhã", "07:00", "15:00", "azul"),
            _ => CelulaEscala::Folga,
        })
        .collect();
    EscalaParaExportar {
        empregador: "Condomínio Solar das Palmeiras".into(),
        titulo: "Escala de outubro de 2026".into(),
        regra: "Até 42h por semana e 2 folgas semanais (EC 141/2026)".into(),
        dias,
        turnos: turnos(),
        funcionarios: vec![
            LinhaEscalaExportar {
                matricula: "1001".into(),
                nome: "Ana Souza".into(),
                funcao: Some("Vigilante".into()),
                celulas: ana,
                semanas: semanas(&[(2400, 2520), (2400, 2520), (1200, 2520)]),
                total_min: 176 * 60,
            },
            LinhaEscalaExportar {
                matricula: "1002".into(),
                nome: "Bruno Lima".into(),
                funcao: None,
                celulas: bruno,
                semanas: semanas(&[(2520, 2520), (2700, 2520), (1000, 2520)]),
                total_min: 7 * 60 + 30,
            },
            LinhaEscalaExportar {
                matricula: "1003".into(),
                nome: "Carla Dias".into(),
                funcao: Some("Supervisora".into()),
                celulas: carla,
                semanas: semanas(&[(0, 2520), (480, 2520), (0, 2520)]),
                total_min: 480,
            },
        ],
        rodape: "Gerada em 22/10/2026 às 14:05".into(),
    }
}

fn abrir(bytes: Vec<u8>) -> Xlsx<Cursor<Vec<u8>>> {
    Xlsx::new(Cursor::new(bytes)).expect("xlsx válido")
}

fn aba(bytes: Vec<u8>, nome: &str) -> Range<Data> {
    abrir(bytes).worksheet_range(nome).expect("aba existe")
}

fn texto(r: &Range<Data>, linha: u32, coluna: u32) -> String {
    match r.get_value((linha, coluna)) {
        Some(Data::String(s)) => s.clone(),
        Some(Data::Empty) | None => String::new(),
        Some(outro) => outro.to_string(),
    }
}

/// Procura um texto exato em qualquer célula da aba.
fn existe(r: &Range<Data>, procurado: &str) -> bool {
    r.used_cells()
        .any(|(_, _, v)| matches!(v, Data::String(s) if s == procurado))
}

fn escala_bytes() -> Vec<u8> {
    exportar_escala_bytes(&escala_exemplo()).expect("exportação")
}

#[test]
fn gera_xlsx_com_as_duas_abas() {
    let bytes = escala_bytes();
    assert!(bytes.starts_with(b"PK"), "um .xlsx é um zip");
    assert_eq!(abrir(bytes).sheet_names(), ["Escala", "Horas por semana"]);
}

#[test]
fn titulo_empregador_e_regra_nas_tres_primeiras_linhas() {
    let r = aba(escala_bytes(), "Escala");
    assert_eq!(texto(&r, 0, 0), "Escala de outubro de 2026");
    assert_eq!(texto(&r, 1, 0), "Condomínio Solar das Palmeiras");
    assert_eq!(
        texto(&r, 2, 0),
        "Até 42h por semana e 2 folgas semanais (EC 141/2026)"
    );
}

#[test]
fn cabecalho_tem_identificacao_dias_e_total() {
    let r = aba(escala_bytes(), "Escala");
    assert_eq!(texto(&r, LINHA_CABECALHO, 0), "Matrícula");
    assert_eq!(texto(&r, LINHA_CABECALHO, 1), "Nome");
    assert_eq!(texto(&r, LINHA_CABECALHO, 2), "Função");
    // 1º/10/2026 é quinta; dia 3 é sábado; dia 4 é domingo; dia 5 é segunda.
    assert_eq!(texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA), "1\nqui");
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 1),
        "2\nsex"
    );
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 2),
        "3\nsáb"
    );
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 3),
        "4\ndom"
    );
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 4),
        "5\nseg"
    );
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 5),
        "6\nter"
    );
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 6),
        "7\nqua"
    );
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 30),
        "31\nsáb"
    );
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 31),
        "Horas no mês"
    );
}

#[test]
fn linhas_de_funcionarios_com_identificacao() {
    let r = aba(escala_bytes(), "Escala");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS, 0), "1001");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS, 1), "Ana Souza");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS, 2), "Vigilante");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS + 1, 0), "1002");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS + 1, 1), "Bruno Lima");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS + 1, 2), "", "sem função");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS + 2, 1), "Carla Dias");
}

#[test]
fn trabalho_mostra_entrada_e_saida_em_duas_linhas() {
    let r = aba(escala_bytes(), "Escala");
    // Ana, quinta 1º: manhã.
    assert_eq!(
        texto(&r, PRIMEIRA_LINHA_DADOS, PRIMEIRA_COLUNA_DIA),
        "06:00\n14:00"
    );
    // Bruno, quinta 1º: tarde.
    assert_eq!(
        texto(&r, PRIMEIRA_LINHA_DADOS + 1, PRIMEIRA_COLUNA_DIA),
        "14:00\n22:00"
    );
    // Carla, dia 2 (cor inválida cai para cinza, mas o horário aparece).
    assert_eq!(
        texto(&r, PRIMEIRA_LINHA_DADOS + 2, PRIMEIRA_COLUNA_DIA + 1),
        "07:00\n15:00"
    );
}

#[test]
fn folga_aparece_como_f() {
    let r = aba(escala_bytes(), "Escala");
    // Ana: sábado 3 e domingo 4.
    assert_eq!(
        texto(&r, PRIMEIRA_LINHA_DADOS, PRIMEIRA_COLUNA_DIA + 2),
        "F"
    );
    assert_eq!(
        texto(&r, PRIMEIRA_LINHA_DADOS, PRIMEIRA_COLUNA_DIA + 3),
        "F"
    );
    // Bruno: dia 12.
    assert_eq!(
        texto(&r, PRIMEIRA_LINHA_DADOS + 1, PRIMEIRA_COLUNA_DIA + 11),
        "F"
    );
}

#[test]
fn ausencia_usa_primeira_palavra_do_motivo_ou_aus() {
    let r = aba(escala_bytes(), "Escala");
    // Bruno, dias 5 a 11: "Férias de verão" -> "Férias".
    for dia in 5..=11 {
        assert_eq!(
            texto(&r, PRIMEIRA_LINHA_DADOS + 1, PRIMEIRA_COLUNA_DIA + dia - 1),
            "Férias"
        );
    }
    // Carla, dia 1: sem motivo.
    assert_eq!(
        texto(&r, PRIMEIRA_LINHA_DADOS + 2, PRIMEIRA_COLUNA_DIA),
        "AUS"
    );
}

#[test]
fn ausencia_com_motivo_em_branco_vira_aus() {
    let mut e = escala_exemplo();
    e.funcionarios[0].celulas[0] = CelulaEscala::Ausencia {
        motivo: Some("   ".into()),
    };
    let r = aba(exportar_escala_bytes(&e).expect("exportação"), "Escala");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS, PRIMEIRA_COLUNA_DIA), "AUS");
}

#[test]
fn total_do_mes_usa_a_mesma_regra_de_formatar_minutos() {
    let r = aba(escala_bytes(), "Escala");
    let col_total = PRIMEIRA_COLUNA_DIA + 31;
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS, col_total), "176h");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS + 1, col_total), "7h30");
    assert_eq!(texto(&r, PRIMEIRA_LINHA_DADOS + 2, col_total), "8h");
}

#[test]
fn legenda_rodape_e_assinatura_abaixo_da_tabela() {
    let r = aba(escala_bytes(), "Escala");
    assert!(existe(&r, "Legenda"));
    assert!(existe(&r, "Manhã  06:00–14:00"));
    assert!(existe(&r, "Tarde  14:00–22:00"));
    assert!(existe(&r, "F = folga"));
    assert!(existe(&r, "Gerada em 22/10/2026 às 14:05"));
    let (linha, _, _) = r
        .used_cells()
        .find(|(_, _, v)| matches!(v, Data::String(s) if s.starts_with("Responsável:")))
        .expect("linha de assinatura");
    // A assinatura é a última linha da planilha, depois dos 3 funcionários.
    assert_eq!(Some(linha), r.end().map(|(l, _)| l as usize));
    assert!(linha > (PRIMEIRA_LINHA_DADOS + 3) as usize);
}

#[test]
fn aba_de_horas_por_semana() {
    let r = aba(escala_bytes(), "Horas por semana");
    assert_eq!(texto(&r, 0, 0), "Matrícula");
    assert_eq!(texto(&r, 0, 1), "Nome");
    assert_eq!(texto(&r, 0, 2), "semana 1");
    assert_eq!(texto(&r, 0, 3), "semana 2");
    assert_eq!(texto(&r, 0, 4), "semana 3");
    assert_eq!(texto(&r, 1, 0), "1001");
    assert_eq!(texto(&r, 1, 1), "Ana Souza");
    assert_eq!(texto(&r, 1, 2), "40h / 42h");
    assert_eq!(texto(&r, 1, 4), "20h / 42h");
    // Bruno passou do limite na semana 2 (45h / 42h), apenas para exercitar o destaque.
    assert_eq!(texto(&r, 2, 2), "42h / 42h");
    assert_eq!(texto(&r, 2, 3), "45h / 42h");
    assert_eq!(texto(&r, 2, 4), "16h40 / 42h");
    assert_eq!(texto(&r, 3, 2), "0h / 42h");
}

#[test]
fn aba_de_horas_completa_semanas_faltantes_com_travessao() {
    let mut e = escala_exemplo();
    e.funcionarios[2].semanas.pop();
    let r = aba(
        exportar_escala_bytes(&e).expect("exportação"),
        "Horas por semana",
    );
    assert_eq!(texto(&r, 3, 3), "8h / 42h");
    assert_eq!(texto(&r, 3, 4), "—");
}

#[test]
fn erro_quando_o_numero_de_celulas_nao_bate_com_os_dias() {
    let mut e = escala_exemplo();
    e.funcionarios[1].celulas.pop();
    match exportar_escala_bytes(&e) {
        Err(ErroImportacao::Exportacao(msg)) => {
            assert!(msg.contains("1002"), "cita a matrícula: {msg}");
            assert!(msg.contains("Bruno Lima"), "cita o nome: {msg}");
            assert!(
                msg.contains("30") && msg.contains("31"),
                "cita as contagens: {msg}"
            );
        }
        outro => panic!("esperava erro de exportação, veio {outro:?}"),
    }
    let mut e = escala_exemplo();
    e.funcionarios[0].celulas.push(CelulaEscala::Folga);
    assert!(matches!(
        exportar_escala_bytes(&e),
        Err(ErroImportacao::Exportacao(_))
    ));
}

#[test]
fn escala_sem_funcionarios_gera_arquivo_valido() {
    let mut e = escala_exemplo();
    e.funcionarios.clear();
    let bytes = exportar_escala_bytes(&e).expect("exportação");
    let mut pasta = abrir(bytes);
    assert_eq!(pasta.sheet_names(), ["Escala", "Horas por semana"]);

    let r = pasta.worksheet_range("Escala").expect("aba");
    assert_eq!(texto(&r, 0, 0), "Escala de outubro de 2026");
    assert_eq!(texto(&r, LINHA_CABECALHO, 0), "Matrícula");
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 31),
        "Horas no mês"
    );
    assert_eq!(
        texto(&r, PRIMEIRA_LINHA_DADOS, 0),
        "Nenhum funcionário na escala"
    );
    assert!(existe(&r, "Manhã  06:00–14:00"), "a legenda continua");

    let h = pasta.worksheet_range("Horas por semana").expect("aba");
    assert_eq!(texto(&h, 0, 0), "Matrícula");
    assert_eq!(texto(&h, 0, 1), "Nome");
    assert_eq!(h.width(), 2, "sem colunas de semana");
}

#[test]
fn semana_curta_de_sete_dias_sem_turnos_nem_rodape() {
    let mut e = escala_exemplo();
    e.dias = dias_do_mes(2026, 10, 7);
    e.turnos.clear();
    e.rodape = String::new();
    for f in &mut e.funcionarios {
        f.celulas.truncate(7);
    }
    let r = aba(exportar_escala_bytes(&e).expect("exportação"), "Escala");
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 6),
        "7\nqua"
    );
    assert_eq!(
        texto(&r, LINHA_CABECALHO, PRIMEIRA_COLUNA_DIA + 7),
        "Horas no mês"
    );
    assert_eq!(
        texto(&r, PRIMEIRA_LINHA_DADOS, PRIMEIRA_COLUNA_DIA + 7),
        "176h"
    );
}

#[test]
fn salvar_escala_grava_arquivo_xlsx() {
    let pasta = std::env::temp_dir().join(format!(
        "escala-excel-exportacao-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    std::fs::create_dir_all(&pasta).expect("diretório temporário");
    let caminho = pasta.join("escala.xlsx");

    let resultado = salvar_escala(&caminho, &escala_exemplo());
    let bytes = std::fs::read(&caminho);
    let _ = std::fs::remove_dir_all(&pasta);

    resultado.expect("salvar");
    let r = aba(bytes.expect("arquivo gravado"), "Escala");
    assert_eq!(texto(&r, 0, 0), "Escala de outubro de 2026");
}

#[test]
fn salvar_escala_em_pasta_inexistente_devolve_erro_de_exportacao() {
    let caminho = std::env::temp_dir()
        .join("escala-excel-pasta-que-nao-existe-12345")
        .join("escala.xlsx");
    match salvar_escala(&caminho, &escala_exemplo()) {
        Err(ErroImportacao::Exportacao(msg)) => assert!(msg.contains("escala.xlsx"), "{msg}"),
        outro => panic!("esperava erro de exportação, veio {outro:?}"),
    }
}
