//! Testes da leitura do Quadro de Horário de Trabalho, com planilhas sintéticas
//! montadas em memória (nomes e números fictícios).

use escala_core::{DiasSemana, HoraDoDia};
use escala_excel::{
    detectar_formato, ler_quadro, ler_quadro_bytes, modelo_em_bytes, ErroImportacao,
    FormatoPlanilha, FuncionarioQuadro, HorarioQuadro, QuadroHorario,
};
use rust_xlsxwriter::{ExcelDateTime, Format, Workbook};

use C::T;

const TITULO: &str = "Horário de Trabalho";
const EMPRESA: &str = "Empregador: EMPRESA FICTÍCIA LTDA\nEndereço.: R 7, 250                    Atividade.: Comércio varejista de produtos";
const CABECALHO: &str = "Cód     Nome do Funcionário      Nome do Função    Seção Numero   Serie     Ent.       Intervalo      Saida     Des      Visto";
const OBSERVACAO: &str = "Observação\nAos Funcionários é concedido intervalo de 15 minutos para lanche\nCidade Fictícia  01  de  outubro  de  2026";

/// Célula de teste.
enum C {
    T(&'static str),
    N(f64),
    Hora(u16, u8),
    V,
}

/// Linha da aba: células soltas ou uma célula mesclada de A a K.
enum L {
    Mesclada(&'static str),
    Celulas(Vec<C>),
}

fn planilha(abas: &[(&str, Vec<L>)]) -> Vec<u8> {
    let mut pasta = Workbook::new();
    let fmt_hora = Format::new().set_num_format("hh:mm");
    let fmt = Format::new();
    for (nome, linhas) in abas {
        let aba = pasta.add_worksheet();
        aba.set_name(*nome).expect("nome");
        for (l, linha) in linhas.iter().enumerate() {
            let l = l as u32;
            match linha {
                L::Mesclada(texto) => {
                    aba.merge_range(l, 0, l, 10, texto, &fmt).expect("mesclar");
                }
                L::Celulas(celulas) => {
                    for (c, cel) in celulas.iter().enumerate() {
                        let c = c as u16;
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
                            C::V => {}
                        }
                    }
                }
            }
        }
    }
    pasta.save_to_buffer().expect("buffer")
}

fn quadro(linhas: Vec<L>) -> Vec<u8> {
    planilha(&[("Table 1", linhas)])
}

/// As três linhas de topo de cada página.
fn pagina() -> Vec<L> {
    vec![
        L::Mesclada(TITULO),
        L::Mesclada(EMPRESA),
        L::Mesclada(CABECALHO),
    ]
}

fn func(
    cod: &'static str,
    nome: &'static str,
    ctps: &'static str,
    ent: C,
    inter: C,
    saida: C,
    des: C,
) -> L {
    L::Celulas(vec![
        T(cod),
        T(nome),
        T("Manipulador (a)"),
        C::V,
        T(ctps),
        T("00164"),
        ent,
        inter,
        saida,
        des,
    ])
}

fn cont(ent: C, inter: C, saida: C) -> L {
    L::Celulas(vec![C::V, C::V, C::V, C::V, C::V, C::V, ent, inter, saida])
}

fn vazia() -> L {
    L::Celulas(vec![])
}

fn hm(h: u32, m: u32) -> HoraDoDia {
    HoraDoDia::de_hm(h, m).expect("hora")
}

fn ler(linhas: Vec<L>) -> QuadroHorario {
    ler_quadro_bytes(quadro(linhas)).expect("leitura")
}

fn por_nome<'a>(q: &'a QuadroHorario, nome: &str) -> &'a FuncionarioQuadro {
    q.funcionarios
        .iter()
        .find(|f| f.nome == nome)
        .unwrap_or_else(|| panic!("funcionário {nome} não encontrado"))
}

fn horario(
    linha: u32,
    e: (u32, u32),
    s: (u32, u32),
    i: Option<((u32, u32), (u32, u32))>,
) -> HorarioQuadro {
    HorarioQuadro {
        linha,
        entrada: hm(e.0, e.1),
        saida: hm(s.0, s.1),
        intervalo: i.map(|(a, b)| (hm(a.0, a.1), hm(b.0, b.1))),
    }
}

fn erros_da_linha(q: &QuadroHorario, linha: u32) -> String {
    q.rejeitadas
        .iter()
        .find(|r| r.linha == linha)
        .map(|r| r.erros.join(" | "))
        .unwrap_or_default()
}

