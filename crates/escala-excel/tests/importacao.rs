//! Testes da importação de planilhas, montadas em memória com rust_xlsxwriter.

use std::io::Cursor;

use calamine::{Reader, Xlsx};
use chrono::NaiveDate;
use escala_core::{Periodo, RegrasCarga};
use escala_excel::{
    ler_bytes, ler_planilha, modelo_em_bytes, ContextoImportacao, ErroImportacao,
    FuncionarioImportado, ResultadoLeitura,
};
use rust_xlsxwriter::{ExcelDateTime, Format, Workbook};

/// Célula de teste: texto, número ou hora real do Excel.
enum C {
    T(&'static str),
    N(f64),
    Hora(u16, u8),
    Data(u16, u8, u8),
    B(bool),
    V,
}

fn planilha(abas: &[(&str, Vec<Vec<C>>)]) -> Vec<u8> {
    let mut pasta = Workbook::new();
    let fmt_hora = Format::new().set_num_format("hh:mm");
    let fmt_data = Format::new().set_num_format("dd/mm/yyyy");
    for (nome, linhas) in abas {
        let aba = pasta.add_worksheet();
        aba.set_name(*nome).expect("nome");
        for (l, linha) in linhas.iter().enumerate() {
            for (c, cel) in linha.iter().enumerate() {
                let (l, c) = (l as u32, c as u16);
                match cel {
                    C::T(t) => {
                        aba.write_string(l, c, *t).expect("texto");
                    }
                    C::N(n) => {
                        aba.write_number(l, c, *n).expect("número");
                    }
                    C::Hora(hh, mm) => {
                        let dt = ExcelDateTime::from_hms(*hh, *mm, 0).expect("hora");
                        aba.write_datetime_with_format(l, c, &dt, &fmt_hora)
                            .expect("hora");
                    }
                    C::Data(a, m, d) => {
                        let dt = ExcelDateTime::from_ymd(*a, *m, *d).expect("data");
                        aba.write_datetime_with_format(l, c, &dt, &fmt_data)
                            .expect("data");
                    }
                    C::B(b) => {
                        aba.write_boolean(l, c, *b).expect("booleano");
                    }
                    C::V => {}
                }
            }
        }
    }
    pasta.save_to_buffer().expect("buffer")
}

fn cabecalho() -> Vec<C> {
    ["matricula", "nome", "cargo", "preferencia", "carga_semanal"]
        .into_iter()
        .map(C::T)
        .collect()
}

fn ler(bytes: Vec<u8>) -> Result<ResultadoLeitura, ErroImportacao> {
    let regras = RegrasCarga::default();
    ler_bytes(bytes, &ContextoImportacao { regras: &regras })
}

fn erros_da_linha(r: &ResultadoLeitura, linha: u32) -> String {
    r.rejeitadas
        .iter()
        .find(|x| x.linha == linha)
        .map(|x| x.erros.join(" | "))
        .unwrap_or_default()
}

fn por_matricula<'a>(r: &'a ResultadoLeitura, m: &str) -> &'a FuncionarioImportado {
    r.funcionarios
        .iter()
        .find(|f| f.matricula == m)
        .unwrap_or_else(|| panic!("matrícula {m} não importada: {:?}", r.rejeitadas))
}

#[test]
fn importa_linhas_validas_em_varios_formatos() {
    use C::*;
    let bytes = planilha(&[(
        "Funcionarios",
        vec![
            cabecalho(),
            vec![N(1001.0), T("Ana Souza"), T("Vigilante"), T("Manhã"), V],
            vec![T("1002"), T("Bruno Lima"), V, T("tarde"), N(36.0)],
            vec![T("1003"), T("Carla Dias"), V, T("NOITE"), V],
            vec![T("1004"), T("Diego Rocha"), V, T("  manha "), T("37,5h")],
            vec![T("1005"), T("Eva Prado"), V, V, V],
        ],
    )]);
    let r = ler(bytes).expect("leitura");
    assert!(r.rejeitadas.is_empty(), "{:?}", r.rejeitadas);
    assert!(r.avisos.is_empty(), "{:?}", r.avisos);
    assert_eq!(r.total_linhas, 5);
    assert_eq!(r.funcionarios.len(), 5);

    let ana = por_matricula(&r, "1001");
    assert_eq!(ana.nome, "Ana Souza");
    assert_eq!(ana.cargo.as_deref(), Some("Vigilante"));
    assert_eq!(ana.linha, 2);
    assert_eq!(ana.preferencia, Some(Periodo::Manha));
    assert_eq!(ana.carga_semanal_min, None);
    let bruno = por_matricula(&r, "1002");
    assert_eq!(bruno.preferencia, Some(Periodo::Tarde));
    assert_eq!(bruno.carga_semanal_min, Some(36 * 60));
    assert_eq!(por_matricula(&r, "1003").preferencia, Some(Periodo::Noite));
    let diego = por_matricula(&r, "1004");
    assert_eq!(diego.preferencia, Some(Periodo::Manha));
    assert_eq!(diego.carga_semanal_min, Some(37 * 60 + 30));
    // Coluna vazia = sem preferência.
    assert_eq!(por_matricula(&r, "1005").preferencia, None);
}

