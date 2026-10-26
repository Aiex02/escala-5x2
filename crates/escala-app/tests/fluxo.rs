//! Fluxo completo dos casos de uso com banco em memória e planilhas reais em disco.
//!
//! Só dados sintéticos: nomes, matrículas e CTPS destes testes são inventados.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;

use chrono::{Datelike, NaiveDate, Weekday};
use escala_app::dto::{
    AgendaMesDto, AlocacaoDto, DiaFuncionamentoDto, DiaQuadroDto, FuncionamentoEntradaDto,
    FuncionarioDto, FuncionarioEdicaoDto, HorasSemanaFuncionarioDto, RegrasDto, TurnoDto,
    TurnoEntradaDto,
};
use escala_app::{ErroApp, Servico};
use escala_db::Banco;
use rust_xlsxwriter::Workbook;

fn servico() -> Servico {
    Servico::novo(Banco::em_memoria().expect("banco"))
}

fn data(ano: i32, mes: u32, dia: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(ano, mes, dia).expect("data")
}

fn dias_do_mes(ano: i32, mes: u32) -> Vec<NaiveDate> {
    data(ano, mes, 1)
        .iter_days()
        .take_while(|d| d.month() == mes)
        .collect()
}

// ---------------------------------------------------------------------- planilhas

fn linha(campos: &[&str]) -> Vec<String> {
    campos.iter().map(|c| (*c).to_string()).collect()
}

/// Linha da aba "Ausencias": matricula, inicio, fim, motivo, justificada.
type LinhaAusencia = [&'static str; 5];

/// Planilha .xlsx com a aba "Funcionarios" (cabeçalho + linhas; célula vazia não é
/// escrita) e, se houver, a aba "Ausencias" (matricula, inicio, fim, motivo, justificada).
fn salvar_xlsx(
    nome: &str,
    cabecalho: &[&str],
    linhas: &[Vec<String>],
    ausencias: &[LinhaAusencia],
) -> PathBuf {
    let mut pasta = Workbook::new();
    let aba = pasta.add_worksheet();
    aba.set_name("Funcionarios").expect("nome");
    for (c, t) in cabecalho.iter().enumerate() {
        aba.write_string(0, c as u16, *t).expect("cabeçalho");
    }
    for (l, campos) in linhas.iter().enumerate() {
        for (c, valor) in campos.iter().enumerate() {
            if !valor.is_empty() {
                aba.write_string((l + 1) as u32, c as u16, valor)
                    .expect("célula");
            }
        }
    }
    if !ausencias.is_empty() {
        let aus = pasta.add_worksheet();
        aus.set_name("Ausencias").expect("nome");
        for (c, t) in ["matricula", "inicio", "fim", "motivo", "justificada"]
            .iter()
            .enumerate()
        {
            aus.write_string(0, c as u16, *t).expect("cabeçalho");
        }
        for (l, campos) in ausencias.iter().enumerate() {
            for (c, valor) in campos.iter().enumerate() {
                if !valor.is_empty() {
                    aus.write_string((l + 1) as u32, c as u16, *valor)
                        .expect("célula");
                }
            }
        }
    }
    let caminho =
        std::env::temp_dir().join(format!("escalas_teste_{}_{nome}.xlsx", std::process::id()));
    pasta.save(&caminho).expect("salvar");
    caminho
}

const CABECALHO_PADRAO: [&str; 5] = ["matricula", "nome", "cargo", "preferencia", "carga_semanal"];

/// 12 pessoas (4 que preferem manhã, 4 tarde, 4 noite) + uma linha com preferência
/// inválida + uma ausência válida e outra de matrícula inexistente.
fn planilha(nome: &str) -> PathBuf {
    let mut linhas = Vec::new();
    for (i, preferencia) in ["Manhã", "Tarde", "Noite"].iter().enumerate() {
        for k in 0..4 {
            let m = format!("{}{:02}", i + 1, k);
            linhas.push(linha(&[
                &m,
                &format!("Pessoa {m}"),
                "Vendedor",
                preferencia,
                "",
            ]));
        }
    }
    linhas.push(linha(&["999", "Preferência Inválida", "", "Madrugada", ""]));
    salvar_xlsx(
        nome,
        &CABECALHO_PADRAO,
        &linhas,
        &[
            ["100", "09/03/2026", "13/03/2026", "Férias", ""],
            ["777", "01/03/2026", "", "", ""],
        ],
    )
}

/// Planilha de uma loja: matrículas L01, L02... e a preferência de cada pessoa
/// ("" = sem preferência).
fn loja(nome: &str, preferencias: &[&str], ausencias: &[LinhaAusencia]) -> PathBuf {
    let linhas: Vec<Vec<String>> = preferencias
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let m = format!("L{:02}", i + 1);
            linha(&[&m, &format!("Pessoa {m}"), "Vendedor", p, ""])
        })
        .collect();
    salvar_xlsx(nome, &CABECALHO_PADRAO, &linhas, ausencias)
}

/// Cria o cliente (funcionamento padrão) e importa a loja; devolve o id e os
/// funcionários em ordem de matrícula (L01, L02...).
fn cliente_com_loja(
    s: &mut Servico,
    nome: &str,
    preferencias: &[&str],
    ausencias: &[LinhaAusencia],
) -> (i64, Vec<FuncionarioDto>) {
    let c = s.criar_cliente(nome).expect("cliente");
    let arquivo = loja(&c.nome.replace(' ', "_"), preferencias, ausencias);
    let rel = s
        .importar_planilha(c.id, &arquivo, false)
        .expect("importação");
    let _ = std::fs::remove_file(arquivo);
    assert_eq!(rel.importados.len(), preferencias.len());
    assert!(rel.rejeitados.is_empty(), "{:?}", rel.rejeitados);
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    (c.id, funcs)
}

fn preferencias_de(funcs: &[FuncionarioDto]) -> BTreeMap<String, Option<String>> {
    funcs
        .iter()
        .map(|f| (f.matricula.clone(), f.preferencia.clone()))
        .collect()
}

// ---------------------------------------------------------------------- análise da agenda

/// Turnos em que cada pessoa trabalhou no mês.
fn turnos_por_pessoa(agenda: &AgendaMesDto) -> BTreeMap<i64, BTreeSet<i64>> {
    let mut m: BTreeMap<i64, BTreeSet<i64>> = BTreeMap::new();
    for a in &agenda.alocacoes {
        m.entry(a.funcionario_id).or_default().insert(a.turno_id);
    }
    m
}

/// Quantas pessoas ficam em cada turno (cada uma conta no turno onde mais trabalhou).
fn equipe_por_turno(agenda: &AgendaMesDto) -> BTreeMap<i64, usize> {
    let mut m: BTreeMap<i64, usize> = BTreeMap::new();
    for turnos in turnos_por_pessoa(agenda).values() {
        for t in turnos {
            *m.entry(*t).or_default() += 1;
        }
    }
    m
}

fn equipe_do_dia(agenda: &AgendaMesDto, dia: NaiveDate, turno: i64) -> usize {
    agenda
        .alocacoes
        .iter()
        .filter(|a| a.data == dia && a.turno_id == turno)
        .count()
}

/// Quem trabalha em que turno e dia, sem os ids das alocações (que mudam ao reinserir).
fn quadro(agenda: &AgendaMesDto) -> Vec<(i64, i64, NaiveDate, String, String)> {
    agenda
        .alocacoes
        .iter()
        .map(|a| {
            (
                a.funcionario_id,
                a.turno_id,
                a.data,
                a.inicio.clone(),
                a.fim.clone(),
            )
        })
        .collect()
}

fn violacoes(agenda: &AgendaMesDto) -> Vec<&str> {
    agenda
        .avisos
        .iter()
        .filter(|a| a.tipo == "violacaoRegra")
        .map(|a| a.mensagem.as_str())
        .collect()
}

fn dias_trabalhados_na_semana(agenda: &AgendaMesDto, funcionario: i64, inicio: NaiveDate) -> usize {
    agenda
        .alocacoes
        .iter()
        .filter(|a| {
            a.funcionario_id == funcionario
                && inicio <= a.data
                && a.data <= inicio + chrono::Days::new(6)
        })
        .count()
}

fn turnos_ativos(s: &Servico, cliente: i64) -> Vec<TurnoDto> {
    s.obter_configuracao(cliente).expect("cfg").turnos
}

fn dia_aberto(dia: u8, abre: &str, fecha: &str) -> DiaFuncionamentoDto {
    DiaFuncionamentoDto {
        dia,
        aberto: true,
        abre: abre.into(),
        fecha: fecha.into(),
    }
}

fn dia_fechado(dia: u8) -> DiaFuncionamentoDto {
    DiaFuncionamentoDto {
        dia,
        aberto: false,
        abre: "10:00".into(),
        fecha: "22:00".into(),
    }
}

fn funcionamento_dto(
    dias: Vec<DiaFuncionamentoDto>,
    jornada_horas: f64,
    intervalo_min: u32,
) -> FuncionamentoEntradaDto {
    FuncionamentoEntradaDto {
        dias,
        jornada_horas,
        intervalo_min,
    }
}

/// Segunda a sexta com o mesmo horário, sábado com o dele e domingo fechado.
fn semana_sem_domingo(
    abre: &str,
    fecha: &str,
    sabado: (&str, &str),
    jornada_horas: f64,
    intervalo_min: u32,
) -> FuncionamentoEntradaDto {
    let mut dias: Vec<DiaFuncionamentoDto> = (0..5).map(|d| dia_aberto(d, abre, fecha)).collect();
    dias.push(dia_aberto(5, sabado.0, sabado.1));
    dias.push(dia_fechado(6));
    funcionamento_dto(dias, jornada_horas, intervalo_min)
}

/// Dia do Quadro com o turno dado.
fn turno_do_dia(turno: i64) -> DiaQuadroDto {
    DiaQuadroDto {
        tipo: "turno".into(),
        turno_id: Some(turno),
        justificada: None,
        motivo: None,
    }
}

fn folga_do_dia() -> DiaQuadroDto {
    DiaQuadroDto {
        tipo: "folga".into(),
        turno_id: None,
        justificada: None,
        motivo: None,
    }
}

/// Falta (`justificada = false`) ou ausência justificada no dia.
fn ausencia_do_dia(justificada: bool, motivo: Option<&str>) -> DiaQuadroDto {
    DiaQuadroDto {
        tipo: "ausencia".into(),
        turno_id: None,
        justificada: Some(justificada),
        motivo: motivo.map(str::to_string),
    }
}

fn entrada_do_turno(t: &TurnoDto, dias_semana: Vec<u8>) -> TurnoEntradaDto {
    TurnoEntradaDto {
        id: Some(t.id),
        nome: t.nome.clone(),
        inicio: t.inicio.clone(),
        fim: t.fim.clone(),
        intervalo_min: t.intervalo_min,
        efetivo_minimo: t.efetivo_minimo,
        ordem: t.ordem,
        cor: t.cor.clone(),
        dias_semana,
    }
}

// ---------------------------------------------------------------------- cliente novo

#[test]
fn cliente_novo_tem_o_funcionamento_padrao_e_dois_turnos_gerados() {
    let mut s = servico();
    let c = s.criar_cliente("Loja do Shopping").expect("cliente");
    let cfg = s.obter_configuracao(c.id).expect("cfg");

    // Jornada de 6h com 15 min: abre com a Manhã e fecha com a Tarde, que se sobrepõem.
    assert_eq!(cfg.turnos.len(), 2);
    let (manha, tarde) = (&cfg.turnos[0], &cfg.turnos[1]);
    assert_eq!(
        (
            manha.nome.as_str(),
            manha.inicio.as_str(),
            manha.fim.as_str()
        ),
        ("Manhã", "10:00", "16:15")
    );
    assert_eq!(
        (
            tarde.nome.as_str(),
            tarde.inicio.as_str(),
            tarde.fim.as_str()
        ),
        ("Tarde", "15:45", "22:00")
    );
    for t in &cfg.turnos {
        assert_eq!(t.intervalo_min, 15);
        assert_eq!(t.minutos_trabalhados, 6 * 60);
        assert_eq!(t.efetivo_minimo, 1);
        assert_eq!(t.dias_semana, vec![0, 1, 2, 3, 4, 5, 6]);
        assert!(!t.arquivado);
    }
    assert_eq!(
        (manha.periodo.as_str(), tarde.periodo.as_str()),
        ("manha", "tarde")
    );
    assert_ne!(manha.cor, tarde.cor);
    assert!(cfg
        .turnos
        .iter()
        .all(|t| t.cor.len() == 7 && t.cor.starts_with('#')));
    assert!(manha.ordem < tarde.ordem);

    // Funcionamento: os 7 dias abertos das 10h às 22h.
    assert_eq!(cfg.funcionamento.len(), 7);
    for (i, d) in cfg.funcionamento.iter().enumerate() {
        assert_eq!(usize::from(d.dia), i);
        assert!(d.aberto);
        assert_eq!((d.abre.as_str(), d.fecha.as_str()), ("10:00", "22:00"));
    }
    assert_eq!(cfg.regras.jornada_padrao_horas, 6.0);
    assert_eq!(cfg.regras.intervalo_padrao_min, 15);
    assert_eq!(cfg.regras.regime, "ec141");
}

// ---------------------------------------------------------------------- fluxo principal

#[test]
fn fluxo_cliente_importacao_geracao_agenda() {
    let mut s = servico();
    let cliente = s.criar_cliente("  Hospital Central ").expect("cliente");
    assert_eq!(cliente.nome, "Hospital Central");
    assert!(matches!(
        s.criar_cliente("hospital central"),
        Err(ErroApp::Banco(_))
    ));

    let cfg = s.obter_configuracao(cliente.id).expect("cfg");
    // Teto da empresa na CLT anterior; o regime da EC 141 reduz para 42h e 40h nas datas da lei.
    assert_eq!(cfg.regras.carga_semanal_max_horas, 44.0);
    assert_eq!(cfg.regras.regime, "ec141");
    assert_eq!(
        cfg.turnos
            .iter()
            .map(|t| t.nome.as_str())
            .collect::<Vec<_>>(),
        vec!["Manhã", "Tarde"]
    );
    assert!(
        cfg.turnos
            .iter()
            .all(|t| t.dias_semana == vec![0, 1, 2, 3, 4, 5, 6]),
        "turnos padrão funcionam todos os dias"
    );

    // Importação: simulação não grava; importação real grava.
    let arquivo = planilha("fluxo");
    let sim = s
        .importar_planilha(cliente.id, &arquivo, true)
        .expect("simulação");
    assert!(sim.simulacao);
    assert_eq!(sim.formato, "padrao");
    assert_eq!(sim.importados.len(), 12);
    assert!(s.listar_funcionarios(cliente.id).expect("lista").is_empty());
    let rel = s
        .importar_planilha(cliente.id, &arquivo, false)
        .expect("importação");
    assert_eq!(rel.total_linhas, 13);
    assert_eq!(rel.importados.len(), 12);
    assert!(rel.importados.iter().all(|l| l.acao == "criado"));
    assert_eq!(rel.ausencias_importadas, 1);
    assert_eq!(rel.rejeitados.len(), 2, "{:?}", rel.rejeitados);
    assert!(rel
        .rejeitados
        .iter()
        .any(|r| r.erros.iter().any(|e| e.contains("Madrugada"))));
    assert!(rel
        .rejeitados
        .iter()
        .any(|r| r.planilha == "Ausencias" && r.erros[0].contains("777")));
    assert_eq!(
        s.obter_configuracao(cliente.id).expect("cfg").turnos,
        cfg.turnos,
        "importar não mexe nos turnos"
    );
    let funcs = s.listar_funcionarios(cliente.id).expect("lista");
    assert_eq!(funcs.len(), 12);
    let ausencias_100 = &funcs
        .iter()
        .find(|f| f.matricula == "100")
        .expect("100")
        .ausencias;
    assert_eq!(ausencias_100.len(), 1);
    assert!(
        ausencias_100[0].justificada,
        "coluna justificada ausente na planilha = justificada"
    );
    let por_preferencia = |p: &str| {
        funcs
            .iter()
            .filter(|f| f.preferencia.as_deref() == Some(p))
            .count()
    };
    assert_eq!(
        (
            por_preferencia("manha"),
            por_preferencia("tarde"),
            por_preferencia("noite")
        ),
        (4, 4, 4)
    );

    // Reimportar atualiza em vez de duplicar.
    let rel = s
        .importar_planilha(cliente.id, &arquivo, false)
        .expect("reimportação");
    assert!(rel.importados.iter().all(|l| l.acao == "atualizado"));
    assert_eq!(s.listar_funcionarios(cliente.id).expect("lista").len(), 12);

    // Geração de dois meses seguidos: a semana 23/02–01/03 soma os dois lados.
    s.gerar_mes(cliente.id, 2026, 2).expect("fevereiro");
    let marco = s.gerar_mes(cliente.id, 2026, 3).expect("março");
    assert!(marco.total_alocacoes > 0);
    let meses = s.listar_meses(cliente.id).expect("meses");
    assert_eq!(
        meses.iter().map(|m| (m.ano, m.mes)).collect::<Vec<_>>(),
        vec![(2026, 2), (2026, 3)]
    );

    let agenda = s.obter_agenda(cliente.id, 2026, 3).expect("agenda");
    assert!(agenda.gerado_em.is_some());
    assert_eq!(
        agenda.semanas.first().expect("semana").inicio.to_string(),
        "2026-02-23"
    );
    for sem in &agenda.semanas {
        for f in &sem.funcionarios {
            assert!(
                f.minutos <= f.limite_min,
                "{} min > {} na semana {}",
                f.minutos,
                f.limite_min,
                sem.inicio
            );
        }
    }
    // A semana da virada fevereiro/março (já gerada dos dois lados) fecha na carga cheia:
    // 44h de teto com jornadas de 6h e 1 folga = 6 dias, 36h.
    assert!(!agenda.semanas[0].pendente);
    assert!(agenda.semanas[0]
        .funcionarios
        .iter()
        .all(|f| f.minutos == 36 * 60 && f.previsto_min == 36 * 60));
    // Férias respeitadas.
    let ana = funcs.iter().find(|f| f.matricula == "100").expect("100").id;
    assert!(!agenda.alocacoes.iter().any(|a| a.funcionario_id == ana
        && data(2026, 3, 9) <= a.data
        && a.data <= data(2026, 3, 13)));
    assert_eq!(agenda.ausencias.len(), 1);
    assert_eq!(agenda.ausencias[0].funcionario_id, ana);
    assert_eq!(agenda.ausencias[0].motivo.as_deref(), Some("Férias"));
    // Todos os funcionários entram na escala e cada um fica num turno só.
    assert_eq!(agenda.funcionarios.len(), 12);
    let por_pessoa = turnos_por_pessoa(&agenda);
    assert_eq!(por_pessoa.len(), 12);
    assert!(
        por_pessoa.values().all(|t| t.len() == 1),
        "ninguém troca de turno no mês: {por_pessoa:?}"
    );
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));

    // Reduzir o limite após gerar: a agenda aponta violações até regenerar.
    let mut regras = cfg.regras.clone();
    regras.carga_semanal_max_horas = 32.0;
    s.salvar_regras(cliente.id, &regras).expect("regras");
    let agenda = s.obter_agenda(cliente.id, 2026, 3).expect("agenda");
    assert!(agenda.avisos.iter().any(|a| a.tipo == "violacaoRegra"));
    s.gerar_mes(cliente.id, 2026, 3).expect("regenerar");
    let agenda = s.obter_agenda(cliente.id, 2026, 3).expect("agenda");
    // Semanas totalmente em março ficam dentro de 32h; a da virada ainda carrega fevereiro (36h).
    for sem in agenda.semanas.iter().skip(1) {
        for f in &sem.funcionarios {
            assert!(f.minutos <= 32 * 60);
        }
    }

    // Turno usado em escala não pode ser excluído; mês excluído libera.
    let manha = cfg.turnos[0].id;
    assert!(s.excluir_turno(cliente.id, manha).is_err());
    s.excluir_mes(cliente.id, 2026, 3).expect("excluir março");
    s.excluir_mes(cliente.id, 2026, 2)
        .expect("excluir fevereiro");
    s.excluir_turno(cliente.id, manha).expect("excluir turno");
    assert!(s.listar_meses(cliente.id).expect("meses").is_empty());

    s.excluir_cliente(cliente.id).expect("excluir cliente");
    assert!(s.listar_clientes().expect("clientes").is_empty());
    let _ = std::fs::remove_file(arquivo);
}