/// Quadro típico: dois funcionários, um com continuação (sábado), observação ao final.
fn quadro_tipico() -> Vec<L> {
    let mut l = pagina();
    l.push(func(
        "1",
        "Ana Teste",
        "00012345",
        T("09:00"),
        T("12:00 A 14:00"),
        T("19:00"),
        T("Dom"),
    ));
    l.push(cont(T("08:00"), T(":    A      :"), T("12:00")));
    l.push(func(
        "2",
        "Bruno Teste",
        "00023456",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom/Sáb"),
    ));
    l.push(vazia());
    l.push(L::Mesclada(OBSERVACAO));
    l
}

#[test]
fn detecta_quadro_e_planilha_padrao() {
    assert_eq!(
        detectar_formato(&quadro(quadro_tipico())).expect("detectar"),
        FormatoPlanilha::QuadroHorario
    );
    let modelo = modelo_em_bytes().expect("modelo");
    assert_eq!(
        detectar_formato(&modelo).expect("detectar"),
        FormatoPlanilha::Padrao
    );
}

#[test]
fn detecta_quadro_so_pelo_cabecalho_das_colunas() {
    // Sem o título "Horário de Trabalho": vale a célula com "Nome do Funcionário" e "Saída".
    let bytes = quadro(vec![
        L::Mesclada("Empregador: EMPRESA FICTÍCIA LTDA"),
        L::Mesclada(CABECALHO),
    ]);
    assert_eq!(
        detectar_formato(&bytes).expect("detectar"),
        FormatoPlanilha::QuadroHorario
    );
}

#[test]
fn detecta_em_qualquer_aba() {
    let bytes = planilha(&[
        ("Resumo", vec![L::Celulas(vec![T("nada a ver")])]),
        ("Table 1", quadro_tipico()),
    ]);
    assert_eq!(
        detectar_formato(&bytes).expect("detectar"),
        FormatoPlanilha::QuadroHorario
    );
    // E a leitura usa a aba certa.
    assert_eq!(
        ler_quadro_bytes(bytes).expect("leitura").funcionarios.len(),
        2
    );
}

#[test]
fn arquivo_invalido_vira_erro() {
    assert!(matches!(
        detectar_formato(b"isto nao e um xlsx"),
        Err(ErroImportacao::Arquivo(_))
    ));
    assert!(matches!(
        ler_quadro_bytes(b"isto nao e um xlsx".to_vec()),
        Err(ErroImportacao::Arquivo(_))
    ));
}

#[test]
fn le_empregador_endereco_atividade_e_observacoes() {
    let q = ler(quadro_tipico());
    assert_eq!(q.empregador.as_deref(), Some("EMPRESA FICTÍCIA LTDA"));
    assert_eq!(q.endereco.as_deref(), Some("R 7, 250"));
    assert_eq!(
        q.atividade.as_deref(),
        Some("Comércio varejista de produtos")
    );
    assert_eq!(
        q.observacoes,
        vec![
            "Aos Funcionários é concedido intervalo de 15 minutos para lanche".to_string(),
            "Cidade Fictícia 01 de outubro de 2026".to_string(),
        ]
    );
    assert!(q.rejeitadas.is_empty(), "{:?}", q.rejeitadas);
}

#[test]
fn le_funcionario_com_intervalo_e_continuacao_de_sabado() {
    let q = ler(quadro_tipico());
    assert_eq!(q.total_linhas, 2);
    let ana = por_nome(&q, "Ana Teste");
    assert_eq!(ana.linha, 4);
    assert_eq!(ana.codigo, "1");
    assert_eq!(ana.funcao.as_deref(), Some("Manipulador (a)"));
    assert_eq!(ana.secao, None);
    assert_eq!(ana.ctps_numero.as_deref(), Some("00012345"));
    assert_eq!(ana.ctps_serie.as_deref(), Some("00164"));
    assert_eq!(ana.descanso.indices(), vec![6]);
    assert_eq!(
        ana.horarios,
        vec![
            horario(4, (9, 0), (19, 0), Some(((12, 0), (14, 0)))),
            // O molde ": A :" é "sem intervalo".
            horario(5, (8, 0), (12, 0), None),
        ]
    );
}