#[test]
fn preferencia_invalida_rejeita_a_linha_listando_os_valores_aceitos() {
    use C::*;
    let bytes = planilha(&[(
        "Funcionarios",
        vec![
            cabecalho(),
            vec![T("1"), T("Ana"), V, T("Madrugada"), V],
            vec![T("2"), T("Bia"), V, T("Tarde"), V],
            vec![T("3"), T("Caio"), V, N(7.0), V],
        ],
    )]);
    let r = ler(bytes).expect("leitura");
    assert_eq!(r.funcionarios.len(), 1);
    assert_eq!(r.funcionarios[0].matricula, "2");
    assert_eq!(r.rejeitadas.len(), 2);
    let erros = erros_da_linha(&r, 2);
    assert!(erros.contains("preferencia"), "{erros}");
    assert!(erros.contains("\"Madrugada\""), "{erros}");
    assert!(erros.contains("Manhã, Tarde ou Noite"), "{erros}");
    assert!(erros_da_linha(&r, 4).contains("\"7\""));
}

#[test]
fn rejeita_linhas_invalidas_com_motivo_e_aceita_as_demais() {
    use C::*;
    let bytes = planilha(&[(
        "Funcionarios",
        vec![
            cabecalho(),
            vec![T("2001"), V, V, T("Manhã"), V], // 2: sem nome
            vec![T("2002"), T("Gil"), V, T("Madrugada"), V], // 3: preferência inválida
            vec![T("2003"), T("Hugo"), V, T("Manhã"), V], // 4: válida
            vec![T("2003"), T("Hugo 2"), V, V, V], // 5: matrícula repetida
            vec![T("2004"), T("Iris"), V, V, T("muitas")], // 6: carga inválida
            vec![V, V, V, V, V],                  // 7: vazia (ignorada)
            vec![T("2005"), T("João"), V, V, N(0.0)], // 8: carga 0
            vec![T("2006"), T("Kátia"), V, V, N(200.0)], // 9: carga acima de 168h
            vec![V, T("Léo"), V, V, V],           // 10: sem matrícula
        ],
    )]);
    let r = ler(bytes).expect("leitura");
    assert_eq!(
        r.funcionarios
            .iter()
            .map(|f| f.matricula.as_str())
            .collect::<Vec<_>>(),
        vec!["2003"]
    );
    assert_eq!(r.total_linhas, 8);
    assert_eq!(r.rejeitadas.len(), 7);
    assert!(erros_da_linha(&r, 2).contains("nome não informado"));
    assert!(erros_da_linha(&r, 3).contains("\"Madrugada\" inválida"));
    assert!(erros_da_linha(&r, 5).contains("repetida (já aparece na linha 4)"));
    assert!(erros_da_linha(&r, 6).contains("não é um número"));
    assert!(erros_da_linha(&r, 8).contains("fora do intervalo"));
    assert!(erros_da_linha(&r, 9).contains("fora do intervalo"));
    assert!(erros_da_linha(&r, 10).contains("matricula não informado"));
    assert!(r.rejeitadas.iter().all(|x| x.aba == "Funcionarios"));
}

#[test]
fn carga_acima_do_limite_do_cliente_vira_aviso() {
    use C::*;
    let bytes = planilha(&[(
        "Funcionarios",
        vec![cabecalho(), vec![T("1"), T("Ana"), V, V, N(44.0)]],
    )]);
    let r = ler(bytes).expect("leitura");
    assert_eq!(por_matricula(&r, "1").carga_semanal_min, Some(44 * 60));
    assert_eq!(r.avisos.len(), 1);
    assert!(
        r.avisos[0].contains("acima do limite do cliente"),
        "{:?}",
        r.avisos
    );
}