// ---------------------------------------------------------------------- distribuição da equipe

#[test]
fn loja_de_shopping_divide_a_equipe_entre_abertura_e_fechamento() {
    let mut s = servico();
    // 10 pessoas: 4 preferem a manhã, 4 a tarde e 2 não têm preferência.
    let mut prefs = vec!["Manhã"; 4];
    prefs.extend(["Tarde"; 4]);
    prefs.extend(["", ""]);
    let (c, funcs) = cliente_com_loja(&mut s, "Loja Shopping", &prefs, &[]);
    let turnos = turnos_ativos(&s, c);
    let (manha, tarde) = (turnos[0].id, turnos[1].id);

    // Fevereiro/2027 tem 4 semanas completas (segunda a domingo), já na regra de 42h e 2 folgas.
    let r = s.gerar_mes(c, 2027, 2).expect("fevereiro");
    assert!(
        r.avisos.iter().all(|a| a.tipo != "coberturaInsuficiente"),
        "{:?}",
        r.avisos
    );
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    assert!(agenda.regra.contains("42h e 2 folgas"), "{}", agenda.regra);
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));

    // Cada pessoa fica num turno só o mês todo, e a equipe se divide 5 para 5.
    let por_pessoa = turnos_por_pessoa(&agenda);
    assert_eq!(por_pessoa.len(), 10);
    assert!(por_pessoa.values().all(|t| t.len() == 1), "{por_pessoa:?}");
    let equipe = equipe_por_turno(&agenda);
    assert_eq!(equipe.get(&manha), Some(&5), "{equipe:?}");
    assert_eq!(equipe.get(&tarde), Some(&5), "{equipe:?}");

    // A preferência é atendida: sobra vaga nos dois turnos para quem tem preferência.
    for f in &funcs {
        let alvo = match f.preferencia.as_deref() {
            Some("manha") => Some(manha),
            Some("tarde") => Some(tarde),
            _ => None,
        };
        if let Some(alvo) = alvo {
            assert!(
                por_pessoa[&f.id].contains(&alvo),
                "{} ({:?}) fora do turno preferido",
                f.nome,
                f.preferencia
            );
        }
    }

    // Todo dia os dois turnos têm gente: 5 pessoas por turno trabalhando 5 dias em 7.
    for dia in dias_do_mes(2027, 2) {
        for t in [manha, tarde] {
            let n = equipe_do_dia(&agenda, dia, t);
            assert!(n >= 3, "{dia}: só {n} pessoa(s) no turno {t}");
        }
    }

    // Semanas fechadas: 5x2 com jornadas de 6h, as horas previstas, sem sobra nem falta.
    assert_eq!(agenda.semanas.len(), 4);
    for sem in &agenda.semanas {
        assert!(!sem.pendente);
        for f in &sem.funcionarios {
            assert_eq!(f.limite_min, 42 * 60);
            assert_eq!(f.previsto_min, 30 * 60);
            assert_eq!(f.minutos, 30 * 60, "semana {}", sem.inicio);
            assert_eq!(
                dias_trabalhados_na_semana(&agenda, f.funcionario_id, sem.inicio),
                5
            );
        }
    }

    // No mês seguinte cada um continua no turno em que estava (a faixa é mantida).
    s.gerar_mes(c, 2027, 3).expect("março");
    let marco = s.obter_agenda(c, 2027, 3).expect("agenda");
    assert!(violacoes(&marco).is_empty(), "{:?}", violacoes(&marco));
    assert_eq!(turnos_por_pessoa(&marco), por_pessoa);
}

#[test]
fn preferencia_e_atendida_enquanto_houver_vaga_no_turno() {
    let mut s = servico();
    // 7 preferem a manhã, mas só cabem 5: 2 vão para a tarde, onde há as 3 de tarde.
    let mut prefs = vec!["Manhã"; 7];
    prefs.extend(["Tarde"; 3]);
    let (c, funcs) = cliente_com_loja(&mut s, "Loja Manhã Cheia", &prefs, &[]);
    let turnos = turnos_ativos(&s, c);
    let (manha, tarde) = (turnos[0].id, turnos[1].id);

    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
    let por_pessoa = turnos_por_pessoa(&agenda);
    assert!(por_pessoa.values().all(|t| t.len() == 1), "{por_pessoa:?}");
    let equipe = equipe_por_turno(&agenda);
    assert_eq!(
        (equipe.get(&manha), equipe.get(&tarde)),
        (Some(&5), Some(&5))
    );

    let turno_de = |f: &FuncionarioDto| *por_pessoa[&f.id].iter().next().expect("turno");
    // Quem preferiu a tarde fica na tarde; entre os que preferiram a manhã só 5 abrem a loja.
    assert!(funcs
        .iter()
        .filter(|f| f.preferencia.as_deref() == Some("tarde"))
        .all(|f| turno_de(f) == tarde));
    let manha_preferida: Vec<&FuncionarioDto> = funcs
        .iter()
        .filter(|f| f.preferencia.as_deref() == Some("manha"))
        .collect();
    assert_eq!(manha_preferida.len(), 7);
    assert_eq!(
        manha_preferida
            .iter()
            .filter(|f| turno_de(f) == manha)
            .count(),
        5
    );
    assert_eq!(
        manha_preferida
            .iter()
            .filter(|f| turno_de(f) == tarde)
            .count(),
        2
    );
    for dia in dias_do_mes(2027, 2) {
        for t in [manha, tarde] {
            assert!(equipe_do_dia(&agenda, dia, t) >= 3, "{dia} turno {t}");
        }
    }
}

#[test]
fn preferencia_de_noite_vai_para_o_turno_mais_proximo_do_fim_do_dia() {
    let mut s = servico();
    let mut prefs = vec!["Noite"; 5];
    prefs.extend(["", "", "", "", ""]);
    let (c, funcs) = cliente_com_loja(&mut s, "Loja Noite", &prefs, &[]);
    let turnos = turnos_ativos(&s, c);
    let (manha, tarde) = (turnos[0].id, turnos[1].id);

    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
    let por_pessoa = turnos_por_pessoa(&agenda);
    let equipe = equipe_por_turno(&agenda);
    assert_eq!(
        (equipe.get(&manha), equipe.get(&tarde)),
        (Some(&5), Some(&5))
    );
    // Quem prefere a noite fecha a loja (turno da tarde, que termina às 22h).
    assert!(funcs
        .iter()
        .filter(|f| f.preferencia.as_deref() == Some("noite"))
        .all(|f| por_pessoa[&f.id] == BTreeSet::from([tarde])));
}

// ---------------------------------------------------------------------- funcionamento

#[test]
fn domingo_fechado_e_sabado_diferente_regeram_os_turnos_e_arquivam_os_usados() {
    let mut s = servico();
    let (c, _) = cliente_com_loja(&mut s, "Loja Horário Novo", &["Manhã"; 4], &[]);
    let (c2, _) = cliente_com_loja(&mut s, "Outra Loja", &["Tarde"; 2], &[]);
    let antes = turnos_ativos(&s, c);
    let (manha_antiga, tarde_antiga) = (antes[0].clone(), antes[1].clone());
    // O efetivo mínimo e a cor da Manhã (editados pelo usuário) devem sobreviver.
    s.salvar_turno(
        c,
        &TurnoEntradaDto {
            efetivo_minimo: 2,
            cor: "#123abc".into(),
            ..entrada_do_turno(&manha_antiga, vec![0, 1, 2, 3, 4, 5, 6])
        },
    )
    .expect("editar manhã");

    let r = s.gerar_mes(c, 2026, 3).expect("março");
    assert!(r.total_alocacoes > 0);
    let marco_antes = s.obter_agenda(c, 2026, 3).expect("agenda");
    let alocacoes_antes = marco_antes.alocacoes.clone();
    assert!(
        alocacoes_antes
            .iter()
            .any(|a| a.turno_id == tarde_antiga.id),
        "a Tarde antiga está em uso"
    );

    // Segunda a sexta passam a abrir às 9h e fechar às 21h; sábado só 10h–18h; domingo fecha.
    let cfg = s
        .salvar_funcionamento(
            c,
            &semana_sem_domingo("09:00", "21:00", ("10:00", "18:00"), 6.0, 15),
        )
        .expect("funcionamento");
    assert_eq!(cfg.funcionamento.len(), 7);
    let seg = &cfg.funcionamento[0];
    assert_eq!(
        (seg.aberto, seg.abre.as_str(), seg.fecha.as_str()),
        (true, "09:00", "21:00")
    );
    let sab = &cfg.funcionamento[5];
    assert_eq!(
        (sab.aberto, sab.abre.as_str(), sab.fecha.as_str()),
        (true, "10:00", "18:00")
    );
    assert!(!cfg.funcionamento[6].aberto, "domingo fechado");
    assert_eq!(
        (
            cfg.regras.jornada_padrao_horas,
            cfg.regras.intervalo_padrao_min
        ),
        (6.0, 15)
    );

    // Turnos regerados: 09:00–15:15 e 14:45–21:00 de seg a sex; sáb 10:00–16:15 e 11:45–18:00.
    let nomes: Vec<(&str, &str, &str, Vec<u8>)> = cfg
        .turnos
        .iter()
        .map(|t| {
            (
                t.nome.as_str(),
                t.inicio.as_str(),
                t.fim.as_str(),
                t.dias_semana.clone(),
            )
        })
        .collect();
    assert_eq!(
        nomes,
        vec![
            ("Manhã 09:00", "09:00", "15:15", vec![0, 1, 2, 3, 4]),
            ("Manhã 10:00", "10:00", "16:15", vec![5]),
            ("Manhã 11:45", "11:45", "18:00", vec![5]),
            ("Tarde", "14:45", "21:00", vec![0, 1, 2, 3, 4]),
        ]
    );
    assert!(cfg
        .turnos
        .iter()
        .all(|t| !t.arquivado && t.intervalo_min == 15));
    let cores: BTreeSet<&str> = cfg.turnos.iter().map(|t| t.cor.as_str()).collect();
    assert_eq!(cores.len(), 4, "cores distintas");
    // O turno de mesmo horário (10:00–16:15) é o mesmo registro e mantém efetivo e cor.
    let mantida = cfg
        .turnos
        .iter()
        .find(|t| t.id == manha_antiga.id)
        .expect("manhã de 10:00 continua");
    assert_eq!(
        (mantida.inicio.as_str(), mantida.dias_semana.clone()),
        ("10:00", vec![5])
    );
    assert_eq!(
        (mantida.efetivo_minimo, mantida.cor.as_str()),
        (2, "#123ABC")
    );
    assert!(
        cfg.turnos.iter().all(|t| t.id != tarde_antiga.id),
        "a Tarde antiga saiu das Configurações"
    );

    // O mês gerado antes continua na agenda, com a Tarde antiga arquivada e identificada.
    let marco = s.obter_agenda(c, 2026, 3).expect("agenda");
    assert_eq!(
        marco.alocacoes, alocacoes_antes,
        "a escala já gerada não muda"
    );
    let arquivada = marco
        .turnos
        .iter()
        .find(|t| t.id == tarde_antiga.id)
        .expect("a agenda lista o turno arquivado em uso");
    assert!(arquivada.arquivado);
    assert_eq!(arquivada.nome, "Tarde (antigo 15:45)");
    assert_eq!(
        (arquivada.inicio.as_str(), arquivada.fim.as_str()),
        ("15:45", "22:00")
    );
    assert_eq!(arquivada.periodo, "tarde");
    assert_eq!(marco.turnos.iter().filter(|t| t.arquivado).count(), 1);
    assert_eq!(marco.turnos.len(), 5, "4 em uso + 1 arquivado");
    // A Manhã de 10:00 agora só funciona aos sábados: as alocações antigas aparecem como violação.
    assert!(
        violacoes(&marco)
            .iter()
            .any(|m| m.contains("no turno Manhã 10:00, que não funciona nesse dia")),
        "{:?}",
        violacoes(&marco)
    );
    // Mês nunca gerado: só os turnos em uso, nenhum arquivado.
    let abril = s.obter_agenda(c, 2026, 4).expect("abril");
    assert!(abril.gerado_em.is_none());
    assert_eq!(abril.turnos.len(), 4);
    assert!(abril.turnos.iter().all(|t| !t.arquivado));

    // Não se escala ninguém num turno arquivado.
    let pessoa = marco.funcionarios[0].id;
    let erro = s
        .definir_dia(c, pessoa, data(2026, 3, 20), &turno_do_dia(tarde_antiga.id))
        .expect_err("turno arquivado");
    assert!(erro.to_string().contains("turno"), "{erro}");
    // Os outros clientes não foram afetados.
    assert_eq!(turnos_ativos(&s, c2).len(), 2);

    // Regerar o mês passa a usar só turnos em uso: nada aos domingos, e o arquivado some da agenda.
    s.gerar_mes(c, 2026, 3).expect("regerar");
    let novo = s.obter_agenda(c, 2026, 3).expect("agenda");
    assert!(violacoes(&novo).is_empty(), "{:?}", violacoes(&novo));
    assert!(novo.turnos.iter().all(|t| !t.arquivado));
    assert!(novo.alocacoes.iter().all(|a| a.turno_id != tarde_antiga.id));
    assert!(!novo.alocacoes.is_empty());
    assert!(novo
        .alocacoes
        .iter()
        .all(|a| a.data.weekday() != Weekday::Sun));
    let ativos: BTreeSet<i64> = turnos_ativos(&s, c).iter().map(|t| t.id).collect();
    assert!(novo.alocacoes.iter().all(|a| ativos.contains(&a.turno_id)));
    // Sábado só tem os turnos de sábado; a "Tarde" (seg–sex) nunca aparece nele.
    let tarde_nova = cfg
        .turnos
        .iter()
        .find(|t| t.nome == "Tarde")
        .expect("tarde")
        .id;
    assert!(novo
        .alocacoes
        .iter()
        .filter(|a| a.data.weekday() == Weekday::Sat)
        .all(|a| a.turno_id != tarde_nova));

    // Salvar de novo o mesmo funcionamento não muda nada e leva embora o arquivado sem uso.
    let de_novo = s
        .salvar_funcionamento(
            c,
            &semana_sem_domingo("09:00", "21:00", ("10:00", "18:00"), 6.0, 15),
        )
        .expect("de novo");
    assert_eq!(de_novo.turnos, cfg.turnos);
    let erro = s
        .excluir_turno(c, tarde_antiga.id)
        .expect_err("já foi excluído ao salvar");
    assert!(erro.to_string().contains("não encontrado"), "{erro}");
}

/// Sábado que fecha às 16h gera um turno 10:00–16:00 ao lado do 10:00–16:15 da semana:
/// os dois começam às 10:00 e recebem o mesmo nome.
#[test]
fn sabado_que_fecha_cedo_nao_gera_turnos_com_o_mesmo_nome() {
    let mut s = servico();
    let c = s.criar_cliente("Loja Sábado Curto").expect("cliente");
    let antes = s.obter_configuracao(c.id).expect("cfg");
    let cfg = s
        .salvar_funcionamento(
            c.id,
            &semana_sem_domingo("10:00", "22:00", ("10:00", "16:00"), 6.0, 15),
        )
        .expect("funcionamento com sábado de 10h às 16h");
    let nomes: BTreeSet<&str> = cfg.turnos.iter().map(|t| t.nome.as_str()).collect();
    assert_eq!(
        nomes.len(),
        cfg.turnos.len(),
        "nomes únicos: {:?}",
        cfg.turnos
    );
    assert_eq!(cfg.turnos.len(), 3);
    assert_ne!(cfg, antes);
}