#[test]
fn funcionario_sem_intervalo_e_descanso_domingo_e_sabado() {
    let q = ler(quadro_tipico());
    let bruno = por_nome(&q, "Bruno Teste");
    assert_eq!(bruno.linha, 6);
    assert_eq!(bruno.horarios, vec![horario(6, (8, 0), (14, 0), None)]);
    assert_eq!(bruno.descanso.indices(), vec![5, 6]);
}

#[test]
fn descanso_vazio_e_nenhum() {
    let q = ler({
        let mut l = pagina();
        l.push(func(
            "1",
            "Ana Teste",
            "1",
            T("08:00"),
            C::V,
            T("14:00"),
            C::V,
        ));
        l
    });
    assert_eq!(por_nome(&q, "Ana Teste").descanso, DiasSemana::NENHUM);
    assert!(q.rejeitadas.is_empty());
}

#[test]
fn horas_como_texto_e_como_hora_do_excel() {
    let q = ler({
        let mut l = pagina();
        l.push(func(
            "1",
            "Ana Teste",
            "11",
            C::Hora(9, 0),
            T("12:00 A 14:00"),
            C::Hora(18, 30),
            T("Dom"),
        ));
        l.push(func(
            "2",
            "Bruno Teste",
            "22",
            T("9:00"),
            T("12h as 13h"),
            T("18h30"),
            T("Dom"),
        ));
        l
    });
    assert!(q.rejeitadas.is_empty(), "{:?}", q.rejeitadas);
    let intervalo = |fim: u32| Some(((12, 0), (fim, 0)));
    assert_eq!(
        por_nome(&q, "Ana Teste").horarios,
        vec![horario(4, (9, 0), (18, 30), intervalo(14))]
    );
    assert_eq!(
        por_nome(&q, "Bruno Teste").horarios,
        vec![horario(5, (9, 0), (18, 30), intervalo(13))]
    );
}

#[test]
fn separadores_variados_no_intervalo() {
    const CASOS: [&str; 8] = [
        "12:00 A 14:00",
        "12:00 a 14:00",
        "12:00 às 14:00",
        "12:00 as 14:00",
        "12:00-14:00",
        "12:00 – 14:00",
        "12:00    A   14:00",
        "12:00A14:00",
    ];
    let mut l = pagina();
    for c in CASOS {
        l.push(func(
            "1",
            "Ana Teste",
            "1",
            T("09:00"),
            T(c),
            T("19:00"),
            C::V,
        ));
    }
    let q = ler(l);
    assert!(q.rejeitadas.is_empty(), "{:?}", q.rejeitadas);
    assert_eq!(q.funcionarios.len(), CASOS.len());
    for f in &q.funcionarios {
        assert_eq!(f.horarios[0].intervalo, Some((hm(12, 0), hm(14, 0))));
    }
}

#[test]
fn ctps_preserva_zeros_a_esquerda_quando_e_texto() {
    let q = ler({
        let mut l = pagina();
        l.push(func(
            "1",
            "Ana Teste",
            "00026631",
            T("08:00"),
            C::V,
            T("14:00"),
            C::V,
        ));
        l
    });
    let f = por_nome(&q, "Ana Teste");
    assert_eq!(f.ctps_numero.as_deref(), Some("00026631"));
    assert_eq!(f.ctps_serie.as_deref(), Some("00164"));
}

#[test]
fn ctps_e_codigo_numericos_viram_texto() {
    let q = ler({
        let mut l = pagina();
        l.push(L::Celulas(vec![
            C::N(7.0),
            T("Ana Teste"),
            T("Caixa"),
            C::V,
            C::N(26631.0),
            C::N(164.0),
            T("08:00"),
            C::V,
            T("14:00"),
        ]));
        l
    });
    let f = por_nome(&q, "Ana Teste");
    assert_eq!(f.codigo, "7");
    assert_eq!(f.ctps_numero.as_deref(), Some("26631"));
    assert_eq!(f.ctps_serie.as_deref(), Some("164"));
}