const AVISO_HORARIO: &str = "os horários vêm do funcionamento do cliente";

#[test]
fn colunas_de_horario_geram_um_unico_aviso_na_ordem_do_cabecalho() {
    use C::*;
    let bytes = planilha(&[(
        "Funcionarios",
        vec![
            [
                "matricula",
                "nome",
                "dias_disponiveis",
                "turno",
                "preferencia",
                "entrada",
                "saida",
                "intervalo_min",
            ]
            .into_iter()
            .map(T)
            .collect(),
            vec![
                T("1"),
                T("Ana"),
                T("seg-sex"),
                T("Manhã"),
                T("Tarde"),
                Hora(7, 0),
                Hora(15, 0),
                N(60.0),
            ],
            vec![
                T("2"),
                T("Bia"),
                T("sab,dom"),
                T("Tarde"),
                V,
                T("13:00"),
                T("21:00"),
                N(30.0),
            ],
            vec![T("3"), T("Caio"), V, V, V, V, V, V],
        ],
    )]);
    let r = ler(bytes).expect("leitura");
    assert!(r.rejeitadas.is_empty(), "{:?}", r.rejeitadas);
    assert_eq!(r.funcionarios.len(), 3);
    assert_eq!(
        r.avisos,
        vec![format!(
            "colunas de horário ignoradas (dias_disponiveis, turno, entrada, saida, intervalo_min): {AVISO_HORARIO}"
        )]
    );
}

#[test]
fn aviso_de_horario_lista_so_as_presentes_e_nao_repete_por_apelido() {
    use C::*;
    // Apelidos ("Turnos", "Hora Entrada", "Pausa") e coluna repetida ("Entrada") não
    // geram avisos extras de coluna não reconhecida ou repetida.
    let bytes = planilha(&[(
        "Funcionarios",
        vec![
            [
                "Matrícula",
                "Nome",
                "Turnos",
                "Hora Entrada",
                "Entrada",
                "Pausa",
            ]
            .into_iter()
            .map(T)
            .collect(),
            vec![
                T("1"),
                T("Ana"),
                T("Manhã"),
                T("07:00"),
                T("08:00"),
                N(60.0),
            ],
        ],
    )]);
    let r = ler(bytes).expect("leitura");
    assert_eq!(
        r.avisos,
        vec![format!(
            "colunas de horário ignoradas (turno, entrada, intervalo_min): {AVISO_HORARIO}"
        )]
    );

    let so_entrada = planilha(&[(
        "Funcionarios",
        vec![
            ["matricula", "nome", "entrada"]
                .into_iter()
                .map(T)
                .collect(),
            vec![T("1"), T("Ana"), T("07:00")],
        ],
    )]);
    let r = ler(so_entrada).expect("leitura");
    assert_eq!(
        r.avisos,
        vec![format!(
            "colunas de horário ignoradas (entrada): {AVISO_HORARIO}"
        )]
    );
}

#[test]
fn colunas_de_horario_nunca_sao_validadas_nem_viram_preferencia() {
    use C::*;
    let bytes = planilha(&[(
        "Funcionarios",
        vec![
            [
                "matricula",
                "nome",
                "preferencia",
                "turno",
                "entrada",
                "saida",
                "intervalo_min",
                "dias_disponiveis",
            ]
            .into_iter()
            .map(T)
            .collect(),
            // Valores que antes rejeitariam ou definiriam preferência: tudo ignorado.
            vec![
                T("1"),
                T("Ana"),
                V,
                T("Manhã"),
                Hora(7, 0),
                T("99:99"),
                N(-5.0),
                T("seg,feriado"),
            ],
            vec![
                T("2"),
                T("Bia"),
                V,
                T("Madrugada"),
                T("25:00"),
                V,
                T("muito"),
                T("sab,dom"),
            ],
            // Só a coluna `preferencia` define a preferência.
            vec![
                T("3"),
                T("Caio"),
                T("Noite"),
                T("Manhã"),
                Hora(7, 0),
                V,
                V,
                V,
            ],
            // E uma preferência inválida continua rejeitando a linha.
            vec![T("4"), T("Dani"), T("Madrugada"), T("Manhã"), V, V, V, V],
        ],
    )]);
    let r = ler(bytes).expect("leitura");
    assert_eq!(r.funcionarios.len(), 3);
    assert_eq!(r.rejeitadas.len(), 1);
    assert!(erros_da_linha(&r, 5).contains("Manhã, Tarde ou Noite"));
    assert_eq!(por_matricula(&r, "1").preferencia, None);
    assert_eq!(por_matricula(&r, "2").preferencia, None);
    assert_eq!(por_matricula(&r, "3").preferencia, Some(Periodo::Noite));
    assert_eq!(r.avisos.len(), 1, "{:?}", r.avisos);
}