#[test]
fn funcionamento_recusa_dados_invalidos_sem_alterar_nada() {
    let mut s = servico();
    let c = s.criar_cliente("Loja Validações").expect("cliente");
    let original = s.obter_configuracao(c.id).expect("cfg");
    let erro = |dto: FuncionamentoEntradaDto, s: &mut Servico| {
        s.salvar_funcionamento(c.id, &dto)
            .err()
            .map(|e| e.to_string())
            .unwrap_or_default()
    };
    let todos = |abre: &str, fecha: &str| -> Vec<DiaFuncionamentoDto> {
        (0..7).map(|d| dia_aberto(d, abre, fecha)).collect()
    };

    // Jornada acima do máximo diário das regras (8h) e fora dos limites do motor.
    let e = erro(funcionamento_dto(todos("10:00", "22:00"), 9.0, 60), &mut s);
    assert!(e.contains("jornada diária máxima"), "{e}");
    let e = erro(funcionamento_dto(todos("10:00", "22:00"), 0.5, 0), &mut s);
    assert!(e.contains("jornada deve ficar entre 1h e 12h"), "{e}");
    assert!(erro(
        funcionamento_dto(todos("10:00", "22:00"), f64::NAN, 15),
        &mut s
    )
    .contains("jornada"));
    assert!(erro(funcionamento_dto(todos("10:00", "22:00"), -1.0, 15), &mut s).contains("jornada"));
    let e = erro(funcionamento_dto(todos("10:00", "22:00"), 6.0, 121), &mut s);
    assert!(e.contains("intervalo"), "{e}");
    // Nenhum dia aberto, horário inválido, abre = fecha e dia fora da semana.
    let fechados: Vec<DiaFuncionamentoDto> = (0..7).map(dia_fechado).collect();
    let e = erro(funcionamento_dto(fechados, 6.0, 15), &mut s);
    assert!(e.contains("ao menos um dia"), "{e}");
    let e = erro(funcionamento_dto(todos("25:00", "22:00"), 6.0, 15), &mut s);
    assert!(e.contains("abertura"), "{e}");
    let e = erro(
        funcionamento_dto(todos("10:00", "pôr do sol"), 6.0, 15),
        &mut s,
    );
    assert!(e.contains("fechamento"), "{e}");
    let mut com_dia_8 = todos("10:00", "22:00");
    com_dia_8.push(dia_aberto(7, "10:00", "22:00"));
    let e = erro(funcionamento_dto(com_dia_8, 6.0, 15), &mut s);
    assert!(e.contains("dia 7 inválido"), "{e}");
    assert!(s
        .salvar_funcionamento(9999, &funcionamento_dto(todos("10:00", "22:00"), 6.0, 15))
        .is_err());

    assert_eq!(
        s.obter_configuracao(c.id).expect("cfg"),
        original,
        "nada foi gravado pelas tentativas recusadas"
    );

    // Dia repetido vale o primeiro; dia fechado ignora o horário informado; jornada de 4h
    // sem intervalo cabe numa janela curta (um turno só do abre ao fecha).
    let mut dias = vec![
        dia_aberto(0, "08:00", "12:00"),
        dia_aberto(0, "10:00", "22:00"),
    ];
    dias.push(dia_fechado(1));
    let cfg = s
        .salvar_funcionamento(c.id, &funcionamento_dto(dias, 4.0, 0))
        .expect("funcionamento curto");
    assert!(cfg.funcionamento[0].aberto);
    assert_eq!(
        (
            cfg.funcionamento[0].abre.as_str(),
            cfg.funcionamento[0].fecha.as_str()
        ),
        ("08:00", "12:00")
    );
    assert!(
        cfg.funcionamento[1..].iter().all(|d| !d.aberto),
        "dias não informados ficam fechados"
    );
    assert_eq!(cfg.turnos.len(), 1);
    assert_eq!(
        (
            cfg.turnos[0].inicio.as_str(),
            cfg.turnos[0].fim.as_str(),
            cfg.turnos[0].intervalo_min
        ),
        ("08:00", "12:00", 0)
    );
    assert_eq!(
        (
            cfg.regras.jornada_padrao_horas,
            cfg.regras.intervalo_padrao_min
        ),
        (4.0, 0)
    );
}

#[test]
fn abertura_igual_ao_fechamento_e_um_dia_de_24_horas() {
    let mut s = servico();
    let (c, _) = cliente_com_loja(
        &mut s,
        "Posto 24h",
        &["", "", "", "", "", "", "", "", ""],
        &[],
    );
    let dias: Vec<DiaFuncionamentoDto> = (0..7).map(|d| dia_aberto(d, "06:00", "06:00")).collect();
    let cfg = s
        .salvar_funcionamento(c, &funcionamento_dto(dias, 6.0, 15))
        .expect("24h não é erro");
    assert!(cfg
        .funcionamento
        .iter()
        .all(|d| d.aberto && d.abre == "06:00" && d.fecha == "06:00"));
    // 24h cobertas por turnos de 6h15, do que abre ao que fecha às 06:00.
    let turnos: Vec<(&str, &str, &str, &str)> = cfg
        .turnos
        .iter()
        .map(|t| {
            (
                t.nome.as_str(),
                t.inicio.as_str(),
                t.fim.as_str(),
                t.periodo.as_str(),
            )
        })
        .collect();
    assert_eq!(
        turnos,
        vec![
            ("Manhã", "06:00", "12:15", "manha"),
            ("Tarde 12:00", "12:00", "18:15", "tarde"),
            ("Tarde 17:45", "17:45", "00:00", "tarde"),
            ("Noite", "23:45", "06:00", "noite"),
        ]
    );

    // A escala usa os 4 turnos, todos os dias, sem violar regra.
    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
    assert_eq!(equipe_por_turno(&agenda).len(), 4);
    for dia in dias_do_mes(2027, 2) {
        for t in &cfg.turnos {
            assert!(
                equipe_do_dia(&agenda, dia, t.id) >= 1,
                "{dia}: turno {} vazio",
                t.nome
            );
        }
    }
}

#[test]
fn dias_de_funcionamento_valem_na_geracao_e_viram_aviso_se_mudarem_depois() {
    let mut s = servico();
    let (c, _) = cliente_com_loja(
        &mut s,
        "Escritório",
        &["Manhã", "Tarde", "Manhã", "Tarde", "", ""],
        &[],
    );

    // Domingo fechado: os dois turnos passam a funcionar de segunda a sábado.
    let cfg = s
        .salvar_funcionamento(
            c,
            &semana_sem_domingo("10:00", "22:00", ("10:00", "22:00"), 6.0, 15),
        )
        .expect("domingo fechado");
    assert!(cfg
        .turnos
        .iter()
        .all(|t| t.dias_semana == vec![0, 1, 2, 3, 4, 5]));
    let manha = cfg
        .turnos
        .iter()
        .find(|t| t.nome == "Manhã")
        .expect("Manhã")
        .clone();

    let r = s.gerar_mes(c, 2026, 3).expect("geração");
    assert!(r.total_alocacoes > 0);
    let agenda = s.obter_agenda(c, 2026, 3).expect("agenda");
    assert!(agenda
        .alocacoes
        .iter()
        .all(|a| a.data.weekday() != Weekday::Sun));
    let da_manha: Vec<_> = agenda
        .alocacoes
        .iter()
        .filter(|a| a.turno_id == manha.id)
        .collect();
    assert!(!da_manha.is_empty());
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
    assert_eq!(
        agenda
            .turnos
            .iter()
            .find(|t| t.id == manha.id)
            .map(|t| t.dias_semana.clone()),
        Some(vec![0, 1, 2, 3, 4, 5])
    );

    // Restringir ainda mais depois de gerar não altera a escala, mas a agenda avisa.
    s.salvar_turno(c, &entrada_do_turno(&manha, vec![0, 1, 2, 3]))
        .expect("restringir");
    let agenda = s.obter_agenda(c, 2026, 3).expect("agenda");
    assert!(
        agenda.avisos.iter().any(|a| a.tipo == "violacaoRegra"
            && a.mensagem
                .contains("no turno Manhã, que não funciona nesse dia")),
        "{:?}",
        agenda.avisos
    );

    // Salvar o funcionamento outra vez devolve ao turno os dias do funcionamento.
    let cfg = s
        .salvar_funcionamento(
            c,
            &semana_sem_domingo("10:00", "22:00", ("10:00", "22:00"), 6.0, 15),
        )
        .expect("restaurar");
    assert!(cfg
        .turnos
        .iter()
        .all(|t| t.dias_semana == vec![0, 1, 2, 3, 4, 5]));
    let agenda = s.obter_agenda(c, 2026, 3).expect("agenda");
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
}

// ---------------------------------------------------------------------- ajuste manual do quadro

#[test]
fn definir_dia_ajusta_o_quadro_e_recalcula_horas_e_avisos() {
    let mut s = servico();
    // L03 está de férias de 08/02 a 12/02/2027.
    let (c, funcs) = cliente_com_loja(
        &mut s,
        "Loja Ajuste",
        &[
            "Manhã", "Manhã", "Manhã", "Manhã", "Manhã", "Tarde", "Tarde", "Tarde", "Tarde",
            "Tarde",
        ],
        &[["L03", "08/02/2027", "12/02/2027", "Férias", ""]],
    );
    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    let turnos = turnos_ativos(&s, c);
    let (manha, tarde) = (turnos[0].clone(), turnos[1].clone());
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
    // O resumo da agenda traz cargo e preferência de cada pessoa, e as férias do mês.
    let resumo = agenda
        .funcionarios
        .iter()
        .find(|f| f.matricula == "L01")
        .expect("L01");
    assert_eq!(
        (resumo.cargo.as_deref(), resumo.preferencia.as_deref()),
        (Some("Vendedor"), Some("manha"))
    );
    assert_eq!(agenda.ausencias.len(), 1);
    assert_eq!(agenda.ausencias[0].inicio, data(2027, 2, 8));

    let ana = funcs.iter().find(|f| f.matricula == "L01").expect("L01").id;
    let usual = *turnos_por_pessoa(&agenda)[&ana]
        .iter()
        .next()
        .expect("turno");
    let outro = if usual == manha.id {
        tarde.id
    } else {
        manha.id
    };
    let semana_de = |a: &AgendaMesDto, dia: NaiveDate| {
        a.semanas
            .iter()
            .find(|w| w.inicio <= dia && dia <= w.fim)
            .expect("semana")
            .funcionarios
            .iter()
            .find(|f| f.funcionario_id == ana)
            .expect("ana")
            .clone()
    };

    // Um dia de folga da Ana na 3ª semana vira dia de trabalho no outro turno.
    let folga = (15..=21)
        .map(|d| data(2027, 2, d))
        .find(|d| {
            !agenda
                .alocacoes
                .iter()
                .any(|a| a.funcionario_id == ana && a.data == *d)
        })
        .expect("a Ana folga em algum dia da semana");
    let horas = semana_de(&agenda, folga);
    assert_eq!((horas.minutos, horas.previsto_min), (30 * 60, 30 * 60));
    let depois = s
        .definir_dia(c, ana, folga, &turno_do_dia(outro))
        .expect("definir turno");
    let alocacao = depois
        .alocacoes
        .iter()
        .find(|a| a.funcionario_id == ana && a.data == folga)
        .expect("alocação nova");
    assert_eq!(alocacao.turno_id, outro);
    let horas = semana_de(&depois, folga);
    assert_eq!(horas.minutos, 36 * 60, "a semana soma o dia a mais");
    assert_eq!(horas.previsto_min, 30 * 60);
    assert_eq!(
        depois,
        s.obter_agenda(c, 2027, 2).expect("agenda"),
        "o ajuste foi gravado"
    );
    // O ajuste não é impedido, mas 6 dias de trabalho quebram as 2 folgas da semana e a agenda avisa.
    assert!(
        violacoes(&depois)
            .iter()
            .any(|m| m.contains("a regra exige 2 folga(s)")),
        "{:?}",
        violacoes(&depois)
    );

    // Voltando a ser folga, as horas e o aviso desaparecem.
    let de_volta = s
        .definir_dia(c, ana, folga, &folga_do_dia())
        .expect("folga");
    assert!(!de_volta
        .alocacoes
        .iter()
        .any(|a| a.funcionario_id == ana && a.data == folga));
    assert_eq!(semana_de(&de_volta, folga).minutos, 30 * 60);
    assert!(
        violacoes(&de_volta).is_empty(),
        "{:?}",
        violacoes(&de_volta)
    );
    assert_eq!(
        quadro(&de_volta),
        quadro(&agenda),
        "volta exatamente ao que o motor gerou"
    );

    // Tirar um dia de trabalho deixa a semana com uma jornada a menos.
    let trabalho = de_volta
        .alocacoes
        .iter()
        .find(|a| a.funcionario_id == ana && a.data >= data(2027, 2, 8))
        .expect("dia de trabalho")
        .data;
    let menos = s
        .definir_dia(c, ana, trabalho, &folga_do_dia())
        .expect("tirar");
    assert_eq!(semana_de(&menos, trabalho).minutos, 24 * 60);
    assert!(!menos
        .alocacoes
        .iter()
        .any(|a| a.funcionario_id == ana && a.data == trabalho));
    // Trocar de turno no mesmo dia substitui a alocação, sem duplicar.
    let trocado = s
        .definir_dia(c, ana, trabalho, &turno_do_dia(outro))
        .expect("trocar");
    assert_eq!(
        trocado
            .alocacoes
            .iter()
            .filter(|a| a.funcionario_id == ana && a.data == trabalho)
            .count(),
        1
    );
    let de_volta = s
        .definir_dia(c, ana, trabalho, &turno_do_dia(usual))
        .expect("de volta");
    assert_eq!(quadro(&de_volta), quadro(&agenda));

    // Os avisos de cobertura são recalculados com o efetivo mínimo atual: com 5 no mínimo
    // na Manhã, todo dia em que ela tem menos de 5 pessoas ganha um aviso, e só esses dias.
    s.salvar_turno(
        c,
        &TurnoEntradaDto {
            efetivo_minimo: 5,
            ..entrada_do_turno(&manha, manha.dias_semana.clone())
        },
    )
    .expect("efetivo 5");
    let exigente = s
        .definir_dia(c, ana, folga, &folga_do_dia())
        .expect("refazer avisos");
    let esperados: BTreeSet<NaiveDate> = dias_do_mes(2027, 2)
        .into_iter()
        .filter(|d| equipe_do_dia(&exigente, *d, manha.id) < 5)
        .collect();
    let avisados: BTreeSet<NaiveDate> = exigente
        .avisos
        .iter()
        .filter(|a| a.tipo == "coberturaInsuficiente" && a.turno_id == Some(manha.id))
        .filter_map(|a| a.data)
        .collect();
    assert!(!esperados.is_empty());
    assert_eq!(avisados, esperados);
    assert!(exigente
        .avisos
        .iter()
        .filter(|a| a.tipo == "coberturaInsuficiente")
        .all(|a| a.mensagem.contains("turno Manhã com")));
    // Voltando o mínimo para 1 e ajustando de novo, os avisos somem.
    s.salvar_turno(
        c,
        &TurnoEntradaDto {
            efetivo_minimo: 1,
            ..entrada_do_turno(&manha, manha.dias_semana.clone())
        },
    )
    .expect("efetivo 1");
    let calmo = s
        .definir_dia(c, ana, folga, &folga_do_dia())
        .expect("refazer avisos");
    assert!(
        calmo
            .avisos
            .iter()
            .all(|a| a.tipo != "coberturaInsuficiente"),
        "{:?}",
        calmo.avisos
    );
}

#[test]
fn definir_dia_recusa_mes_nao_gerado_tipo_invalido_e_dados_de_outro_cliente() {
    let mut s = servico();
    let (c, funcs) = cliente_com_loja(
        &mut s,
        "Loja Recusas",
        &["Manhã", "Manhã", "Manhã", "Tarde", "Tarde", "Tarde"],
        &[["L03", "08/02/2027", "12/02/2027", "Férias", ""]],
    );
    let (outro, funcs_de_outro) =
        cliente_com_loja(&mut s, "Loja Vizinha", &["Manhã", "Tarde"], &[]);
    let turno_de_outro = turnos_ativos(&s, outro)[0].id;
    let manha = turnos_ativos(&s, c)[0].id;
    let l01 = funcs[0].id;

    // Mês sem escala gerada, para qualquer tipo de dia.
    for dia in [
        turno_do_dia(manha),
        folga_do_dia(),
        ausencia_do_dia(false, None),
    ] {
        let erro = s
            .definir_dia(c, l01, data(2027, 2, 10), &dia)
            .expect_err("fevereiro ainda não foi gerado");
        assert!(matches!(erro, ErroApp::Validacao(_)), "{erro:?}");
        assert!(
            erro.to_string().contains("gere a escala deste mês"),
            "{erro}"
        );
    }
    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    // Gerado fevereiro, março continua sem escala.
    let erro = s
        .definir_dia(c, l01, data(2027, 3, 1), &folga_do_dia())
        .expect_err("março não gerado");
    assert!(
        erro.to_string().contains("gere a escala deste mês"),
        "{erro}"
    );
    assert!(s.listar_meses(c).expect("meses").len() == 1);

    let antes = s.obter_agenda(c, 2027, 2).expect("agenda");
    assert_eq!(antes.ausencias.len(), 1, "só as férias da L03");

    // Tipo de dia desconhecido (a comparação é exata, sem aceitar outra caixa) e turno sem id.
    for (dia, trecho) in [
        (
            DiaQuadroDto {
                tipo: "feriado".into(),
                ..folga_do_dia()
            },
            "tipo de dia \"feriado\" desconhecido",
        ),
        (
            DiaQuadroDto {
                tipo: "Folga".into(),
                ..folga_do_dia()
            },
            "desconhecido",
        ),
        (
            DiaQuadroDto {
                turno_id: None,
                ..turno_do_dia(manha)
            },
            "informe o turno do dia",
        ),
    ] {
        let erro = s
            .definir_dia(c, l01, data(2027, 2, 16), &dia)
            .expect_err("dia inválido");
        assert!(matches!(erro, ErroApp::Validacao(_)), "{erro:?}");
        assert!(erro.to_string().contains(trecho), "{erro}");
    }

    // Funcionário e turno inexistentes ou de outro cliente, e qualquer tipo de dia.
    for (funcionario, dia) in [
        (9999, turno_do_dia(manha)),
        (9999, folga_do_dia()),
        (9999, ausencia_do_dia(false, Some("Falta"))),
        (funcs_de_outro[0].id, turno_do_dia(manha)),
        (funcs_de_outro[0].id, folga_do_dia()),
        (funcs_de_outro[0].id, ausencia_do_dia(true, None)),
        (l01, turno_do_dia(9999)),
        (l01, turno_do_dia(turno_de_outro)),
    ] {
        let erro = s
            .definir_dia(c, funcionario, data(2027, 2, 16), &dia)
            .expect_err("não é do cliente");
        assert!(erro.to_string().contains("não encontrado"), "{erro}");
    }
    assert_eq!(
        s.obter_agenda(c, 2027, 2).expect("agenda"),
        antes,
        "nada mudou"
    );
    assert_eq!(
        s.obter_agenda(outro, 2027, 2)
            .expect("agenda do outro")
            .alocacoes,
        vec![]
    );
    assert!(
        s.listar_funcionarios(outro)
            .expect("lista")
            .iter()
            .all(|f| f.ausencias.is_empty()),
        "o outro cliente não ganhou ausências"
    );

    // Depois das recusas, um ajuste válido continua funcionando.
    s.definir_dia(c, l01, data(2027, 2, 16), &turno_do_dia(manha))
        .expect("turno em uso");
}