#[test]
fn continuacao_apos_cabecalho_de_pagina_repetido() {
    let mut l = pagina();
    l.push(func(
        "1",
        "Ana Teste",
        "11",
        T("09:00"),
        T("12:00 A 14:00"),
        T("19:00"),
        T("Dom"),
    ));
    // 5: fim da página 1, 6-8: topo da página 2, 9: continuação da Ana.
    l.push(func(
        "2",
        "Bruno Teste",
        "22",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    ));
    l.extend(pagina());
    l.push(cont(T("08:00"), T(":    A      :"), T("12:00")));
    l.push(func(
        "3",
        "Carla Teste",
        "33",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    ));
    let q = ler(l);
    assert!(q.rejeitadas.is_empty(), "{:?}", q.rejeitadas);
    assert_eq!(q.total_linhas, 3);
    assert_eq!(q.funcionarios.len(), 3);
    assert_eq!(por_nome(&q, "Ana Teste").horarios.len(), 1);
    // A continuação é do último funcionário lido antes do cabeçalho (Bruno).
    let bruno = por_nome(&q, "Bruno Teste");
    assert_eq!(bruno.horarios.len(), 2);
    assert_eq!(bruno.horarios[1], horario(9, (8, 0), (12, 0), None));
    assert_eq!(por_nome(&q, "Carla Teste").horarios.len(), 1);
    // O cabeçalho repetido não vira observação nem funcionário.
    assert!(q.observacoes.is_empty());
}

#[test]
fn observacao_no_fim_de_cada_pagina_nao_duplica_nem_engole_o_cabecalho() {
    let mut l = pagina();
    l.push(func(
        "1",
        "Ana Teste",
        "11",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    ));
    l.push(L::Mesclada(OBSERVACAO));
    l.extend(pagina());
    l.push(func(
        "2",
        "Bruno Teste",
        "22",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    ));
    l.push(L::Mesclada(OBSERVACAO));
    let q = ler(l);
    assert_eq!(q.funcionarios.len(), 2);
    assert_eq!(q.observacoes.len(), 2);
}