#[test]
fn sem_colunas_de_horario_nao_ha_aviso() {
    use C::*;
    let bytes = planilha(&[(
        "Funcionarios",
        vec![cabecalho(), vec![T("1"), T("Ana"), V, T("Manhã"), V]],
    )]);
    let r = ler(bytes).expect("leitura");
    assert!(r.avisos.is_empty(), "{:?}", r.avisos);
}

#[test]
fn cabecalho_sem_diferenciar_acentos_e_colunas_extras() {
    use C::*;
    let bytes = planilha(&[(
        "Plan1",
        vec![
            vec![
                T("Matrícula"),
                T("Nome Completo"),
                T("Preferência"),
                T("Observação"),
            ],
            vec![T("1"), T("Ana"), T("Noite"), T("qualquer coisa")],
        ],
    )]);
    let r = ler(bytes).expect("leitura");
    assert_eq!(r.funcionarios.len(), 1);
    assert_eq!(r.funcionarios[0].preferencia, Some(Periodo::Noite));
    assert!(r
        .avisos
        .iter()
        .any(|a| a.contains("\"Observação\" não reconhecida")));
}

#[test]
fn falta_de_coluna_obrigatoria_e_erro_claro() {
    use C::*;
    let bytes = planilha(&[(
        "Funcionarios",
        vec![
            vec![T("matricula"), T("cargo")],
            vec![T("1"), T("Vigilante")],
        ],
    )]);
    match ler(bytes) {
        Err(ErroImportacao::ColunasAusentes {
            faltando,
            encontradas,
            ..
        }) => {
            assert_eq!(faltando, vec!["nome"]);
            assert_eq!(encontradas, vec!["matricula", "cargo"]);
        }
        outro => panic!("esperava ColunasAusentes, veio {outro:?}"),
    }
}

#[test]
fn aba_de_ausencias() {
    use C::*;
    let bytes = planilha(&[
        (
            "Funcionarios",
            vec![cabecalho(), vec![T("1"), T("Ana"), V, T("Manhã"), V]],
        ),
        (
            "Ausências",
            vec![
                vec![T("matricula"), T("inicio"), T("fim"), T("motivo")],
                vec![T("1"), Data(2026, 3, 10), Data(2026, 3, 20), T("Férias")],
                vec![T("1"), T("25/12/2026"), V, V],
                vec![T("1"), T("20/03/2026"), T("10/03/2026"), V],
                vec![T("1"), T("32/01/2026"), V, V],
                vec![V, T("01/01/2026"), V, V],
            ],
        ),
    ]);
    let r = ler(bytes).expect("leitura");
    assert_eq!(r.ausencias.len(), 2);
    assert_eq!(r.ausencias[0].motivo.as_deref(), Some("Férias"));
    assert_eq!(r.ausencias[1].inicio, r.ausencias[1].fim);
    // Sem a coluna `justificada`, vale sim (férias, atestados).
    assert!(r.ausencias.iter().all(|a| a.justificada));
    assert_eq!(r.rejeitadas.len(), 3);
    assert!(r.rejeitadas.iter().all(|x| x.aba == "Ausências"));
    assert!(erros_da_linha(&r, 4).contains("anterior ao início"));
    assert!(erros_da_linha(&r, 5).contains("inválida"));
    assert!(erros_da_linha(&r, 6).contains("matricula não informado"));
}

/// Planilha com um funcionário e a aba Ausencias dada.
fn com_ausencias(linhas: Vec<Vec<C>>) -> Vec<u8> {
    use C::*;
    planilha(&[
        (
            "Funcionarios",
            vec![cabecalho(), vec![T("1"), T("Ana"), V, V, V]],
        ),
        ("Ausencias", linhas),
    ])
}