#[test]
fn definir_dia_em_ferias_divide_o_periodo_e_a_pessoa_passa_a_trabalhar() {
    let mut s = servico();
    // L03 está de férias de 08/02 a 17/02/2027 (10 dias).
    let (c, funcs) = cliente_com_loja(
        &mut s,
        "Loja Férias",
        &["Manhã", "Manhã", "Manhã", "Tarde", "Tarde", "Tarde"],
        &[["L03", "08/02/2027", "17/02/2027", "Férias", "Sim"]],
    );
    let (l01, l03) = (funcs[0].id, funcs[2].id);
    let manha = turnos_ativos(&s, c)[0].id;
    s.gerar_mes(c, 2027, 2).expect("fevereiro");

    let ferias_de = |a: &AgendaMesDto| -> Vec<(NaiveDate, NaiveDate, Option<String>, bool)> {
        a.ausencias
            .iter()
            .filter(|x| x.funcionario_id == l03)
            .map(|x| (x.inicio, x.fim, x.motivo.clone(), x.justificada))
            .collect()
    };
    let periodo = |ini: u32, fim: u32| {
        (
            data(2027, 2, ini),
            data(2027, 2, fim),
            Some("Férias".to_string()),
            true,
        )
    };
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    assert_eq!(ferias_de(&agenda), vec![periodo(8, 17)]);
    assert!(agenda.alocacoes.iter().all(|a| a.funcionario_id != l03
        || a.data < data(2027, 2, 8)
        || a.data > data(2027, 2, 17)));

    // Turno no dia 12 (meio das férias): a pessoa trabalha nesse dia e as férias se dividem.
    let depois = s
        .definir_dia(c, l03, data(2027, 2, 12), &turno_do_dia(manha))
        .expect("turno nas férias");
    assert!(depois
        .alocacoes
        .iter()
        .any(|a| a.funcionario_id == l03 && a.data == data(2027, 2, 12) && a.turno_id == manha));
    assert_eq!(ferias_de(&depois), vec![periodo(8, 11), periodo(13, 17)]);
    assert_eq!(
        depois,
        s.obter_agenda(c, 2027, 2).expect("agenda"),
        "o ajuste foi gravado"
    );
    // O cadastro reflete a divisão, com o mesmo motivo e a mesma marca.
    let cadastro = s.listar_funcionarios(c).expect("lista");
    let ausencias = &cadastro
        .iter()
        .find(|f| f.id == l03)
        .expect("L03")
        .ausencias;
    assert_eq!(ausencias.len(), 2);
    assert!(ausencias
        .iter()
        .all(|a| a.motivo.as_deref() == Some("Férias") && a.justificada));
    // A outra pessoa não é afetada.
    assert!(cadastro
        .iter()
        .find(|f| f.id == l01)
        .expect("L01")
        .ausencias
        .is_empty());

    // Um dia depois das férias e uma folga no meio delas também são aceitos.
    s.definir_dia(c, l03, data(2027, 2, 18), &turno_do_dia(manha))
        .expect("depois das férias");
    let folga_nas_ferias = s
        .definir_dia(c, l03, data(2027, 2, 15), &folga_do_dia())
        .expect("folga nas férias");
    assert_eq!(
        ferias_de(&folga_nas_ferias),
        vec![periodo(8, 11), periodo(13, 14), periodo(16, 17)]
    );
    assert!(!folga_nas_ferias
        .alocacoes
        .iter()
        .any(|a| a.funcionario_id == l03 && a.data == data(2027, 2, 15)));
}

// ---------------------------------------------------------------------- funcionários

#[test]
fn salvar_funcionario_edita_cargo_carga_e_preferencia() {
    let mut s = servico();
    let (c, funcs) = cliente_com_loja(&mut s, "Drogaria", &["Manhã", "", ""], &[]);
    let (outro, funcs_de_outro) = cliente_com_loja(&mut s, "Drogaria Vizinha", &[""], &[]);
    let ana = funcs[0].id;
    let editar = |s: &mut Servico, dto: FuncionarioEdicaoDto| s.salvar_funcionario(c, ana, &dto);
    let base = FuncionarioEdicaoDto {
        cargo: None,
        carga_semanal_horas: None,
        preferencia: None,
    };

    let editado = editar(
        &mut s,
        FuncionarioEdicaoDto {
            cargo: Some("  Atendente líder ".into()),
            carga_semanal_horas: Some(36.0),
            preferencia: Some("Noite".into()),
        },
    )
    .expect("editar");
    assert_eq!(editado.cargo.as_deref(), Some("Atendente líder"));
    assert_eq!(editado.carga_semanal_horas, Some(36.0));
    assert_eq!(editado.preferencia.as_deref(), Some("noite"));
    assert_eq!(editado.matricula, "L01");
    assert_eq!(
        s.listar_funcionarios(c).expect("lista")[0]
            .preferencia
            .as_deref(),
        Some("noite"),
        "gravado"
    );

    // Aceita a grafia com acento e maiúsculas e devolve sempre o código.
    for (texto, codigo) in [
        ("Manhã", "manha"),
        ("manha", "manha"),
        (" TARDE ", "tarde"),
        ("noite", "noite"),
    ] {
        let f = editar(
            &mut s,
            FuncionarioEdicaoDto {
                preferencia: Some(texto.into()),
                ..base.clone()
            },
        )
        .expect("preferência");
        assert_eq!(f.preferencia.as_deref(), Some(codigo), "{texto:?}");
    }
    // Sem preferência: `None` e texto vazio limpam; cargo vazio e carga `None` também.
    for preferencia in [None, Some(String::new()), Some("   ".to_string())] {
        editar(
            &mut s,
            FuncionarioEdicaoDto {
                preferencia: Some("tarde".into()),
                ..base.clone()
            },
        )
        .expect("definir");
        let f = editar(
            &mut s,
            FuncionarioEdicaoDto {
                cargo: Some("  ".into()),
                preferencia,
                ..base.clone()
            },
        )
        .expect("limpar");
        assert_eq!(f.preferencia, None);
        assert_eq!(f.cargo, None);
        assert_eq!(f.carga_semanal_horas, None);
    }

    // Valores inválidos são recusados e o cadastro não muda.
    editar(
        &mut s,
        FuncionarioEdicaoDto {
            cargo: Some("Caixa".into()),
            preferencia: Some("manha".into()),
            carga_semanal_horas: Some(30.0),
        },
    )
    .expect("estado conhecido");
    let erro = editar(
        &mut s,
        FuncionarioEdicaoDto {
            preferencia: Some("madrugada".into()),
            ..base.clone()
        },
    )
    .expect_err("preferência inválida")
    .to_string();
    assert!(
        erro.contains("preferência") && erro.contains("manha, tarde ou noite"),
        "{erro}"
    );
    for horas in [0.0, -3.0, 169.0, f64::NAN, f64::INFINITY] {
        let erro = editar(
            &mut s,
            FuncionarioEdicaoDto {
                carga_semanal_horas: Some(horas),
                ..base.clone()
            },
        )
        .expect_err("carga inválida")
        .to_string();
        assert!(erro.contains("carga semanal"), "{horas}: {erro}");
    }
    let f = s.listar_funcionarios(c).expect("lista")[0].clone();
    assert_eq!(
        (
            f.cargo.as_deref(),
            f.carga_semanal_horas,
            f.preferencia.as_deref()
        ),
        (Some("Caixa"), Some(30.0), Some("manha"))
    );

    // Funcionário de outro cliente ou inexistente.
    let erro = s
        .salvar_funcionario(c, funcs_de_outro[0].id, &base)
        .expect_err("de outro cliente");
    assert!(erro.to_string().contains("não encontrado"), "{erro}");
    assert!(s.salvar_funcionario(c, 9999, &base).is_err());
    assert_eq!(
        s.listar_funcionarios(outro).expect("lista")[0]
            .cargo
            .as_deref(),
        Some("Vendedor")
    );
}

#[test]
fn a_carga_individual_limita_as_horas_da_pessoa_na_semana() {
    let mut s = servico();
    let (c, funcs) = cliente_com_loja(
        &mut s,
        "Loja Carga",
        &["", "", "", "", "", "", "", "", "", ""],
        &[],
    );
    let parcial = funcs[0].id;
    s.salvar_funcionario(
        c,
        parcial,
        &FuncionarioEdicaoDto {
            cargo: None,
            carga_semanal_horas: Some(24.0),
            preferencia: None,
        },
    )
    .expect("24h");
    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
    for sem in &agenda.semanas {
        for f in &sem.funcionarios {
            let (limite, horas) = if f.funcionario_id == parcial {
                (24 * 60, 24 * 60)
            } else {
                (42 * 60, 30 * 60)
            };
            assert_eq!(f.limite_min, limite);
            assert_eq!(f.previsto_min, horas);
            assert_eq!(f.minutos, horas, "semana {}", sem.inicio);
        }
    }
}

// ---------------------------------------------------------------------- importação

#[test]
fn importacao_generica_le_a_coluna_preferencia() {
    let mut s = servico();
    let c = s.criar_cliente("Segurança Ltda").expect("cliente");
    let linhas = vec![
        linha(&["1", "Ana Teste", "Vigilante", "Manhã", ""]),
        linha(&["2", "Bia Teste", "Vigilante", "tarde", "36"]),
        linha(&["3", "Caio Teste", "Supervisor", "NOITE", "37,5"]),
        linha(&["4", "Duda Teste", "", "", ""]),
        linha(&["5", "Edu Teste", "Vigilante", "m", ""]),
        linha(&["6", "Fabi Teste", "Vigilante", "Madrugada", ""]),
    ];
    let arquivo = salvar_xlsx("preferencia", &CABECALHO_PADRAO, &linhas, &[]);

    let sim = s
        .importar_planilha(c.id, &arquivo, true)
        .expect("simulação");
    assert_eq!(sim.importados.len(), 5);
    assert_eq!(sim.rejeitados.len(), 1);
    assert!(
        sim.rejeitados[0].erros[0].contains("preferencia"),
        "{:?}",
        sim.rejeitados
    );
    assert_eq!(sim.rejeitados[0].matricula.as_deref(), Some("6"));
    assert!(
        s.listar_funcionarios(c.id).expect("lista").is_empty(),
        "simulação não grava"
    );

    let rel = s
        .importar_planilha(c.id, &arquivo, false)
        .expect("importação");
    assert_eq!(rel.importados.len(), 5);
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    let esperado = |m: &str, p: Option<&str>| (m.to_string(), p.map(str::to_string));
    assert_eq!(
        preferencias_de(&funcs).into_iter().collect::<Vec<_>>(),
        vec![
            esperado("1", Some("manha")),
            esperado("2", Some("tarde")),
            esperado("3", Some("noite")),
            esperado("4", None),
            esperado("5", Some("manha")),
        ]
    );
    let por_matricula = |m: &str| {
        funcs
            .iter()
            .find(|f| f.matricula == m)
            .expect("funcionário")
    };
    assert_eq!(por_matricula("2").carga_semanal_horas, Some(36.0));
    assert_eq!(por_matricula("3").carga_semanal_horas, Some(37.5));
    assert_eq!(por_matricula("3").cargo.as_deref(), Some("Supervisor"));
    assert_eq!(por_matricula("1").carga_semanal_horas, None);

    // Reimportar com a preferência vazia mantém a que estava gravada; com valor, troca.
    let linhas = vec![
        linha(&["1", "Ana Teste", "Vigilante", "", ""]),
        linha(&["2", "Bia Teste", "Vigilante", "Noite", ""]),
    ];
    let segunda = salvar_xlsx("preferencia_2", &CABECALHO_PADRAO, &linhas, &[]);
    let rel = s
        .importar_planilha(c.id, &segunda, false)
        .expect("reimportação");
    assert!(rel.importados.iter().all(|l| l.acao == "atualizado"));
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    let pref = |m: &str| {
        funcs
            .iter()
            .find(|f| f.matricula == m)
            .and_then(|f| f.preferencia.clone())
    };
    assert_eq!(
        pref("1").as_deref(),
        Some("manha"),
        "vazia na planilha mantém a gravada"
    );
    assert_eq!(pref("2").as_deref(), Some("noite"));
    assert_eq!(
        pref("3").as_deref(),
        Some("noite"),
        "quem não veio na planilha não muda"
    );
    let _ = std::fs::remove_file(arquivo);
    let _ = std::fs::remove_file(segunda);
}

#[test]
fn planilha_com_colunas_de_horario_so_importa_as_pessoas() {
    let mut s = servico();
    let c = s.criar_cliente("Cliente Antigo").expect("cliente");
    let turnos_antes = turnos_ativos(&s, c.id);
    // Planilha no formato antigo: os horários (com valores até inválidos) nunca são lidos.
    let cabecalho = [
        "matricula",
        "nome",
        "turno",
        "entrada",
        "saida",
        "intervalo_min",
        "dias_disponiveis",
    ];
    let linhas = vec![
        linha(&["1", "Ana Teste", "Manhã", "08:00", "14:00", "15", "seg-sex"]),
        linha(&["2", "Bia Teste", "Tarde", "", "", "", ""]),
        linha(&[
            "3",
            "Caio Teste",
            "Madrugada",
            "25:99",
            "banana",
            "abc",
            "feriado",
        ]),
        linha(&["4", "Duda Teste", "", "20:00", "", "", ""]),
        linha(&["5", "Edu Teste", "Manhã, Tarde", "", "", "", ""]),
        linha(&["6", "Fabi Teste", "", "", "", "", ""]),
    ];
    let arquivo = salvar_xlsx("antiga", &cabecalho, &linhas, &[]);
    let rel = s
        .importar_planilha(c.id, &arquivo, false)
        .expect("importação");
    let _ = std::fs::remove_file(arquivo);
    assert_eq!(rel.importados.len(), 6, "{:?}", rel.rejeitados);
    assert!(
        rel.rejeitados.is_empty(),
        "valor de horário inválido não rejeita a linha: {:?}",
        rel.rejeitados
    );
    // Um único aviso lista as colunas de horário presentes, na ordem do cabeçalho.
    let avisos_de_horario: Vec<&String> = rel
        .avisos
        .iter()
        .filter(|a| a.contains("colunas de horário ignoradas"))
        .collect();
    assert_eq!(avisos_de_horario.len(), 1, "{:?}", rel.avisos);
    assert!(
        avisos_de_horario[0].contains("turno, entrada, saida, intervalo_min, dias_disponiveis"),
        "{}",
        avisos_de_horario[0]
    );
    assert_eq!(rel.avisos.len(), 1, "nenhum outro aviso: {:?}", rel.avisos);

    // Ninguém ganha preferência dos horários, e os turnos do cliente não mudam.
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    assert_eq!(funcs.len(), 6);
    assert!(
        funcs.iter().all(|f| f.preferencia.is_none()),
        "{:?}",
        preferencias_de(&funcs)
    );
    assert_eq!(turnos_ativos(&s, c.id), turnos_antes);

    // Com a coluna `preferencia`, só ela vale; as de horário continuam ignoradas.
    let cabecalho = [
        "matricula",
        "nome",
        "turno",
        "preferencia",
        "dias_disponiveis",
    ];
    let linhas = vec![
        linha(&["1", "Ana Teste", "Tarde", "Noite", "seg"]),
        linha(&["2", "Bia Teste", "Manhã", "", "seg"]),
    ];
    let arquivo = salvar_xlsx("antiga_2", &cabecalho, &linhas, &[]);
    let rel = s
        .importar_planilha(c.id, &arquivo, false)
        .expect("importação");
    let _ = std::fs::remove_file(arquivo);
    assert!(rel.importados.iter().all(|l| l.acao == "atualizado"));
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    let pref = |m: &str| {
        funcs
            .iter()
            .find(|f| f.matricula == m)
            .and_then(|f| f.preferencia.clone())
    };
    assert_eq!(pref("1").as_deref(), Some("noite"));
    assert_eq!(pref("2"), None);
}

#[test]
fn modelo_de_planilha_e_importavel() {
    let mut s = servico();
    let modelo = std::env::temp_dir().join(format!("escalas_modelo_{}.xlsx", std::process::id()));
    s.salvar_modelo_planilha(&modelo).expect("modelo");
    assert!(std::fs::metadata(&modelo)
        .map(|m| m.len() > 1000)
        .unwrap_or(false));
    let bytes = escala_excel::modelo_em_bytes().expect("bytes");
    assert!(bytes.starts_with(b"PK"), "um .xlsx é um zip");

    let c = s.criar_cliente("Quem Usa o Modelo").expect("cliente");
    let rel = s
        .importar_planilha(c.id, &modelo, false)
        .expect("importar o próprio modelo");
    let _ = std::fs::remove_file(modelo);
    assert_eq!(rel.formato, "padrao");
    assert_eq!(rel.importados.len(), 4);
    assert!(rel.rejeitados.is_empty(), "{:?}", rel.rejeitados);
    assert_eq!(rel.ausencias_importadas, 2, "férias e falta de exemplo");
    assert!(rel.avisos.is_empty(), "{:?}", rel.avisos);
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    let ausencia_de = |m: &str| {
        funcs
            .iter()
            .find(|f| f.matricula == m)
            .expect("funcionário")
            .ausencias
            .iter()
            .map(|a| (a.inicio, a.fim, a.motivo.clone(), a.justificada))
            .collect::<Vec<_>>()
    };
    // Os exemplos do modelo: férias justificadas e uma falta (justificada = Não).
    assert_eq!(
        ausencia_de("1002"),
        vec![(
            data(2026, 1, 5),
            data(2026, 1, 19),
            Some("Férias".to_string()),
            true
        )]
    );
    assert_eq!(
        ausencia_de("1003"),
        vec![(
            data(2026, 1, 12),
            data(2026, 1, 12),
            Some("Falta".to_string()),
            false
        )]
    );
    assert!(ausencia_de("1001").is_empty());
    assert_eq!(
        preferencias_de(&funcs).into_iter().collect::<Vec<_>>(),
        vec![
            ("1001".to_string(), Some("manha".to_string())),
            ("1002".to_string(), Some("tarde".to_string())),
            ("1003".to_string(), None),
            ("1004".to_string(), Some("noite".to_string())),
        ]
    );
    assert_eq!(
        funcs
            .iter()
            .find(|f| f.matricula == "1002")
            .and_then(|f| f.carga_semanal_horas),
        Some(36.0)
    );
}