#[test]
fn rejeita_linhas_invalidas_com_motivo() {
    let mut l = pagina(); // linhas 1-3
    l.push(func(
        "1",
        "Ana Teste",
        "11",
        C::V,
        C::V,
        T("14:00"),
        T("Dom"),
    )); // 4: sem entrada
    l.push(func(
        "2",
        "Bruno Teste",
        "22",
        T("08:00"),
        C::V,
        C::V,
        T("Dom"),
    )); // 5: sem saída
    l.push(func(
        "3",
        "Carla Teste",
        "33",
        T("25:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    )); // 6: hora inválida
    l.push(func(
        "4",
        "Dani Teste",
        "44",
        T("08:00"),
        C::V,
        T("08:00"),
        T("Dom"),
    )); // 7: entrada == saída
    l.push(func(
        "5",
        "Edu Teste",
        "55",
        T("08:00"),
        T("quando der"),
        T("14:00"),
        T("Dom"),
    )); // 8: intervalo ilegível
    l.push(func(
        "6",
        "Fábio Teste",
        "66",
        T("08:00"),
        T("15:00 A 16:00"),
        T("14:00"),
        T("Dom"),
    )); // 9: intervalo fora da jornada
    l.push(func(
        "7",
        "Gil Teste",
        "77",
        T("08:00"),
        T("12:00"),
        T("14:00"),
        T("Dom"),
    )); // 10: intervalo com um horário só
    l.push(func(
        "8",
        "Hana Teste",
        "88",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    )); // 11: válida
    let q = ler(l);
    assert_eq!(q.total_linhas, 8);
    assert_eq!(q.funcionarios.len(), 1);
    assert_eq!(q.funcionarios[0].nome, "Hana Teste");
    assert_eq!(q.rejeitadas.len(), 7);

    assert!(erros_da_linha(&q, 4).contains("entrada não informada"));
    assert!(erros_da_linha(&q, 5).contains("saída não informada"));
    assert!(erros_da_linha(&q, 6).contains("entrada: "));
    assert!(erros_da_linha(&q, 7).contains("não podem ser iguais"));
    assert!(erros_da_linha(&q, 8).contains("intervalo"));
    assert!(erros_da_linha(&q, 9).contains("fora da jornada"));
    assert!(erros_da_linha(&q, 10).contains("intervalo"));

    let r = &q.rejeitadas[0];
    assert_eq!(r.aba, "Table 1");
    assert_eq!(r.linha, 4);
    // matrícula = número da CTPS (aqui, o texto da coluna Número).
    assert_eq!(r.matricula.as_deref(), Some("11"));
}

#[test]
fn rejeitada_sem_ctps_usa_o_codigo_como_matricula() {
    let q = ler({
        let mut l = pagina();
        l.push(L::Celulas(vec![
            T("9"),
            T("Ana Teste"),
            C::V,
            C::V,
            C::V,
            C::V,
            C::V,
            C::V,
            T("14:00"),
        ]));
        l
    });
    assert_eq!(q.rejeitadas.len(), 1);
    assert_eq!(q.rejeitadas[0].matricula.as_deref(), Some("9"));
    assert_eq!(q.total_linhas, 1);
}

#[test]
fn intervalo_que_atravessa_a_meia_noite() {
    let q = ler({
        let mut l = pagina();
        l.push(func(
            "1",
            "Ana Teste",
            "11",
            T("22:00"),
            T("02:00 A 03:00"),
            T("06:00"),
            T("Dom"),
        ));
        l.push(func(
            "2",
            "Bruno Teste",
            "22",
            T("22:00"),
            T("10:00 A 11:00"),
            T("06:00"),
            T("Dom"),
        ));
        l
    });
    assert_eq!(q.funcionarios.len(), 1);
    assert_eq!(q.funcionarios[0].nome, "Ana Teste");
    assert!(erros_da_linha(&q, 5).contains("fora da jornada"));
}

#[test]
fn continuacao_invalida_rejeita_so_a_continuacao() {
    let mut l = pagina();
    l.push(func(
        "1",
        "Ana Teste",
        "11",
        T("09:00"),
        T("12:00 A 14:00"),
        T("19:00"),
        T("Dom"),
    )); // 4
    l.push(cont(T("08:00"), T(":    A      :"), T("99:00"))); // 5: hora inválida
    l.push(cont(T("08:00"), C::V, T("12:00"))); // 6: boa
    let q = ler(l);
    assert_eq!(q.total_linhas, 1);
    assert_eq!(q.rejeitadas.len(), 1);
    assert_eq!(q.rejeitadas[0].linha, 5);
    assert_eq!(q.rejeitadas[0].matricula.as_deref(), Some("11"));
    assert!(erros_da_linha(&q, 5).contains("saída: "));
    assert!(erros_da_linha(&q, 5).contains("linha 4"));
    let ana = por_nome(&q, "Ana Teste");
    assert_eq!(ana.horarios.len(), 2);
    assert_eq!(ana.horarios[1].linha, 6);
}

#[test]
fn continuacao_sem_funcionario_antes_e_rejeitada() {
    let mut l = pagina();
    l.push(cont(T("08:00"), C::V, T("12:00"))); // 4: ninguém antes
    l.push(func(
        "1",
        "Ana Teste",
        "11",
        T("09:00"),
        C::V,
        T("19:00"),
        T("Dom"),
    ));
    let q = ler(l);
    assert_eq!(q.funcionarios.len(), 1);
    assert_eq!(q.total_linhas, 1);
    assert_eq!(q.rejeitadas.len(), 1);
    assert_eq!(q.rejeitadas[0].linha, 4);
    assert!(erros_da_linha(&q, 4).contains("sem funcionário antes"));
    assert_eq!(q.rejeitadas[0].matricula, None);
}

#[test]
fn continuacao_de_funcionario_rejeitado_vira_aviso() {
    let mut l = pagina();
    l.push(func(
        "1",
        "Ana Teste",
        "11",
        C::V,
        C::V,
        T("19:00"),
        T("Dom"),
    )); // 4: rejeitado
    l.push(cont(T("08:00"), C::V, T("12:00"))); // 5
    let q = ler(l);
    assert!(q.funcionarios.is_empty());
    assert_eq!(q.rejeitadas.len(), 1);
    assert!(q
        .avisos
        .iter()
        .any(|a| a.contains("Linha 5") && a.contains("linha 4")));
}

#[test]
fn avisos_de_codigo_ctps_e_descanso() {
    let mut l = pagina();
    l.push(func(
        "1",
        "Ana Teste",
        "11",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    )); // 4
    l.push(func(
        "1",
        "Bruno Teste",
        "22",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    )); // 5: código repetido
    l.push(func(
        "3",
        "Carla Teste",
        "11",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    )); // 6: CTPS repetida
    l.push(L::Celulas(vec![
        C::V,
        T("Dani Teste"),
        C::V,
        C::V,
        C::V,
        C::V,
        T("08:00"),
        C::V,
        T("14:00"),
        T("feriado"),
    ])); // 7: sem código, sem CTPS, descanso inválido
    let q = ler(l);
    assert_eq!(q.funcionarios.len(), 4, "avisos não rejeitam");
    let tem = |trecho: &str| q.avisos.iter().any(|a| a.contains(trecho));
    assert!(tem("Linha 5") && tem("código 1 repetido"));
    assert!(tem("Linha 6") && tem("CTPS 11 repetida"));
    assert!(tem("Linha 7") && tem("sem código"));
    assert!(tem("Linha 7") && tem("sem número de CTPS"));
    assert!(tem("descanso \"feriado\""));
    let dani = por_nome(&q, "Dani Teste");
    assert_eq!(dani.codigo, "");
    assert_eq!(dani.ctps_numero, None);
    assert_eq!(dani.descanso, DiasSemana::NENHUM);
}

#[test]
fn cabecalho_em_celulas_separadas_usa_o_mapeamento_por_nome() {
    // Colunas fora da ordem do quadro original: o título de cada célula manda.
    let cab = vec![
        T("Nome do Funcionário"),
        T("Cód"),
        T("Saída"),
        T("Ent."),
        T("Intervalo"),
        T("Número"),
        T("Série"),
        T("Função"),
        T("Des"),
    ];
    let q = ler(vec![
        L::Mesclada(TITULO),
        L::Celulas(cab),
        L::Celulas(vec![
            T("Ana Teste"),
            T("5"),
            T("18:00"),
            T("09:00"),
            T("12:00 A 13:00"),
            T("00011"),
            T("007"),
            T("Caixa"),
            T("Dom"),
        ]),
    ]);
    assert!(q.rejeitadas.is_empty(), "{:?}", q.rejeitadas);
    let f = por_nome(&q, "Ana Teste");
    assert_eq!(f.linha, 3);
    assert_eq!(f.codigo, "5");
    assert_eq!(f.funcao.as_deref(), Some("Caixa"));
    assert_eq!(f.ctps_numero.as_deref(), Some("00011"));
    assert_eq!(f.ctps_serie.as_deref(), Some("007"));
    assert_eq!(
        f.horarios,
        vec![horario(3, (9, 0), (18, 0), Some(((12, 0), (13, 0))))]
    );
    assert_eq!(f.descanso.indices(), vec![6]);
}

#[test]
fn cabecalho_ausente_e_erro_claro() {
    let r = ler_quadro_bytes(quadro(vec![
        L::Mesclada(TITULO),
        L::Mesclada(EMPRESA),
        func(
            "1",
            "Ana Teste",
            "11",
            T("08:00"),
            C::V,
            T("14:00"),
            T("Dom"),
        ),
    ]));
    match r {
        Err(ErroImportacao::ColunasAusentes {
            aba,
            faltando,
            encontradas,
        }) => {
            assert_eq!(aba, "Table 1");
            assert_eq!(faltando, vec!["cabeçalho do quadro".to_string()]);
            assert!(!encontradas.is_empty());
        }
        outro => panic!("esperava ColunasAusentes, veio {outro:?}"),
    }
}

#[test]
fn cabecalho_incompleto_lista_o_que_falta() {
    let r = ler_quadro_bytes(quadro(vec![
        L::Mesclada(TITULO),
        L::Celulas(vec![T("Cód"), T("Nome do Funcionário"), T("Ent.")]),
        func(
            "1",
            "Ana Teste",
            "11",
            T("08:00"),
            C::V,
            T("14:00"),
            T("Dom"),
        ),
    ]));
    match r {
        Err(ErroImportacao::ColunasAusentes {
            faltando,
            encontradas,
            ..
        }) => {
            assert_eq!(faltando, vec!["saída".to_string()]);
            assert_eq!(encontradas.len(), 3);
        }
        outro => panic!("esperava ColunasAusentes, veio {outro:?}"),
    }
    let mensagem = ler_quadro_bytes(quadro(vec![L::Mesclada(TITULO)]))
        .expect_err("sem cabeçalho")
        .to_string();
    assert!(mensagem.contains("cabeçalho do quadro"), "{mensagem}");
}

#[test]
fn aba_vazia_e_planilha_sem_abas_uteis() {
    let r = ler_quadro_bytes(quadro(vec![]));
    assert!(matches!(r, Err(ErroImportacao::AbaVazia(_))), "{r:?}");
}

#[test]
fn ler_quadro_por_caminho_exige_xlsx() {
    let dir = std::env::temp_dir().join("escala_excel_quadro_teste");
    std::fs::create_dir_all(&dir).expect("dir");
    let xlsx = dir.join("quadro.xlsx");
    std::fs::write(&xlsx, quadro(quadro_tipico())).expect("gravar");
    let q = ler_quadro(&xlsx).expect("leitura");
    assert_eq!(q.funcionarios.len(), 2);

    let csv = dir.join("quadro.csv");
    std::fs::write(&csv, "a;b").expect("gravar");
    assert!(matches!(ler_quadro(&csv), Err(ErroImportacao::Extensao(_))));
    assert!(matches!(
        ler_quadro(&dir.join("nao_existe.xlsx")),
        Err(ErroImportacao::Leitura { .. })
    ));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn linhas_soltas_sem_dados_geram_aviso_e_molde_sozinho_nao() {
    let mut l = pagina();
    l.push(func(
        "1",
        "Ana Teste",
        "11",
        T("08:00"),
        C::V,
        T("14:00"),
        T("Dom"),
    ));
    // Só o molde do intervalo: ignorada em silêncio.
    l.push(L::Celulas(vec![
        C::V,
        C::V,
        C::V,
        C::V,
        C::V,
        C::V,
        C::V,
        T(":    A      :"),
    ]));
    // Texto solto sem nome nem horário.
    l.push(L::Celulas(vec![C::V, C::V, T("lixo"), C::V]));
    let q = ler(l);
    assert_eq!(q.funcionarios.len(), 1);
    assert!(q.rejeitadas.is_empty());
    assert_eq!(
        q.avisos.iter().filter(|a| a.contains("ignorada")).count(),
        1,
        "{:?}",
        q.avisos
    );
    assert!(q.avisos.iter().any(|a| a.contains("Linha 6")));
}

/// Verificação manual contra um quadro real. Não roda por padrão:
/// `QUADRO_XLSX=/caminho/quadro.xlsx cargo test -p escala-excel --test quadro -- --ignored --nocapture`
/// Imprime só contagens (nada de nomes nem documentos).
#[test]
#[ignore]
fn arquivo_real_so_contagens() {
    let Some(caminho) = std::env::var_os("QUADRO_XLSX") else {
        println!("QUADRO_XLSX não definido; nada a verificar");
        return;
    };
    let caminho = std::path::PathBuf::from(caminho);
    if !caminho.exists() {
        println!("arquivo não existe; nada a verificar");
        return;
    }
    let bytes = std::fs::read(&caminho).expect("ler arquivo");
    println!(
        "formato = {:?}",
        detectar_formato(&bytes).expect("detectar")
    );
    let q = ler_quadro(&caminho).expect("quadro");
    let com_continuacao = q
        .funcionarios
        .iter()
        .filter(|f| f.horarios.len() > 1)
        .count();
    let sem_intervalo = q
        .funcionarios
        .iter()
        .filter(|f| f.horarios[0].intervalo.is_none())
        .count();
    let sem_ctps = q
        .funcionarios
        .iter()
        .filter(|f| f.ctps_numero.is_none())
        .count();
    let descanso_vazio = q
        .funcionarios
        .iter()
        .filter(|f| f.descanso == DiasSemana::NENHUM)
        .count();
    let avisos_ignorada = q.avisos.iter().filter(|a| a.contains("ignorad")).count();
    println!("empregador = {}", q.empregador.is_some());
    println!("endereco = {}", q.endereco.is_some());
    println!("atividade = {}", q.atividade.is_some());
    println!("observacoes = {}", q.observacoes.len());
    println!("total_linhas = {}", q.total_linhas);
    println!("funcionarios = {}", q.funcionarios.len());
    println!("com_continuacao = {com_continuacao}");
    println!("sem_intervalo_no_horario_principal = {sem_intervalo}");
    println!(
        "horarios_total = {}",
        q.funcionarios
            .iter()
            .map(|f| f.horarios.len())
            .sum::<usize>()
    );
    println!("sem_ctps = {sem_ctps}");
    println!("descanso_vazio = {descanso_vazio}");
    println!("rejeitadas = {}", q.rejeitadas.len());
    println!("avisos = {} (ignoradas: {avisos_ignorada})", q.avisos.len());
}