fn cabecalho_ausencias(ultima: &'static str) -> Vec<C> {
    ["matricula", "inicio", "motivo", ultima]
        .into_iter()
        .map(C::T)
        .collect()
}

#[test]
fn ausencia_justificada_em_varios_formatos() {
    use C::*;
    let valores = vec![
        (T("Sim"), true),
        (T("não"), false),
        (T("S"), true),
        (T("N"), false),
        (T("TRUE"), true),
        (T("false"), false),
        (N(1.0), true),
        (N(0.0), false),
        (T("x"), true),
        (T("NAO"), false),
        (B(true), true),
        (B(false), false),
        (V, true),
    ];
    let mut linhas = vec![cabecalho_ausencias("justificada")];
    let mut esperado = Vec::new();
    for (valor, justificada) in valores {
        linhas.push(vec![T("1"), T("10/03/2026"), T("Motivo"), valor]);
        esperado.push(justificada);
    }
    let r = ler(com_ausencias(linhas)).expect("leitura");
    assert!(r.rejeitadas.is_empty(), "{:?}", r.rejeitadas);
    assert!(r.avisos.is_empty(), "{:?}", r.avisos);
    let lidas: Vec<bool> = r.ausencias.iter().map(|a| a.justificada).collect();
    assert_eq!(lidas, esperado);
}

#[test]
fn ausencia_justificada_aceita_apelidos_do_cabecalho() {
    use C::*;
    for apelido in ["Justificado", "Abonada", "abonado", "Ausência justificada"] {
        let linhas = vec![
            cabecalho_ausencias(apelido),
            vec![T("1"), T("10/03/2026"), V, T("Não")],
        ];
        let r = ler(com_ausencias(linhas)).expect("leitura");
        assert!(r.avisos.is_empty(), "{apelido}: {:?}", r.avisos);
        assert_eq!(r.ausencias.len(), 1, "{apelido}");
        assert!(!r.ausencias[0].justificada, "{apelido}");
    }
}

#[test]
fn ausencia_sem_coluna_ou_com_celula_vazia_e_justificada() {
    use C::*;
    let sem_coluna = vec![
        ["matricula", "inicio"].into_iter().map(T).collect(),
        vec![T("1"), T("10/03/2026")],
    ];
    let r = ler(com_ausencias(sem_coluna)).expect("leitura");
    assert_eq!(r.ausencias.len(), 1);
    assert!(r.ausencias[0].justificada);

    let celula_vazia = vec![
        cabecalho_ausencias("justificada"),
        vec![T("1"), T("10/03/2026"), T("Férias"), V],
    ];
    let r = ler(com_ausencias(celula_vazia)).expect("leitura");
    assert_eq!(r.ausencias.len(), 1);
    assert!(r.ausencias[0].justificada);
}

#[test]
fn ausencia_com_justificada_invalida_rejeita_so_a_linha() {
    use C::*;
    let linhas = vec![
        cabecalho_ausencias("justificada"),
        vec![T("1"), T("10/03/2026"), V, T("talvez")], // 2: texto inválido
        vec![T("1"), T("11/03/2026"), V, T("Não")],    // 3: válida
        vec![T("1"), T("12/03/2026"), V, N(2.0)],      // 4: número inválido
    ];
    let r = ler(com_ausencias(linhas)).expect("leitura");
    assert_eq!(r.ausencias.len(), 1);
    assert_eq!(r.ausencias[0].linha, 3);
    assert!(!r.ausencias[0].justificada);
    assert_eq!(r.rejeitadas.len(), 2);
    assert!(r.rejeitadas.iter().all(|x| x.aba == "Ausencias"));
    let erros = erros_da_linha(&r, 2);
    assert!(erros.contains("justificada"), "{erros}");
    assert!(erros.contains("\"talvez\" inválida"), "{erros}");
    assert!(erros.contains("Sim ou Não"), "{erros}");
    assert!(erros_da_linha(&r, 4).contains("\"2\" inválida"));
}

fn data(a: i32, m: u32, d: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(a, m, d).expect("data")
}