// ---------------------------------------------------------------------- faltas, abonos e saldo de horas

const UMA_JORNADA: u32 = 6 * 60;

/// Horas da pessoa na semana que contém `dia` (feito, limite e previsto).
fn semana_da_pessoa(
    agenda: &AgendaMesDto,
    dia: NaiveDate,
    pessoa: i64,
) -> HorasSemanaFuncionarioDto {
    agenda
        .semanas
        .iter()
        .find(|w| w.inicio <= dia && dia <= w.fim)
        .expect("semana")
        .funcionarios
        .iter()
        .find(|f| f.funcionario_id == pessoa)
        .expect("pessoa")
        .clone()
}

fn alocacoes_da_pessoa(
    agenda: &AgendaMesDto,
    pessoa: i64,
    de: NaiveDate,
    ate: NaiveDate,
) -> Vec<&AlocacaoDto> {
    agenda
        .alocacoes
        .iter()
        .filter(|a| a.funcionario_id == pessoa && de <= a.data && a.data <= ate)
        .collect()
}

/// "HH:MM" em minutos desde a meia-noite.
fn minutos_do_dia(texto: &str) -> u32 {
    let (h, m) = texto.split_once(':').expect("HH:MM");
    h.parse::<u32>().expect("hora") * 60 + m.parse::<u32>().expect("minuto")
}

/// Minutos entre a entrada e a saída (inclui o intervalo).
fn duracao_total_min(a: &AlocacaoDto) -> u32 {
    (minutos_do_dia(&a.fim) + 24 * 60 - minutos_do_dia(&a.inicio)) % (24 * 60)
}

fn saldo_anterior(agenda: &AgendaMesDto, pessoa: i64) -> i64 {
    agenda
        .funcionarios
        .iter()
        .find(|f| f.id == pessoa)
        .expect("pessoa")
        .saldo_anterior_min
}

/// Saldo das semanas fechadas do mês (feito − previsto), pelo resumo semanal da agenda.
fn saldo_das_semanas_fechadas(agenda: &AgendaMesDto, pessoa: i64) -> i64 {
    agenda
        .semanas
        .iter()
        .filter(|w| !w.pendente)
        .map(|w| {
            let h = w
                .funcionarios
                .iter()
                .find(|f| f.funcionario_id == pessoa)
                .expect("pessoa");
            i64::from(h.minutos) - i64::from(h.previsto_min)
        })
        .sum()
}

/// Dia de trabalho da pessoa na semana de 15 a 21/02/2027.
fn dia_de_trabalho_em(agenda: &AgendaMesDto, pessoa: i64, de: u32, ate: u32) -> NaiveDate {
    alocacoes_da_pessoa(agenda, pessoa, data(2027, 2, de), data(2027, 2, ate))
        .first()
        .map(|a| a.data)
        .expect("a pessoa trabalha na semana")
}

/// Dia de folga da pessoa em `de..=ate` de fevereiro de 2027.
fn dia_de_folga_em(agenda: &AgendaMesDto, pessoa: i64, de: u32, ate: u32) -> NaiveDate {
    (de..=ate)
        .map(|d| data(2027, 2, d))
        .find(|d| {
            !agenda
                .alocacoes
                .iter()
                .any(|a| a.funcionario_id == pessoa && a.data == *d)
        })
        .expect("a pessoa folga em algum dia da semana")
}

fn turno_usual(agenda: &AgendaMesDto, pessoa: i64) -> i64 {
    *turnos_por_pessoa(agenda)[&pessoa]
        .iter()
        .next()
        .expect("turno")
}

/// Loja com 10 pessoas sem preferência e fevereiro/2027 gerado: 4 semanas completas, todas
/// de 5 dias de 6h (30h feitas e previstas), na regra de 42h e 2 folgas. O nome do cliente
/// dá o nome da planilha temporária, então cada teste usa o seu.
fn loja_com_fevereiro(nome: &str) -> (Servico, i64, Vec<FuncionarioDto>, AgendaMesDto) {
    let mut s = servico();
    let (c, funcs) = cliente_com_loja(&mut s, nome, &[""; 10], &[]);
    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
    for sem in &agenda.semanas {
        assert!(!sem.pendente);
        for f in &sem.funcionarios {
            assert_eq!((f.minutos, f.previsto_min), (30 * 60, 30 * 60));
        }
    }
    assert!(agenda
        .funcionarios
        .iter()
        .all(|f| f.saldo_anterior_min == 0));
    (s, c, funcs, agenda)
}

#[test]
fn falta_nao_conta_como_trabalhada_e_ausencia_justificada_abona_a_jornada() {
    let (mut s, c, funcs, agenda) = loja_com_fevereiro("Loja Faltas");
    let (ana, bia) = (funcs[0].id, funcs[1].id);
    let terceira = (data(2027, 2, 15), data(2027, 2, 21));
    let dia_ana = dia_de_trabalho_em(&agenda, ana, 15, 21);
    let dia_bia = dia_de_trabalho_em(&agenda, bia, 15, 21);
    let usual_ana = turno_usual(&agenda, ana);

    // Falta da Ana: as horas feitas caem uma jornada e o previsto continua o mesmo, então
    // ela fica devendo 6h. O limite semanal não muda.
    let com_falta = s
        .definir_dia(c, ana, dia_ana, &ausencia_do_dia(false, Some("Falta")))
        .expect("falta");
    let h = semana_da_pessoa(&com_falta, dia_ana, ana);
    assert_eq!(
        (h.minutos, h.previsto_min, h.limite_min),
        (24 * 60, 30 * 60, 42 * 60)
    );
    assert!(alocacoes_da_pessoa(&com_falta, ana, dia_ana, dia_ana).is_empty());
    let aus: Vec<_> = com_falta
        .ausencias
        .iter()
        .map(|a| {
            (
                a.funcionario_id,
                a.inicio,
                a.fim,
                a.motivo.clone(),
                a.justificada,
            )
        })
        .collect();
    assert_eq!(
        aus,
        vec![(ana, dia_ana, dia_ana, Some("Falta".to_string()), false)]
    );
    // As outras semanas da Ana e a semana das outras pessoas ficam como estavam.
    for sem in &com_falta.semanas {
        for f in &sem.funcionarios {
            let esperado = if f.funcionario_id == ana && sem.inicio == terceira.0 {
                24 * 60
            } else {
                30 * 60
            };
            assert_eq!(
                f.minutos, esperado,
                "{} na semana {}",
                f.funcionario_id, sem.inicio
            );
            assert_eq!(f.previsto_min, 30 * 60);
        }
    }
    assert!(
        violacoes(&com_falta).is_empty(),
        "{:?}",
        violacoes(&com_falta)
    );
    assert_eq!(
        com_falta,
        s.obter_agenda(c, 2027, 2).expect("agenda"),
        "o ajuste foi gravado"
    );

    // Atestado da Bia (justificada): a jornada do dia é abonada, então o previsto cai junto
    // com as horas feitas e não sobra dívida.
    let com_atestado = s
        .definir_dia(c, bia, dia_bia, &ausencia_do_dia(true, Some("Atestado")))
        .expect("atestado");
    let h = semana_da_pessoa(&com_atestado, dia_bia, bia);
    assert_eq!(
        (h.minutos, h.previsto_min),
        (24 * 60, 24 * 60),
        "previsto cai uma jornada"
    );
    assert_eq!(h.minutos, h.previsto_min);
    assert!(com_atestado
        .ausencias
        .iter()
        .any(|a| a.funcionario_id == bia
            && a.inicio == dia_bia
            && a.fim == dia_bia
            && a.motivo.as_deref() == Some("Atestado")
            && a.justificada));
    // A falta da Ana segue como estava na mesma agenda.
    let h = semana_da_pessoa(&com_atestado, dia_ana, ana);
    assert_eq!((h.minutos, h.previsto_min), (24 * 60, 30 * 60));
    assert_eq!(saldo_das_semanas_fechadas(&com_atestado, bia), 0);
    assert_eq!(
        saldo_das_semanas_fechadas(&com_atestado, ana),
        -i64::from(UMA_JORNADA)
    );

    // Trocar a falta da Ana por justificada: o previsto cai, a dívida some.
    let abonada = s
        .definir_dia(c, ana, dia_ana, &ausencia_do_dia(true, None))
        .expect("abonar");
    let h = semana_da_pessoa(&abonada, dia_ana, ana);
    assert_eq!((h.minutos, h.previsto_min), (24 * 60, 24 * 60));
    assert_eq!(saldo_das_semanas_fechadas(&abonada, ana), 0);
    // E de volta ao trabalho: as 30h voltam e a ausência sai da lista.
    let de_volta = s
        .definir_dia(c, ana, dia_ana, &turno_do_dia(usual_ana))
        .expect("turno");
    let h = semana_da_pessoa(&de_volta, dia_ana, ana);
    assert_eq!((h.minutos, h.previsto_min), (30 * 60, 30 * 60));
    assert!(de_volta.ausencias.iter().all(|a| a.funcionario_id != ana));
    // Só a Bia ficou diferente do que o motor gerou (o atestado tirou o dia dela).
    let mut esperado = quadro(&agenda);
    esperado.retain(|(f, _, d, _, _)| !(*f == bia && *d == dia_bia));
    assert_eq!(quadro(&de_volta), esperado);
}

#[test]
fn faltas_viram_saldo_negativo_pago_com_jornadas_esticadas_no_mes_seguinte() {
    let (mut s, c, funcs, fev) = loja_com_fevereiro("Loja Saldo Negativo");
    let (ana, bia) = (funcs[0].id, funcs[1].id);
    let dia_falta = dia_de_trabalho_em(&fev, ana, 8, 14);
    let dia_atestado = dia_de_trabalho_em(&fev, bia, 8, 14);
    s.definir_dia(c, ana, dia_falta, &ausencia_do_dia(false, Some("Falta")))
        .expect("falta");
    let fev = s
        .definir_dia(
            c,
            bia,
            dia_atestado,
            &ausencia_do_dia(true, Some("Atestado")),
        )
        .expect("atestado");
    assert_eq!(saldo_das_semanas_fechadas(&fev, ana), -360);
    assert_eq!(saldo_das_semanas_fechadas(&fev, bia), 0);

    s.gerar_mes(c, 2027, 3).expect("março");
    let marco = s.obter_agenda(c, 2027, 3).expect("agenda");
    // O saldo é o das semanas fechadas de fevereiro: a Ana deve 6h e mais ninguém tem saldo
    // (o atestado da Bia abonou a jornada).
    assert_eq!(saldo_anterior(&marco, ana), -360);
    assert_eq!(
        saldo_anterior(&marco, ana),
        saldo_das_semanas_fechadas(&fev, ana)
    );
    for f in &marco.funcionarios {
        if f.id != ana {
            assert_eq!(f.saldo_anterior_min, 0, "{}", f.nome);
        }
    }
    assert!(violacoes(&marco).is_empty(), "{:?}", violacoes(&marco));

    // 1ª semana de março (01 a 07/03, fechada): a Ana trabalha as 6h a mais, esticando as
    // jornadas dentro do limite semanal, das 8h por dia e do horário da loja (10h às 22h).
    let primeira = data(2027, 3, 1);
    assert!(!marco.semanas[0].pendente);
    let h = semana_da_pessoa(&marco, primeira, ana);
    assert_eq!(h.previsto_min, 30 * 60);
    assert_eq!(
        h.minutos,
        h.previsto_min + 360,
        "paga a dívida na 1ª semana"
    );
    assert!(h.minutos <= h.limite_min);
    let jornadas = alocacoes_da_pessoa(&marco, ana, primeira, data(2027, 3, 7));
    assert_eq!(jornadas.len(), 5);
    let turno_normal = turnos_ativos(&s, c)
        .iter()
        .map(|t| t.minutos_trabalhados)
        .max()
        .expect("turnos");
    assert_eq!(turno_normal, UMA_JORNADA);
    let esticadas: Vec<&&AlocacaoDto> = jornadas
        .iter()
        .filter(|a| a.minutos_trabalhados > turno_normal)
        .collect();
    assert!(!esticadas.is_empty(), "{jornadas:?}");
    for a in &jornadas {
        assert!(a.minutos_trabalhados <= 8 * 60, "{a:?}");
        assert!(a.minutos_trabalhados >= turno_normal, "{a:?}");
        assert!(minutos_do_dia(&a.inicio) >= 10 * 60, "{a:?}");
        assert!(minutos_do_dia(&a.fim) <= 22 * 60, "{a:?}");
    }
    for a in esticadas {
        // Acima de 6h trabalhadas, o intervalo passa a 1h.
        assert_eq!(duracao_total_min(a) - a.minutos_trabalhados, 60, "{a:?}");
    }
    // A dívida foi paga numa semana só: as seguintes voltam ao previsto, para todos.
    for sem in marco.semanas.iter().filter(|w| !w.pendente).skip(1) {
        for f in &sem.funcionarios {
            assert_eq!(
                (f.minutos, f.previsto_min),
                (30 * 60, 30 * 60),
                "{}",
                sem.inicio
            );
        }
    }
    // Quem não tinha saldo fecha a 1ª semana no previsto.
    for f in &marco.semanas[0].funcionarios {
        if f.funcionario_id != ana {
            assert_eq!(f.minutos, f.previsto_min);
        }
    }

    // Regerar março dá exatamente a mesma escala e o mesmo saldo.
    s.gerar_mes(c, 2027, 3).expect("março de novo");
    let de_novo = s.obter_agenda(c, 2027, 3).expect("agenda");
    assert_eq!(quadro(&de_novo), quadro(&marco));
    assert_eq!(de_novo.semanas, marco.semanas);
    assert_eq!(saldo_anterior(&de_novo, ana), -360);
    assert!(violacoes(&de_novo).is_empty(), "{:?}", violacoes(&de_novo));
}

#[test]
fn horas_a_mais_viram_folga_ou_saida_mais_cedo_no_mes_seguinte() {
    let (mut s, c, funcs, fev) = loja_com_fevereiro("Loja Saldo Positivo");
    let (ana, bia) = (funcs[0].id, funcs[1].id);
    // A Ana trabalha num dia de folga da 2ª semana (+6h) e a Bia em dois dias de folga, um na
    // 2ª e outro na 3ª semana (+12h). Cada ajuste usa o turno de sempre da pessoa.
    let folga_ana = dia_de_folga_em(&fev, ana, 8, 14);
    let folga_bia_1 = dia_de_folga_em(&fev, bia, 8, 14);
    let folga_bia_2 = dia_de_folga_em(&fev, bia, 15, 21);
    let (usual_ana, usual_bia) = (turno_usual(&fev, ana), turno_usual(&fev, bia));
    s.definir_dia(c, ana, folga_ana, &turno_do_dia(usual_ana))
        .expect("extra da Ana");
    s.definir_dia(c, bia, folga_bia_1, &turno_do_dia(usual_bia))
        .expect("extra da Bia");
    let fev = s
        .definir_dia(c, bia, folga_bia_2, &turno_do_dia(usual_bia))
        .expect("extra da Bia");
    // O ajuste não é impedido: os 6 dias de trabalho aparecem como violação em fevereiro.
    assert!(!violacoes(&fev).is_empty());
    assert_eq!(saldo_das_semanas_fechadas(&fev, ana), 360);
    assert_eq!(saldo_das_semanas_fechadas(&fev, bia), 720);

    s.gerar_mes(c, 2027, 3).expect("março");
    let marco = s.obter_agenda(c, 2027, 3).expect("agenda");
    assert_eq!(saldo_anterior(&marco, ana), 360);
    assert_eq!(saldo_anterior(&marco, bia), 720);
    for f in &marco.funcionarios {
        if f.id != ana && f.id != bia {
            assert_eq!(f.saldo_anterior_min, 0, "{}", f.nome);
        }
    }
    // Março não herda os 6 dias seguidos de fevereiro como violação.
    assert!(violacoes(&marco).is_empty(), "{:?}", violacoes(&marco));

    // 1ª semana de março: quem tem 6h a mais trabalha uma jornada a menos (4 dias, 24h);
    // quem tem 12h a mais perde uma jornada e sai mais cedo nas outras (2h a menos em 3 dias).
    let primeira = data(2027, 3, 1);
    let fim_da_primeira = data(2027, 3, 7);
    let h_ana = semana_da_pessoa(&marco, primeira, ana);
    assert_eq!((h_ana.minutos, h_ana.previsto_min), (24 * 60, 30 * 60));
    assert_eq!(
        alocacoes_da_pessoa(&marco, ana, primeira, fim_da_primeira).len(),
        4
    );
    let h_bia = semana_da_pessoa(&marco, primeira, bia);
    assert_eq!(h_bia.previsto_min, 30 * 60);
    assert_eq!(
        i64::from(h_bia.minutos),
        i64::from(h_bia.previsto_min) - 720,
        "o saldo inteiro sai na 1ª semana"
    );
    let jornadas = alocacoes_da_pessoa(&marco, bia, primeira, fim_da_primeira);
    assert_eq!(jornadas.len(), 4);
    for a in &jornadas {
        assert!(a.minutos_trabalhados <= UMA_JORNADA, "{a:?}");
        assert!(a.minutos_trabalhados >= 4 * 60, "nunca abaixo de 4h: {a:?}");
    }
    assert!(jornadas.iter().any(|a| a.minutos_trabalhados < UMA_JORNADA));
    // Tudo volta ao previsto depois da 1ª semana.
    for sem in marco.semanas.iter().filter(|w| !w.pendente).skip(1) {
        for f in &sem.funcionarios {
            assert_eq!(
                (f.minutos, f.previsto_min),
                (30 * 60, 30 * 60),
                "{}",
                sem.inicio
            );
        }
    }
    for f in &marco.semanas[0].funcionarios {
        if f.funcionario_id != ana && f.funcionario_id != bia {
            assert_eq!(f.minutos, f.previsto_min);
        }
    }

    // Determinístico ao regerar.
    s.gerar_mes(c, 2027, 3).expect("março de novo");
    let de_novo = s.obter_agenda(c, 2027, 3).expect("agenda");
    assert_eq!(quadro(&de_novo), quadro(&marco));
    assert_eq!(de_novo.semanas, marco.semanas);
    assert_eq!(saldo_anterior(&de_novo, bia), 720);
}

#[test]
fn saldo_so_conta_semanas_fechadas_de_meses_gerados() {
    let (mut s, c, funcs, _) = loja_com_fevereiro("Loja Saldo Fechadas");
    let ana = funcs[0].id;
    // Falta na 4ª semana de fevereiro (22 a 28/02): já é uma semana fechada para março.
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    let dia = dia_de_trabalho_em(&agenda, ana, 22, 28);
    s.definir_dia(c, ana, dia, &ausencia_do_dia(false, None))
        .expect("falta");
    // A exportação do mês aceita a falta sem motivo (a célula sai como "Falta").
    let saida = std::env::temp_dir().join(format!("escala_falta_{}.xlsx", std::process::id()));
    s.exportar_escala(c, 2027, 2, &saida).expect("exportar");
    assert!(std::fs::metadata(&saida)
        .map(|m| m.len() > 1000)
        .unwrap_or(false));
    let _ = std::fs::remove_file(saida);

    // Sem março gerado a agenda de março já mostra o saldo que a geração usaria.
    let marco_vazio = s.obter_agenda(c, 2027, 3).expect("agenda");
    assert!(marco_vazio.gerado_em.is_none());
    assert_eq!(saldo_anterior(&marco_vazio, ana), -360);

    // Abril só enxerga as semanas fechadas antes da sua primeira semana. Como março foi
    // gerado, o saldo de abril é o que sobrar de fevereiro e março juntos.
    s.gerar_mes(c, 2027, 3).expect("março");
    let marco = s.obter_agenda(c, 2027, 3).expect("agenda");
    assert_eq!(saldo_anterior(&marco, ana), -360);
    // Março pagou a dívida na 1ª semana: não sobra nada para abril, e a semana de 29/03 a
    // 04/04 (com dias de abril, ainda sem escala) não conta.
    let abril = s.obter_agenda(c, 2027, 4).expect("abril");
    assert_eq!(saldo_anterior(&abril, ana), 0);

    // Mês excluído deixa de contar: sem fevereiro gerado, março não tem saldo anterior.
    s.excluir_mes(c, 2027, 3).expect("excluir março");
    s.excluir_mes(c, 2027, 2).expect("excluir fevereiro");
    let sem_meses = s.obter_agenda(c, 2027, 3).expect("agenda");
    assert!(sem_meses
        .funcionarios
        .iter()
        .all(|f| f.saldo_anterior_min == 0));
}

/// Editar a carga semanal da pessoa depois de gerar um mês não deve criar saldo nas semanas
/// que já passaram: elas foram feitas com o contrato de então. Hoje o saldo reavalia o
/// previsto das semanas passadas com a carga atual (30h feitas contra 24h previstas).
#[test]
fn editar_a_carga_depois_de_gerar_nao_cria_saldo_nas_semanas_passadas() {
    let (mut s, c, funcs, _) = loja_com_fevereiro("Loja Carga Editada");
    let ana = funcs[0].id;
    s.salvar_funcionario(
        c,
        ana,
        &FuncionarioEdicaoDto {
            cargo: None,
            carga_semanal_horas: Some(24.0),
            preferencia: None,
        },
    )
    .expect("24h");
    s.gerar_mes(c, 2027, 3).expect("março");
    let marco = s.obter_agenda(c, 2027, 3).expect("agenda");
    assert_eq!(
        saldo_anterior(&marco, ana),
        0,
        "as 4 semanas de fevereiro foram feitas no contrato antigo"
    );
    let h = semana_da_pessoa(&marco, data(2027, 3, 1), ana);
    assert_eq!(
        (h.minutos, h.previsto_min, h.limite_min),
        (24 * 60, 24 * 60, 24 * 60)
    );
}

#[test]
fn importacao_generica_le_a_coluna_justificada_das_ausencias() {
    let mut s = servico();
    let c = s.criar_cliente("Loja Ausências").expect("cliente");
    // Equipe que cobre os dois turnos todo dia: ninguém de férias é chamado para cobrir.
    let linhas: Vec<Vec<String>> = (1..=6)
        .map(|i| {
            let m = format!("L{i:02}");
            linha(&[&m, &format!("Pessoa {m}"), "Vendedor", "", ""])
        })
        .collect();
    let ausencias: [LinhaAusencia; 7] = [
        ["L01", "03/02/2027", "05/02/2027", "Férias", "Sim"],
        ["L01", "10/02/2027", "", "Falta", "Não"],
        ["L02", "08/02/2027", "", "Atestado", "s"],
        ["L02", "09/02/2027", "", "", "x"],
        ["L03", "11/02/2027", "", "Falta", "n"],
        ["L03", "12/02/2027", "", "", ""],
        ["L03", "13/02/2027", "", "Dúvida", "talvez"],
    ];
    let arquivo = salvar_xlsx("justificada", &CABECALHO_PADRAO, &linhas, &ausencias);

    let sim = s
        .importar_planilha(c.id, &arquivo, true)
        .expect("simulação");
    assert_eq!(sim.ausencias_importadas, 6);
    assert!(s.listar_funcionarios(c.id).expect("lista").is_empty());
    let rel = s
        .importar_planilha(c.id, &arquivo, false)
        .expect("importação");
    let _ = std::fs::remove_file(arquivo);
    assert_eq!(rel.importados.len(), 6);
    assert_eq!(rel.ausencias_importadas, 6);
    // Valor desconhecido em `justificada` rejeita só aquela linha da aba de ausências.
    assert_eq!(rel.rejeitados.len(), 1, "{:?}", rel.rejeitados);
    assert_eq!(rel.rejeitados[0].planilha, "Ausencias");
    assert_eq!(rel.rejeitados[0].matricula.as_deref(), Some("L03"));
    assert!(
        rel.rejeitados[0].erros[0].contains("justificada"),
        "{:?}",
        rel.rejeitados
    );

    let funcs = s.listar_funcionarios(c.id).expect("lista");
    let de = |m: &str| -> Vec<(NaiveDate, NaiveDate, Option<String>, bool)> {
        funcs
            .iter()
            .find(|f| f.matricula == m)
            .expect("funcionário")
            .ausencias
            .iter()
            .map(|a| (a.inicio, a.fim, a.motivo.clone(), a.justificada))
            .collect()
    };
    let d = |dia: u32| data(2027, 2, dia);
    let motivo = |t: &str| Some(t.to_string());
    assert_eq!(
        de("L01"),
        vec![
            (d(3), d(5), motivo("Férias"), true),
            (d(10), d(10), motivo("Falta"), false)
        ]
    );
    assert_eq!(
        de("L02"),
        vec![
            (d(8), d(8), motivo("Atestado"), true),
            (d(9), d(9), None, true)
        ]
    );
    assert_eq!(
        de("L03"),
        vec![
            (d(11), d(11), motivo("Falta"), false),
            (d(12), d(12), None, true)
        ],
        "vazia = justificada; a linha inválida ficou de fora"
    );

    // Na escala, justificadas e faltas bloqueiam o dia, e a agenda devolve a marca.
    s.gerar_mes(c.id, 2027, 2).expect("fevereiro");
    let agenda = s.obter_agenda(c.id, 2027, 2).expect("agenda");
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
    let por_nome = |m: &str| funcs.iter().find(|f| f.matricula == m).expect("pessoa").id;
    for (matricula, dias) in [
        ("L01", vec![3, 4, 5, 10]),
        ("L02", vec![8, 9]),
        ("L03", vec![11, 12]),
    ] {
        let id = por_nome(matricula);
        for dia in dias {
            assert!(
                alocacoes_da_pessoa(&agenda, id, d(dia), d(dia)).is_empty(),
                "{matricula} escalada em {dia}/02"
            );
        }
    }
    let marcas: BTreeMap<(i64, NaiveDate), bool> = agenda
        .ausencias
        .iter()
        .map(|a| ((a.funcionario_id, a.inicio), a.justificada))
        .collect();
    assert_eq!(marcas.len(), 6);
    assert!(!marcas[&(por_nome("L01"), d(10))]);
    assert!(marcas[&(por_nome("L01"), d(3))]);
    assert!(!marcas[&(por_nome("L03"), d(11))]);
    assert!(marcas[&(por_nome("L03"), d(12))]);
    // 3 dias de férias na semana de 01 a 07/02: o previsto cai 3 jornadas (5 → 2) e a
    // L01 trabalha só essas 2; a falta de um dia só da semana seguinte não reduz o previsto.
    let h = semana_da_pessoa(&agenda, d(3), por_nome("L01"));
    assert_eq!(
        (h.previsto_min, h.minutos),
        (2 * UMA_JORNADA, 2 * UMA_JORNADA)
    );
    let h = semana_da_pessoa(&agenda, d(10), por_nome("L01"));
    assert_eq!(h.previsto_min, 5 * UMA_JORNADA);

    // A exportação aceita faltas (com e sem motivo) e ausências justificadas no mês.
    let saida = std::env::temp_dir().join(format!("escala_ausencias_{}.xlsx", std::process::id()));
    s.exportar_escala(c.id, 2027, 2, &saida).expect("exportar");
    assert!(std::fs::metadata(&saida)
        .map(|m| m.len() > 1000)
        .unwrap_or(false));
    let _ = std::fs::remove_file(saida);
}

// ---------------------------------------------------------------------- validações e DTOs

#[test]
fn validacoes_de_configuracao() {
    let mut s = servico();
    let c = s.criar_cliente("Loja").expect("cliente");
    assert!(s.criar_cliente("   ").is_err());

    let base = TurnoEntradaDto {
        id: None,
        nome: "Madrugada".into(),
        inicio: "00:00".into(),
        fim: "06:00".into(),
        intervalo_min: 15,
        efetivo_minimo: 1,
        ordem: 3,
        cor: "#123abc".into(),
        dias_semana: vec![0, 1, 2, 3, 4],
    };
    let t = s.salvar_turno(c.id, &base).expect("turno");
    assert_eq!(t.minutos_trabalhados, 345);
    assert_eq!(t.cor, "#123ABC");
    assert_eq!(t.dias_semana, vec![0, 1, 2, 3, 4]);
    assert_eq!(
        t.periodo, "noite",
        "começa à meia-noite: antes das 5h é noite"
    );
    assert!(!t.arquivado);
    let cfg = s.obter_configuracao(c.id).expect("cfg");
    assert_eq!(
        cfg.turnos.len(),
        3,
        "2 gerados do funcionamento + o criado à mão"
    );
    let gravado = cfg.turnos.iter().find(|x| x.id == t.id).expect("turno");
    assert_eq!(gravado.dias_semana, vec![0, 1, 2, 3, 4], "roundtrip");
    // Edição: dias fora de ordem e repetidos voltam ordenados e sem repetição.
    let editado = s
        .salvar_turno(
            c.id,
            &TurnoEntradaDto {
                id: Some(t.id),
                dias_semana: vec![6, 2, 2, 0],
                ..base.clone()
            },
        )
        .expect("edição");
    assert_eq!(editado.dias_semana, vec![0, 2, 6]);

    let erro = |r: Result<_, ErroApp>| r.err().map(|e| e.to_string()).unwrap_or_default();
    assert!(erro(s.salvar_turno(
        c.id,
        &TurnoEntradaDto {
            inicio: "25:00".into(),
            ..base.clone()
        }
    ))
    .contains("início"));
    assert!(erro(s.salvar_turno(
        c.id,
        &TurnoEntradaDto {
            fim: "00:00".into(),
            ..base.clone()
        }
    ))
    .contains("iguais"));
    assert!(erro(s.salvar_turno(
        c.id,
        &TurnoEntradaDto {
            cor: "azul".into(),
            ..base.clone()
        }
    ))
    .contains("cor"));
    assert!(erro(s.salvar_turno(
        c.id,
        &TurnoEntradaDto {
            fim: "12:00".into(),
            intervalo_min: 0,
            ..base.clone()
        }
    ))
    .contains("jornada diária"));
    assert!(erro(s.salvar_turno(
        c.id,
        &TurnoEntradaDto {
            nome: "Manhã".into(),
            ..base.clone()
        }
    ))
    .contains("já existe"));
    assert!(erro(s.salvar_turno(
        c.id,
        &TurnoEntradaDto {
            nome: "Sem dias".into(),
            dias_semana: vec![],
            ..base.clone()
        }
    ))
    .contains("ao menos um dia de funcionamento"));
    assert!(erro(s.salvar_turno(
        c.id,
        &TurnoEntradaDto {
            nome: "Dia errado".into(),
            dias_semana: vec![1, 7],
            ..base.clone()
        }
    ))
    .contains("dia de funcionamento inválido"));

    let regras = RegrasDto {
        carga_semanal_max_horas: 44.0,
        jornada_diaria_max_horas: 8.8,
        descanso_entre_jornadas_horas: 11.0,
        max_dias_consecutivos: 6,
        inicio_semana: "domingo".into(),
        folgas_semanais_min: 1,
        domingos_seguidos_max: 0,
        regime: "livre".into(),
        ec141_publicacao: None,
        fases: Vec::new(),
        // Só leitura: o que vier da interface é ignorado ao salvar.
        jornada_padrao_horas: 0.0,
        intervalo_padrao_min: 0,
    };
    let salvas = s.salvar_regras(c.id, &regras).expect("regras");
    assert_eq!(salvas.jornada_diaria_max_horas, 8.8);
    assert_eq!(
        (salvas.jornada_padrao_horas, salvas.intervalo_padrao_min),
        (6.0, 15),
        "a jornada padrão só muda pelo funcionamento"
    );
    assert!(s
        .salvar_regras(
            c.id,
            &RegrasDto {
                inicio_semana: "terça".into(),
                ..regras.clone()
            }
        )
        .is_err());
    assert!(s
        .salvar_regras(
            c.id,
            &RegrasDto {
                carga_semanal_max_horas: 0.0,
                ..regras.clone()
            }
        )
        .is_err());
    assert!(s
        .salvar_regras(
            c.id,
            &RegrasDto {
                carga_semanal_max_horas: f64::NAN,
                ..regras
            }
        )
        .is_err());

    assert!(s.gerar_mes(c.id, 2026, 13).is_err());
    assert!(s.obter_agenda(c.id, 1999, 1).is_err());
    assert!(s.excluir_mes(c.id, 2026, 5).is_err());
    assert!(s.obter_configuracao(9999).is_err());
}

#[test]
fn erros_serializam_como_mensagem_e_dtos_em_camel_case() {
    let mut s = servico();
    let c = s.criar_cliente("Clínica").expect("cliente");
    let json = serde_json::to_value(s.obter_configuracao(c.id).expect("cfg")).expect("json");
    assert_eq!(json["regras"]["cargaSemanalMaxHoras"], 44.0);
    assert_eq!(json["regras"]["regime"], "ec141");
    assert_eq!(json["regras"]["ec141Publicacao"], "2026-10-16");
    assert_eq!(
        json["regras"]["fases"][2]["descricao"],
        "Até 40h e 2 folgas por semana"
    );
    assert_eq!(json["regras"]["inicioSemana"], "segunda");
    assert_eq!(json["regras"]["jornadaPadraoHoras"], 6.0);
    assert_eq!(json["regras"]["intervaloPadraoMin"], 15);
    assert_eq!(json["turnos"][1]["nome"], "Tarde");
    assert_eq!(json["turnos"][1]["fim"], "22:00");
    assert_eq!(json["turnos"][0]["minutosTrabalhados"], 360);
    assert_eq!(json["turnos"][0]["periodo"], "manha");
    assert_eq!(json["turnos"][0]["arquivado"], false);
    assert_eq!(
        json["turnos"][0]["diasSemana"],
        serde_json::json!([0, 1, 2, 3, 4, 5, 6])
    );
    assert_eq!(json["funcionamento"].as_array().map(Vec::len), Some(7));
    assert_eq!(
        json["funcionamento"][6],
        serde_json::json!({"dia": 6, "aberto": true, "abre": "10:00", "fecha": "22:00"})
    );

    // O DTO de entrada do funcionamento também é camelCase.
    let entrada: FuncionamentoEntradaDto = serde_json::from_value(serde_json::json!({
        "dias": [{"dia": 0, "aberto": true, "abre": "09:00", "fecha": "18:00"}],
        "jornadaHoras": 8.0,
        "intervaloMin": 60
    }))
    .expect("entrada");
    let cfg = s.salvar_funcionamento(c.id, &entrada).expect("salvar");
    assert_eq!(cfg.turnos.len(), 1);
    assert_eq!(cfg.turnos[0].dias_semana, vec![0]);
    assert_eq!(
        serde_json::to_value(&cfg).expect("json")["funcionamento"][0]["fecha"],
        "18:00"
    );

    let agenda =
        serde_json::to_value(s.obter_agenda(c.id, 2026, 1).expect("agenda")).expect("json");
    assert!(agenda["geradoEm"].is_null());
    assert_eq!(agenda["semanas"][0]["inicio"], "2025-12-29");
    assert_eq!(agenda["ausencias"], serde_json::json!([]));

    let erro = s
        .importar_planilha(c.id, std::path::Path::new("/nao/existe.xlsx"), true)
        .expect_err("erro");
    let texto = serde_json::to_value(&erro).expect("json");
    assert!(texto
        .as_str()
        .expect("string")
        .contains("não foi possível ler o arquivo"));

    // O dia do Quadro vem da interface em camelCase, com os campos opcionais omitidos.
    let dia: DiaQuadroDto =
        serde_json::from_value(serde_json::json!({"tipo": "folga"})).expect("folga");
    assert_eq!(dia, folga_do_dia());
    let dia: DiaQuadroDto = serde_json::from_value(
        serde_json::json!({"tipo": "ausencia", "justificada": false, "motivo": "Falta"}),
    )
    .expect("falta");
    assert_eq!(dia, ausencia_do_dia(false, Some("Falta")));
    let dia: DiaQuadroDto =
        serde_json::from_value(serde_json::json!({"tipo": "turno", "turnoId": 7})).expect("turno");
    assert_eq!(dia, turno_do_dia(7));
}