#[test]
fn planilha_modelo_le_de_volta_sem_rejeicoes_nem_avisos() {
    let bytes = modelo_em_bytes().expect("modelo");
    let r = ler(bytes).expect("leitura");
    assert!(r.rejeitadas.is_empty(), "{:?}", r.rejeitadas);
    assert!(r.avisos.is_empty(), "{:?}", r.avisos);

    assert_eq!(r.total_linhas, 4);
    let nomes: Vec<_> = r
        .funcionarios
        .iter()
        .map(|f| (f.matricula.as_str(), f.nome.as_str()))
        .collect();
    assert_eq!(
        nomes,
        vec![
            ("1001", "Ana Souza"),
            ("1002", "Bruno Lima"),
            ("1003", "Carla Dias"),
            ("1004", "Diego Rocha")
        ]
    );
    let preferencias: Vec<_> = r.funcionarios.iter().map(|f| f.preferencia).collect();
    assert_eq!(
        preferencias,
        vec![
            Some(Periodo::Manha),
            Some(Periodo::Tarde),
            None,
            Some(Periodo::Noite)
        ]
    );
    assert_eq!(r.funcionarios[1].carga_semanal_min, Some(36 * 60));

    assert_eq!(r.ausencias.len(), 2);
    let (ferias, falta) = (&r.ausencias[0], &r.ausencias[1]);
    assert_eq!(ferias.matricula, "1002");
    assert_eq!(ferias.inicio, data(2026, 1, 5));
    assert_eq!(ferias.fim, data(2026, 1, 19));
    assert_eq!(ferias.motivo.as_deref(), Some("Férias"));
    assert!(ferias.justificada);
    assert_eq!(falta.matricula, "1003");
    assert_eq!(falta.inicio, data(2026, 1, 12));
    assert_eq!(falta.fim, falta.inicio);
    assert_eq!(falta.motivo.as_deref(), Some("Falta"));
    assert!(!falta.justificada);
}

#[test]
fn instrucoes_do_modelo_dizem_que_so_funcionarios_sao_importados() {
    let bytes = modelo_em_bytes().expect("modelo");
    let mut pasta: Xlsx<_> = Xlsx::new(Cursor::new(bytes)).expect("xlsx");
    let intervalo = pasta.worksheet_range("Instrucoes").expect("aba");
    let texto: String = intervalo
        .rows()
        .flatten()
        .map(|c| c.to_string())
        .collect::<Vec<_>>()
        .join("\n");
    assert!(texto.contains("Só funcionários são importados"), "{texto}");
    assert!(texto.contains("Configurações → Funcionamento"), "{texto}");
    assert!(texto.contains("justificada"), "{texto}");
    assert!(texto.contains("fica devendo as horas"), "{texto}");
}

#[test]
fn salvar_modelo_grava_arquivo_importavel() {
    let dir = std::env::temp_dir().join(format!("escala-excel-modelo-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("diretório");
    let caminho = dir.join("modelo.xlsx");
    escala_excel::salvar_modelo(&caminho).expect("salvar");
    let regras = RegrasCarga::default();
    let r = ler_planilha(&caminho, &ContextoImportacao { regras: &regras }).expect("leitura");
    std::fs::remove_dir_all(&dir).expect("limpeza");
    assert!(r.rejeitadas.is_empty(), "{:?}", r.rejeitadas);
    assert_eq!(r.funcionarios.len(), 4);
    assert_eq!(r.ausencias.len(), 2);
}

#[test]
fn erros_de_arquivo() {
    let regras = RegrasCarga::default();
    let ctx = ContextoImportacao { regras: &regras };
    assert!(matches!(
        ler_planilha(std::path::Path::new("dados.csv"), &ctx),
        Err(ErroImportacao::Extensao(_))
    ));
    assert!(matches!(
        ler_planilha(std::path::Path::new("/nao/existe.xlsx"), &ctx),
        Err(ErroImportacao::Leitura { .. })
    ));
    assert!(matches!(
        ler_bytes(b"isto nao e um xlsx".to_vec(), &ctx),
        Err(ErroImportacao::Arquivo(_))
    ));
    assert!(matches!(
        ler_bytes(Vec::new(), &ctx),
        Err(ErroImportacao::Arquivo(_))
    ));
    let vazia = planilha(&[("Funcionarios", vec![])]);
    assert!(matches!(
        ler_bytes(vazia, &ctx),
        Err(ErroImportacao::AbaVazia(_))
    ));
}