/// A agenda e o cadastro levam a marca de justificada das ausências, e o resumo de cada
/// pessoa traz o saldo anterior, tudo em camelCase.
#[test]
fn agenda_e_cadastro_trazem_justificada_e_saldo_anterior_em_camel_case() {
    let mut s = servico();
    let (c, funcs) = cliente_com_loja(
        &mut s,
        "Loja Json",
        &["", ""],
        &[
            ["L01", "03/02/2027", "03/02/2027", "Falta", "Não"],
            ["L02", "10/02/2027", "11/02/2027", "Atestado", "Sim"],
        ],
    );
    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    let agenda = serde_json::to_value(s.obter_agenda(c, 2027, 2).expect("agenda")).expect("json");
    let ausencias = agenda["ausencias"].as_array().expect("ausências");
    assert_eq!(ausencias.len(), 2);
    let da = |id: i64| {
        ausencias
            .iter()
            .find(|a| a["funcionarioId"] == id)
            .expect("ausência")
    };
    assert_eq!(da(funcs[0].id)["justificada"], false);
    assert_eq!(da(funcs[0].id)["motivo"], "Falta");
    assert_eq!(da(funcs[1].id)["justificada"], true);
    assert_eq!(agenda["funcionarios"][0]["saldoAnteriorMin"], 0);
    assert!(agenda["semanas"][0]["funcionarios"][0]["previstoMin"].is_u64());
    let cadastro = serde_json::to_value(s.listar_funcionarios(c).expect("lista")).expect("json");
    assert_eq!(cadastro[0]["ausencias"][0]["justificada"], false);
    assert_eq!(cadastro[1]["ausencias"][0]["justificada"], true);
}

/// O relatório de importação só traz pessoas e ausências: sem turnos criados ou
/// removidos nem diagnóstico de jornada.
#[test]
fn relatorio_de_importacao_so_traz_pessoas_e_ausencias() {
    let mut s = servico();
    let c = s.criar_cliente("Clínica").expect("cliente");
    let arquivo = loja("json", &["Manhã", ""], &[["L01", "02/02/2027", "", "", ""]]);
    let rel = s
        .importar_planilha(c.id, &arquivo, true)
        .expect("simulação");
    let _ = std::fs::remove_file(arquivo);
    let json = serde_json::to_value(&rel).expect("json");
    let mut chaves: Vec<&str> = json
        .as_object()
        .expect("objeto")
        .keys()
        .map(String::as_str)
        .collect();
    chaves.sort_unstable();
    assert_eq!(
        chaves,
        vec![
            "arquivo",
            "ausenciasImportadas",
            "avisos",
            "empregador",
            "formato",
            "importados",
            "rejeitados",
            "simulacao",
            "totalLinhas"
        ]
    );
    assert_eq!(json["ausenciasImportadas"], 1);
    assert_eq!(json["simulacao"], true);
    assert_eq!(json["importados"][0]["acao"], "criado");
}

// ---------------------------------------------------------------------- quadro de horário

/// Quadro de horário sintético no formato real (cabeçalho numa célula só,
/// linha de continuação com o sábado, cabeçalho de página repetido).
fn quadro_de_horario(nome: &str) -> PathBuf {
    let mut pasta = Workbook::new();
    let aba = pasta.add_worksheet();
    aba.set_name("Table 1").expect("nome");
    aba.write_string(0, 0, "Horário de Trabalho").expect("t");
    aba.write_string(1, 0, "Empregador: FARMACIA EXEMPLO LTDA\nEndereço.: R 1, 10      Atividade.: Comércio varejista de produtos").expect("t");
    aba.write_string(2, 0, "Cód     Nome do Funcionário     Nome do Função     Seção Numero   Serie     Ent.       Intervalo      Saida     Des      Visto").expect("t");
    let linhas: &[[&str; 10]] = &[
        // 6x1 com sábado curto: 08:00–18:00 (intervalo não informado) + sáb 08:00–12:00.
        [
            "1",
            "Ana Teste",
            "Atendente",
            "",
            "00001111",
            "00010",
            "08:00",
            "",
            "18:00",
            "Dom",
        ],
        [
            "",
            "",
            "",
            "",
            "",
            "",
            "08:00",
            ":    A      :",
            "12:00",
            "",
        ],
        // 8h30 por dia: será ajustada para 2h de intervalo.
        [
            "2",
            "Bia Teste",
            "Manipulador (a)",
            "",
            "00002222",
            "00020",
            "08:30",
            "11:30 A 13:00",
            "18:30",
            "Dom",
        ],
        [
            "3",
            "Caio Teste",
            "Atendente",
            "",
            "00003333",
            "00030",
            "09:00",
            "12:00 A 14:00",
            "19:00",
            "Dom/Sáb",
        ],
        [
            "4",
            "Duda Teste",
            "Atendente",
            "",
            "00004444",
            "00040",
            "09:00",
            "12:00 A 14:00",
            "19:00",
            "Dom",
        ],
        // Entra à tarde: a preferência de período vira "tarde".
        [
            "5",
            "Eva Teste",
            "Atendente",
            "",
            "00005555",
            "00050",
            "13:00",
            "17:00 A 18:00",
            "21:00",
            "Dom",
        ],
    ];
    let mut l = 3u32;
    for (i, linha) in linhas.iter().enumerate() {
        if i == 2 {
            // Cabeçalho de página repetido no meio.
            aba.write_string(l, 0, "Horário de Trabalho").expect("t");
            aba.write_string(l + 1, 0, "Empregador: FARMACIA EXEMPLO LTDA")
                .expect("t");
            aba.write_string(l + 2, 0, "Cód     Nome do Funcionário     Nome do Função     Seção Numero   Serie     Ent.       Intervalo      Saida     Des      Visto").expect("t");
            l += 3;
        }
        for (c, v) in linha.iter().enumerate() {
            if !v.is_empty() {
                aba.write_string(l, c as u16, *v).expect("c");
            }
        }
        l += 1;
    }
    aba.write_string(
        l + 2,
        0,
        "Observação\nAos Funcionários é concedido intervalo de 15 minutos para lanche",
    )
    .expect("t");
    let caminho =
        std::env::temp_dir().join(format!("quadro_teste_{}_{nome}.xlsx", std::process::id()));
    pasta.save(&caminho).expect("salvar");
    caminho
}

const AVISO_QUADRO: &str = "Do quadro foram lidos só os dados das pessoas;";

#[test]
fn quadro_de_horario_importa_so_as_pessoas_e_a_escala_sai_do_funcionamento() {
    let mut s = servico();
    let c = s.criar_cliente("Farmácia").expect("cliente");
    let cfg = s.obter_configuracao(c.id).expect("cfg");
    assert_eq!(cfg.regras.regime, "ec141");
    assert_eq!(cfg.regras.fases.len(), 3);
    assert_eq!(
        cfg.regras.fases[1].desde.map(|d| d.to_string()).as_deref(),
        Some("2026-12-16")
    );
    assert_eq!(cfg.regras.fases[2].carga_semanal_max_horas, 40.0);

    let arquivo = quadro_de_horario("ec141");
    let sim = s
        .importar_planilha(c.id, &arquivo, true)
        .expect("simulação");
    assert_eq!(sim.formato, "quadro");
    assert_eq!(sim.empregador.as_deref(), Some("FARMACIA EXEMPLO LTDA"));
    assert_eq!(sim.importados.len(), 5, "{:?}", sim.rejeitados);
    assert!(sim.rejeitados.is_empty(), "{:?}", sim.rejeitados);
    assert_eq!(sim.ausencias_importadas, 0);
    assert!(
        s.listar_funcionarios(c.id).expect("lista").is_empty(),
        "simulação não grava"
    );
    // O relatório avisa que só as pessoas foram lidas e não comenta mais os horários.
    assert!(
        sim.avisos.iter().any(|a| a.starts_with(AVISO_QUADRO)),
        "{:?}",
        sim.avisos
    );
    assert!(
        sim.avisos
            .iter()
            .all(|a| !a.starts_with("Horário com gente no quadro")),
        "{:?}",
        sim.avisos
    );

    let rel = s
        .importar_planilha(c.id, &arquivo, false)
        .expect("importação");
    assert!(rel.importados.iter().all(|l| l.acao == "criado"));
    assert!(rel.avisos.iter().any(|a| a.starts_with(AVISO_QUADRO)));
    // Nenhum turno é criado nem removido: os turnos saem do funcionamento do cliente.
    assert_eq!(s.obter_configuracao(c.id).expect("cfg").turnos, cfg.turnos);
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    assert_eq!(funcs.len(), 5);
    let ana = funcs
        .iter()
        .find(|f| f.nome == "Ana Teste")
        .expect("ana")
        .clone();
    assert_eq!(ana.matricula, "00001111", "a matrícula é o número da CTPS");
    assert_eq!(ana.ctps.as_deref(), Some("00001111/00010"));
    assert_eq!(ana.cargo.as_deref(), Some("Atendente"));
    assert!(ana.ausencias.is_empty());
    // O horário do quadro (entrada às 8h, às 13h...) não vira preferência de ninguém.
    assert!(
        funcs.iter().all(|f| f.preferencia.is_none()),
        "{:?}",
        preferencias_de(&funcs)
    );

    // A preferência dada no app sobrevive a uma nova importação do quadro, que atualiza
    // as pessoas pela CTPS e continua sem mexer nos turnos.
    let eva = funcs
        .iter()
        .find(|f| f.nome == "Eva Teste")
        .expect("eva")
        .id;
    s.salvar_funcionario(
        c.id,
        eva,
        &FuncionarioEdicaoDto {
            cargo: Some("Atendente".into()),
            carga_semanal_horas: None,
            preferencia: Some("tarde".into()),
        },
    )
    .expect("preferência da Eva");
    let rel = s
        .importar_planilha(c.id, &arquivo, false)
        .expect("reimportação");
    assert!(rel.importados.iter().all(|l| l.acao == "atualizado"));
    assert_eq!(s.obter_configuracao(c.id).expect("cfg").turnos, cfg.turnos);
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    assert_eq!(funcs.len(), 5);
    let pref = |nome: &str| {
        funcs
            .iter()
            .find(|f| f.nome == nome)
            .and_then(|f| f.preferencia.clone())
    };
    assert_eq!(pref("Eva Teste").as_deref(), Some("tarde"));
    for nome in ["Ana Teste", "Bia Teste", "Caio Teste", "Duda Teste"] {
        assert_eq!(pref(nome), None, "{nome}");
    }

    // Dezembro/2026 atravessa a transição: até 15/12 vale 44h e 1 folga; depois, 42h e 2 folgas.
    s.gerar_mes(c.id, 2026, 12).expect("dezembro");
    let agenda = s.obter_agenda(c.id, 2026, 12).expect("agenda");
    assert!(
        agenda.regra.contains("44h e 1 folga") && agenda.regra.contains("42h e 2 folgas"),
        "{}",
        agenda.regra
    );
    assert!(agenda.avisos.iter().all(|a| a.tipo != "violacaoRegra"));
    for sem in &agenda.semanas {
        for f in &sem.funcionarios {
            assert!(f.minutos <= f.limite_min);
            if sem.inicio.to_string().as_str() >= "2026-12-14" {
                assert_eq!(f.limite_min, 42 * 60);
            }
        }
        if sem.inicio.to_string().as_str() >= "2026-12-14" {
            for f in &sem.funcionarios {
                let dias = dias_trabalhados_na_semana(&agenda, f.funcionario_id, sem.inicio);
                assert!(dias <= 5, "{} dias na semana {}", dias, sem.inicio);
            }
        }
    }
    // A equipe toda entra na escala, nos turnos do funcionamento e sem faltar gente em nenhum.
    let ids_turnos: BTreeSet<i64> = cfg.turnos.iter().map(|t| t.id).collect();
    assert!(agenda
        .alocacoes
        .iter()
        .all(|a| ids_turnos.contains(&a.turno_id)));
    let por_pessoa = turnos_por_pessoa(&agenda);
    assert_eq!(por_pessoa.len(), 5);
    assert!(
        agenda
            .avisos
            .iter()
            .all(|a| a.tipo != "coberturaInsuficiente"),
        "{:?}",
        agenda.avisos
    );
    for dia in dias_do_mes(2026, 12) {
        for t in &cfg.turnos {
            assert!(
                equipe_do_dia(&agenda, dia, t.id) >= 1,
                "{dia}: turno {} vazio",
                t.nome
            );
        }
    }
    // Quem pediu a tarde (Eva, preferência dada no app depois da importação) fecha a loja.
    assert_eq!(por_pessoa[&eva], BTreeSet::from([cfg.turnos[1].id]));

    let saida = std::env::temp_dir().join(format!("escala_exportada_{}.xlsx", std::process::id()));
    s.exportar_escala(c.id, 2026, 12, &saida).expect("exportar");
    assert!(std::fs::metadata(&saida)
        .map(|m| m.len() > 1000)
        .unwrap_or(false));
    assert!(
        s.exportar_escala(c.id, 2027, 1, &saida).is_err(),
        "mês não gerado não exporta"
    );
    let _ = std::fs::remove_file(saida);
    let _ = std::fs::remove_file(arquivo);
}

/// O quadro não traz carga semanal: reimportá-lo não deve apagar a carga que a pessoa
/// ganhou no cadastro (como acontece com a preferência).
#[test]
fn reimportar_o_quadro_mantem_a_carga_semanal_editada() {
    let mut s = servico();
    let c = s.criar_cliente("Farmácia").expect("cliente");
    let arquivo = quadro_de_horario("carga");
    s.importar_planilha(c.id, &arquivo, false)
        .expect("importação");
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    let ana = funcs
        .iter()
        .find(|f| f.nome == "Ana Teste")
        .expect("ana")
        .id;
    s.salvar_funcionario(
        c.id,
        ana,
        &FuncionarioEdicaoDto {
            cargo: None,
            carga_semanal_horas: Some(24.0),
            preferencia: Some("noite".into()),
        },
    )
    .expect("editar");
    s.importar_planilha(c.id, &arquivo, false)
        .expect("reimportação");
    let _ = std::fs::remove_file(arquivo);
    let depois = s
        .listar_funcionarios(c.id)
        .expect("lista")
        .into_iter()
        .find(|f| f.id == ana)
        .expect("ana");
    assert_eq!(depois.preferencia.as_deref(), Some("noite"));
    assert_eq!(depois.carga_semanal_horas, Some(24.0));
}

#[test]
fn quadro_distribui_a_equipe_nos_turnos_do_funcionamento() {
    let mut s = servico();
    let c = s.criar_cliente("Drogaria").expect("cliente");
    let arquivo = quadro_de_horario("distribui");
    s.importar_planilha(c.id, &arquivo, false)
        .expect("importação");
    let _ = std::fs::remove_file(arquivo);
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    let turnos = turnos_ativos(&s, c.id);

    s.gerar_mes(c.id, 2027, 1).expect("janeiro");
    let agenda = s.obter_agenda(c.id, 2027, 1).expect("agenda");
    assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
    // Semanas completas fecham nas horas previstas (5 dias de 6h na regra de 42h).
    for sem in agenda.semanas.iter().filter(|w| !w.pendente) {
        for h in &sem.funcionarios {
            assert_eq!(h.minutos, h.previsto_min, "semana {}", sem.inicio);
            assert_eq!(h.previsto_min, 30 * 60);
        }
    }
    // Janeiro/2027 começa numa sexta: a 1ª semana tem dias de dezembro, que não tem escala.
    assert!(agenda.semanas[0].pendente);
    assert!(
        !agenda.semanas.last().expect("semana").pendente,
        "31/01/2027 é domingo"
    );
    // Todo mundo trabalha e os dois turnos têm gente todos os dias.
    assert_eq!(turnos_por_pessoa(&agenda).len(), funcs.len());
    for dia in dias_do_mes(2027, 1) {
        for t in &turnos {
            assert!(
                equipe_do_dia(&agenda, dia, t.id) >= 1,
                "{dia}: turno {} vazio",
                t.nome
            );
        }
    }

    // Edição: Ana passa a ter 24h semanais e prefere a noite (o turno que fecha).
    let ana = funcs.iter().find(|f| f.nome == "Ana Teste").expect("ana");
    let editado = s
        .salvar_funcionario(
            c.id,
            ana.id,
            &FuncionarioEdicaoDto {
                cargo: Some("Atendente líder".into()),
                carga_semanal_horas: Some(24.0),
                preferencia: Some("noite".into()),
            },
        )
        .expect("editar");
    assert_eq!(editado.cargo.as_deref(), Some("Atendente líder"));
    assert_eq!(editado.carga_semanal_horas, Some(24.0));
    assert_eq!(editado.preferencia.as_deref(), Some("noite"));
    // O saldo de fevereiro conta as semanas de janeiro com o contrato de hoje: regerar
    // janeiro com os 24h novos mantém o saldo zerado (ver o teste ignorado sobre a edição
    // do contrato depois de gerar).
    s.gerar_mes(c.id, 2027, 1)
        .expect("janeiro com o contrato novo");
    s.gerar_mes(c.id, 2027, 2).expect("fevereiro");
    let fev = s.obter_agenda(c.id, 2027, 2).expect("agenda");
    assert!(violacoes(&fev).is_empty(), "{:?}", violacoes(&fev));
    for sem in fev.semanas.iter().filter(|w| !w.pendente) {
        let h = sem
            .funcionarios
            .iter()
            .find(|h| h.funcionario_id == ana.id)
            .expect("ana");
        assert_eq!(
            (h.limite_min, h.minutos),
            (24 * 60, 24 * 60),
            "semana {}",
            sem.inicio
        );
    }
    assert_eq!(
        fev.funcionarios
            .iter()
            .find(|f| f.id == ana.id)
            .and_then(|f| f.preferencia.clone())
            .as_deref(),
        Some("noite")
    );
}

/// Verificação manual contra um quadro real. Não roda por padrão:
/// `QUADRO_XLSX=/caminho/quadro.xlsx cargo test -p escala-app --test fluxo -- --ignored --nocapture`
/// Imprime só contagens (nada de nomes nem documentos) e exige zero violações de regra.
#[test]
#[ignore = "lê um quadro real indicado por QUADRO_XLSX"]
fn quadro_real_so_contagens() {
    let Some(caminho) = std::env::var_os("QUADRO_XLSX").map(PathBuf::from) else {
        println!("QUADRO_XLSX não definido; nada a verificar");
        return;
    };
    if !caminho.exists() {
        println!("arquivo não existe; nada a verificar");
        return;
    }
    let mut s = servico();
    let c = s.criar_cliente("Quadro real").expect("cliente");
    let rel = s
        .importar_planilha(c.id, &caminho, false)
        .expect("importação");
    println!("formato = {}", rel.formato);
    println!("importados = {}", rel.importados.len());
    println!("rejeitados = {}", rel.rejeitados.len());
    println!("avisos = {}", rel.avisos.len());
    let funcs = s.listar_funcionarios(c.id).expect("lista");
    for p in ["manha", "tarde", "noite"] {
        println!(
            "preferencia_{p} = {}",
            funcs
                .iter()
                .filter(|f| f.preferencia.as_deref() == Some(p))
                .count()
        );
    }
    assert!(
        funcs.iter().all(|f| f.preferencia.is_none()),
        "o quadro só traz as pessoas, sem preferência"
    );

    // Fevereiro/2027: 4 semanas completas na regra de 42h e 2 folgas.
    s.gerar_mes(c.id, 2027, 2).expect("fevereiro");
    let agenda = s.obter_agenda(c.id, 2027, 2).expect("agenda");
    let turnos = turnos_ativos(&s, c.id);
    let equipe = equipe_por_turno(&agenda);
    let por_dia: Vec<usize> = dias_do_mes(2027, 2)
        .iter()
        .flat_map(|d| {
            turnos
                .iter()
                .map(|t| equipe_do_dia(&agenda, *d, t.id))
                .collect::<Vec<_>>()
        })
        .collect();
    println!(
        "pessoas_por_turno = {:?}",
        equipe.values().collect::<Vec<_>>()
    );
    println!(
        "pessoas_por_turno_e_dia: min {} max {}",
        por_dia.iter().min().copied().unwrap_or(0),
        por_dia.iter().max().copied().unwrap_or(0)
    );
    let trocaram = turnos_por_pessoa(&agenda)
        .values()
        .filter(|t| t.len() > 1)
        .count();
    println!("trocaram_de_turno_no_mes = {trocaram}");
    let fora_do_previsto = agenda
        .semanas
        .iter()
        .filter(|w| !w.pendente)
        .flat_map(|w| &w.funcionarios)
        .filter(|h| h.minutos != h.previsto_min)
        .count();
    println!("semanas_fora_do_previsto = {fora_do_previsto}");
    println!("violacoes = {}", violacoes(&agenda).len());
    println!(
        "avisos_de_cobertura = {}",
        agenda
            .avisos
            .iter()
            .filter(|a| a.tipo == "coberturaInsuficiente")
            .count()
    );
    assert!(violacoes(&agenda).is_empty());
}

// ---------------------------------------------------------------------------
// Modelos de funcionamento e configuração personalizada
// ---------------------------------------------------------------------------

#[test]
fn modelo_define_horario_jornada_e_regras_da_ec141() {
    let mut s = servico();
    let modelos = s.listar_modelos();
    assert!(modelos.len() >= 7);
    assert!(modelos.iter().all(|m| m.regras.regime == "ec141"));
    assert!(modelos
        .iter()
        .all(|m| m.jornada_horas * 5.0 <= 40.0 && m.regras.jornada_diaria_max_horas == 8.0));

    // Cliente novo sem modelo nasce no shopping, com domingo a cada 3 semanas.
    let c = s.criar_cliente("Loja").expect("cliente").id;
    let cfg = s.obter_configuracao(c).expect("cfg");
    assert_eq!(cfg.modelo.as_deref(), Some("shopping"));
    assert_eq!(cfg.regras.domingos_seguidos_max, 2);
    assert_eq!(cfg.regras.fases.len(), 3);

    // Com modelo: horário, jornada e regras mudam juntos e os turnos são refeitos.
    let e = s
        .criar_cliente_com_modelo("Escritório", "administrativo")
        .expect("cliente")
        .id;
    let cfg = s.obter_configuracao(e).expect("cfg");
    assert_eq!(cfg.modelo.as_deref(), Some("administrativo"));
    assert!(!cfg.funcionamento[5].aberto && !cfg.funcionamento[6].aberto);
    assert_eq!(cfg.turnos.len(), 1);
    assert_eq!(
        (cfg.turnos[0].inicio.as_str(), cfg.turnos[0].fim.as_str()),
        ("08:00", "17:00")
    );
    assert_eq!(cfg.regras.jornada_padrao_horas, 8.0);
    assert!(s.criar_cliente_com_modelo("X", "nao-existe").is_err());

    let cfg = s
        .salvar_configuracao(
            e,
            &escala_app::dto::ConfiguracaoEntradaDto {
                modelo: Some("supermercado".into()),
                regras: None,
                funcionamento: None,
            },
        )
        .expect("aplicar modelo");
    assert_eq!(cfg.modelo.as_deref(), Some("supermercado"));
    assert_eq!(cfg.turnos.len(), 2);
    assert!(cfg.funcionamento.iter().all(|d| d.aberto));
}

#[test]
fn configuracao_personalizada_salva_tudo_junto_e_sai_do_modelo() {
    let mut s = servico();
    let c = s.criar_cliente("Loja").expect("cliente").id;
    let cfg = s.obter_configuracao(c).expect("cfg");
    let mut regras = cfg.regras.clone();
    regras.jornada_diaria_max_horas = 9.0;
    regras.descanso_entre_jornadas_horas = 10.0;
    regras.regime = "livre".into();
    let dias: Vec<DiaFuncionamentoDto> = cfg
        .funcionamento
        .iter()
        .map(|d| DiaFuncionamentoDto {
            fecha: "23:00".into(),
            ..d.clone()
        })
        .collect();
    // Jornada de 9h só passa porque as regras novas (9h por dia) vêm junto.
    let cfg = s
        .salvar_configuracao(
            c,
            &escala_app::dto::ConfiguracaoEntradaDto {
                modelo: None,
                regras: Some(regras.clone()),
                funcionamento: Some(FuncionamentoEntradaDto {
                    dias: dias.clone(),
                    jornada_horas: 9.0,
                    intervalo_min: 60,
                }),
            },
        )
        .expect("personalizada");
    assert_eq!(cfg.modelo, None);
    assert_eq!(cfg.regras.regime, "livre");
    assert_eq!(cfg.regras.jornada_padrao_horas, 9.0);
    assert!(cfg.turnos.iter().all(|t| t.minutos_trabalhados == 9 * 60));

    // Jornada acima do máximo diário das regras enviadas: nada é gravado.
    let antes = s.obter_configuracao(c).expect("cfg");
    let erro = s.salvar_configuracao(
        c,
        &escala_app::dto::ConfiguracaoEntradaDto {
            modelo: None,
            regras: Some(RegrasDto {
                jornada_diaria_max_horas: 8.0,
                ..regras
            }),
            funcionamento: Some(FuncionamentoEntradaDto {
                dias,
                jornada_horas: 9.0,
                intervalo_min: 60,
            }),
        },
    );
    assert!(erro.is_err());
    assert_eq!(s.obter_configuracao(c).expect("cfg"), antes);

    // Personalizada sem regras ou sem funcionamento é recusada.
    assert!(s
        .salvar_configuracao(
            c,
            &escala_app::dto::ConfiguracaoEntradaDto {
                modelo: None,
                regras: None,
                funcionamento: None,
            },
        )
        .is_err());

    // Voltar ao modelo restaura horário, jornada e regras da EC 141.
    let cfg = s
        .salvar_configuracao(
            c,
            &escala_app::dto::ConfiguracaoEntradaDto {
                modelo: Some("shopping".into()),
                regras: None,
                funcionamento: None,
            },
        )
        .expect("modelo");
    assert_eq!(cfg.regras.regime, "ec141");
    assert_eq!(cfg.regras.jornada_diaria_max_horas, 8.0);
    assert_eq!(cfg.turnos.len(), 2);

    // Mexer só nas regras (tela antiga) também sai do modelo.
    s.salvar_regras(c, &cfg.regras).expect("regras");
    assert_eq!(s.obter_configuracao(c).expect("cfg").modelo, None);
}

// ---------------------------------------------------------------------------
// Cobertura por função
// ---------------------------------------------------------------------------

#[test]
fn cafeteria_tem_cada_funcao_em_todo_turno_e_avisa_quando_falta() {
    let mut s = servico();
    let c = s.criar_cliente("Cafeteria").expect("cliente").id;
    // Atendentes preferem a manhã e cozinheiros também: sem a regra por função, a
    // tarde ficaria sem cozinheiro.
    let mut linhas: Vec<Vec<String>> = (1..=6)
        .map(|i| {
            linha(&[
                &format!("A{i}"),
                &format!("Atendente {i}"),
                "Atendente",
                "Manhã",
                "",
            ])
        })
        .collect();
    linhas.extend((1..=4).map(|i| {
        linha(&[
            &format!("C{i}"),
            &format!("Cozinheiro {i}"),
            "Cozinheiro (a)",
            "Manhã",
            "",
        ])
    }));
    linhas.push(linha(&["G1", "Gerente 1", "Gerente", "", ""]));
    let arquivo = salvar_xlsx("cafeteria", &CABECALHO_PADRAO, &linhas, &[]);
    s.importar_planilha(c, &arquivo, false).expect("importação");
    let _ = std::fs::remove_file(arquivo);

    // Cada função começa exigida (1 por turno); o gerente sozinho não cobre 2 turnos × 7 dias.
    let funcoes = s.obter_configuracao(c).expect("cfg").funcoes;
    let por_chave: BTreeMap<&str, (u32, u32, u32)> = funcoes
        .iter()
        .map(|f| {
            (
                f.chave.as_str(),
                (f.pessoas, f.minimo, f.pessoas_necessarias),
            )
        })
        .collect();
    assert_eq!(por_chave["atendente"], (6, 1, 3));
    assert_eq!(por_chave["cozinheiro"], (4, 1, 3));
    assert_eq!(por_chave["gerente"], (1, 1, 3));
    assert_eq!(
        funcoes
            .iter()
            .find(|f| f.chave == "cozinheiro")
            .map(|f| f.nome.as_str()),
        Some("Cozinheiro (a)")
    );
    let funcoes = s
        .salvar_funcoes(
            c,
            &[escala_app::dto::FuncaoMinimoDto {
                chave: "Gerente".into(),
                minimo: 0,
            }],
        )
        .expect("funções");
    assert_eq!(
        funcoes
            .iter()
            .find(|f| f.chave == "gerente")
            .map(|f| f.minimo),
        Some(0)
    );
    assert!(s
        .salvar_funcoes(
            c,
            &[escala_app::dto::FuncaoMinimoDto {
                chave: "Gerente".into(),
                minimo: 21,
            }],
        )
        .is_err());

    // Dezembro atravessa a mudança da EC 141 (16/12: 42h e 2 folgas).
    for mes in [11, 12] {
        s.gerar_mes(c, 2026, mes).expect("gerar");
    }
    s.gerar_mes(c, 2027, 1).expect("gerar");
    for (ano, mes) in [(2026, 11), (2026, 12), (2027, 1)] {
        let agenda = s.obter_agenda(c, ano, mes).expect("agenda");
        assert!(violacoes(&agenda).is_empty(), "{:?}", violacoes(&agenda));
        assert!(
            agenda.avisos.iter().all(|a| a.tipo != "funcaoDescoberta"),
            "{:?}",
            agenda
                .avisos
                .iter()
                .filter(|a| a.tipo == "funcaoDescoberta")
                .collect::<Vec<_>>()
        );
        assert_eq!(agenda.funcoes.len(), 2, "o gerente (mínimo 0) fica de fora");
        let funcao: BTreeMap<i64, Option<String>> = agenda
            .funcionarios
            .iter()
            .map(|f| (f.id, f.funcao.clone()))
            .collect();
        for dia in dias_do_mes(ano, mes) {
            for t in agenda.turnos.iter().filter(|t| !t.arquivado) {
                for chave in ["atendente", "cozinheiro"] {
                    assert!(
                        agenda.alocacoes.iter().any(|a| a.data == dia
                            && a.turno_id == t.id
                            && funcao[&a.funcionario_id].as_deref() == Some(chave)),
                        "{dia}: {} sem {chave}",
                        t.nome
                    );
                }
            }
        }
    }

    // Tirar no Quadro o único cozinheiro de um turno num dia gera o aviso da função.
    let agenda = s.obter_agenda(c, 2027, 1).expect("agenda");
    let funcao: BTreeMap<i64, Option<String>> = agenda
        .funcionarios
        .iter()
        .map(|f| (f.id, f.funcao.clone()))
        .collect();
    let dia = data(2027, 1, 13);
    let turno = agenda.turnos[0].id;
    let cozinheiros: Vec<i64> = agenda
        .alocacoes
        .iter()
        .filter(|a| {
            a.data == dia
                && a.turno_id == turno
                && funcao[&a.funcionario_id].as_deref() == Some("cozinheiro")
        })
        .map(|a| a.funcionario_id)
        .collect();
    let mut ajustada = agenda;
    for id in cozinheiros {
        ajustada = s
            .definir_dia(
                c,
                id,
                dia,
                &DiaQuadroDto {
                    tipo: "folga".into(),
                    turno_id: None,
                    justificada: None,
                    motivo: None,
                },
            )
            .expect("folga");
    }
    assert!(ajustada
        .avisos
        .iter()
        .any(|a| a.tipo == "funcaoDescoberta" && a.mensagem.contains("13/01")));
}

// ---------------------------------------------------------------------------
// Reequilibrar o resto do mês
// ---------------------------------------------------------------------------

fn dia_quadro(tipo: &str, turno: Option<i64>) -> DiaQuadroDto {
    DiaQuadroDto {
        tipo: tipo.into(),
        turno_id: turno,
        justificada: None,
        motivo: None,
    }
}

#[test]
fn reequilibrar_mantem_a_troca_feita_a_mao_e_zera_o_saldo_da_semana() {
    let mut s = servico();
    let (c, funcs) = cliente_com_loja(&mut s, "Loja Troca", &[""; 10], &[]);
    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    let agenda = s.obter_agenda(c, 2027, 2).expect("agenda");
    let dia = data(2027, 2, 9);
    // A folgava em 09/02 e passa a trabalhar; B trabalhava e passa a folgar.
    let trabalha = |id: i64| {
        agenda
            .alocacoes
            .iter()
            .any(|a| a.funcionario_id == id && a.data == dia)
    };
    let a = funcs
        .iter()
        .map(|f| f.id)
        .find(|id| !trabalha(*id))
        .expect("alguém de folga");
    let b = funcs
        .iter()
        .map(|f| f.id)
        .find(|id| trabalha(*id))
        .expect("alguém trabalhando");
    let turno = agenda.turnos[0].id;
    s.definir_dia(c, a, dia, &dia_quadro("turno", Some(turno)))
        .expect("turno");
    let editada = s
        .definir_dia(c, b, dia, &dia_quadro("folga", None))
        .expect("folga");
    assert_eq!(editada.ajustes.len(), 2);
    // Sem reequilibrar, a semana fica com +6h para A e −6h para B.
    let saldo = |ag: &AgendaMesDto, id: i64| {
        let h = semana_da_pessoa(ag, dia, id);
        i64::from(h.minutos) - i64::from(h.previsto_min)
    };
    assert_eq!((saldo(&editada, a), saldo(&editada, b)), (360, -360));

    let r = s
        .reequilibrar(c, 2027, 2, data(2027, 2, 10), false)
        .expect("reequilibrar");
    assert_eq!(r.meses.len(), 1);
    let ag = r.agenda;
    assert!(violacoes(&ag).is_empty(), "{:?}", violacoes(&ag));
    // Os dias editados ficam como estão, e a semana fecha no previsto.
    assert!(ag
        .alocacoes
        .iter()
        .any(|x| x.funcionario_id == a && x.data == dia && x.turno_id == turno));
    assert!(ag
        .alocacoes
        .iter()
        .all(|x| !(x.funcionario_id == b && x.data == dia)));
    assert_eq!(ag.ajustes.len(), 2);
    assert_eq!((saldo(&ag, a), saldo(&ag, b)), (0, 0));
    // Dias antes de 10/02 não mudam (exceto os ajustes).
    let antes = |g: &AgendaMesDto| -> BTreeSet<(i64, NaiveDate, i64)> {
        g.alocacoes
            .iter()
            .filter(|x| x.data < data(2027, 2, 10))
            .map(|x| (x.funcionario_id, x.data, x.turno_id))
            .collect()
    };
    assert_eq!(antes(&ag), antes(&editada));
    // Nenhuma pessoa termina o mês com saldo nas semanas fechadas.
    for f in &funcs {
        let total: i64 = ag
            .semanas
            .iter()
            .filter(|w| !w.pendente)
            .flat_map(|w| w.funcionarios.iter().filter(|h| h.funcionario_id == f.id))
            .map(|h| i64::from(h.minutos) - i64::from(h.previsto_min))
            .sum();
        assert_eq!(total, 0, "{}", f.nome);
    }

    // Gerar o mês de novo descarta os ajustes e as travas.
    s.gerar_mes(c, 2027, 2).expect("de novo");
    assert!(s
        .obter_agenda(c, 2027, 2)
        .expect("agenda")
        .ajustes
        .is_empty());
}

#[test]
fn reequilibrar_leva_o_saldo_para_os_meses_seguintes() {
    let mut s = servico();
    let (c, funcs) = cliente_com_loja(&mut s, "Loja Seguintes", &[""; 10], &[]);
    s.gerar_mes(c, 2027, 2).expect("fevereiro");
    s.gerar_mes(c, 2027, 3).expect("março");
    // Falta no último dia de fevereiro que alguém trabalhava: não há mais dias no mês
    // para compensar, então o saldo vai para março.
    let ultimo = data(2027, 2, 28);
    let fev = s.obter_agenda(c, 2027, 2).expect("agenda");
    let pessoa = fev
        .alocacoes
        .iter()
        .find(|x| x.data == ultimo)
        .map(|x| x.funcionario_id)
        .expect("alguém no dia 28");
    s.definir_dia(c, pessoa, ultimo, &dia_quadro("folga", None))
        .expect("folga");
    let r = s
        .reequilibrar(c, 2027, 2, ultimo, true)
        .expect("reequilibrar");
    assert_eq!(
        r.meses.iter().map(|m| (m.ano, m.mes)).collect::<Vec<_>>(),
        vec![(2027, 2), (2027, 3)]
    );
    let marco = s.obter_agenda(c, 2027, 3).expect("março");
    assert!(violacoes(&marco).is_empty(), "{:?}", violacoes(&marco));
    let anterior = marco
        .funcionarios
        .iter()
        .find(|f| f.id == pessoa)
        .map(|f| f.saldo_anterior_min);
    assert_eq!(anterior, Some(-360));
    // Março paga as 6h devidas: o saldo do mês compensa o anterior.
    let mes: i64 = marco
        .semanas
        .iter()
        .filter(|w| !w.pendente)
        .flat_map(|w| w.funcionarios.iter().filter(|h| h.funcionario_id == pessoa))
        .map(|h| i64::from(h.minutos) - i64::from(h.previsto_min))
        .sum();
    assert_eq!(mes, 360);
    let _ = funcs;
}
