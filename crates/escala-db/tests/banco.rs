//! Testes da persistência: migrações, isolamento por cliente, cascatas,
//! funcionamento e turnos gerados, preferência de período, ausências
//! (justificadas ou faltas) e marcação manual de dias.

use chrono::NaiveDate;
use escala_core::{
    Alocacao, Aviso, DiasSemana, HoraDoDia, Horario, JanelaDia, Periodo, RegimeLegal, RegrasCarga,
    TipoAviso,
};
use escala_db::{
    AcaoImportacao, Banco, ClienteRow, DadosAusencia, DadosFuncionario, DadosTurno, DiaMarcado,
    EdicaoFuncionario, ErroBanco, Funcionamento, FuncionarioRow, TurnoRow,
};

fn hora(texto: &str) -> HoraDoDia {
    texto.parse::<HoraDoDia>().expect("hora")
}

fn h(a: &str, b: &str) -> Horario {
    Horario::novo(hora(a), hora(b), 0).expect("horário")
}

fn hi(a: &str, b: &str, intervalo: u32) -> Horario {
    Horario::novo(hora(a), hora(b), intervalo).expect("horário")
}

fn turno(nome: &str) -> DadosTurno {
    DadosTurno {
        id: None,
        nome: nome.into(),
        horario: h("06:00", "14:00"),
        efetivo_minimo: 1,
        ordem: 0,
        cor: "#F2B705".into(),
        dias: DiasSemana::TODOS,
    }
}

/// Turno com nome, horário e posição na lista.
fn turno_em(nome: &str, horario: Horario, ordem: i32) -> DadosTurno {
    DadosTurno {
        horario,
        ordem,
        ..turno(nome)
    }
}

/// Dados de um turno já existente, para `aplicar_funcionamento` mantê-lo.
fn mantido(t: &TurnoRow) -> DadosTurno {
    DadosTurno {
        id: Some(t.turno.id),
        nome: t.turno.nome.clone(),
        horario: t.turno.horario,
        efetivo_minimo: t.turno.efetivo_minimo,
        ordem: t.turno.ordem,
        cor: t.cor.clone(),
        dias: t.turno.dias,
    }
}

fn janelas(dias: impl IntoIterator<Item = u8>, abre: &str, fecha: &str) -> Vec<JanelaDia> {
    dias.into_iter()
        .map(|dia| JanelaDia {
            dia,
            abre: hora(abre),
            fecha: hora(fecha),
        })
        .collect()
}

/// Loja de shopping: todos os dias das 10h às 22h, jornada de 6h com 15 min.
fn funcionamento() -> Funcionamento {
    Funcionamento {
        janelas: janelas(0..7, "10:00", "22:00"),
        jornada_min: 6 * 60,
        intervalo_min: 15,
    }
}

/// Segunda a sábado 09:00–21:00 e sábado só até 18:00, jornada de 7h com 30 min.
fn funcionamento_sem_domingo() -> Funcionamento {
    let mut j = janelas(0..5, "09:00", "21:00");
    j.extend(janelas([5], "09:00", "18:00"));
    Funcionamento {
        janelas: j,
        jornada_min: 7 * 60,
        intervalo_min: 30,
    }
}

fn d(dia: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 3, dia).expect("data")
}

fn abril(dia: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 4, dia).expect("data")
}

fn novo_cliente(b: &mut Banco, nome: &str, turnos: &[DadosTurno]) -> ClienteRow {
    b.criar_cliente(
        nome,
        &RegrasCarga::default(),
        &RegimeLegal::Livre,
        &funcionamento(),
        turnos,
    )
    .expect("cliente")
}

fn func(matricula: &str) -> DadosFuncionario {
    DadosFuncionario {
        matricula: matricula.into(),
        nome: format!("Func {matricula}"),
        cargo: None,
        ctps: None,
        secao: None,
        carga_semanal_min: None,
        preferencia: None,
    }
}

/// Importa os funcionários e devolve as linhas gravadas, na ordem das matrículas informadas.
fn importar(b: &mut Banco, cliente: i64, dados: &[DadosFuncionario]) -> Vec<FuncionarioRow> {
    b.gravar_importacao(cliente, dados, &[]).expect("importar");
    let todos = b.funcionarios(cliente).expect("funcionários");
    dados
        .iter()
        .map(|dado| {
            todos
                .iter()
                .find(|f| f.matricula == dado.matricula)
                .expect("gravado")
                .clone()
        })
        .collect()
}

fn alocacao(funcionario_id: i64, turno_id: i64, data: NaiveDate, horario: Horario) -> Alocacao {
    Alocacao {
        funcionario_id,
        turno_id,
        data,
        horario,
    }
}

fn aviso(tipo: TipoAviso, data: NaiveDate, turno_id: Option<i64>, mensagem: &str) -> Aviso {
    Aviso {
        tipo,
        data: Some(data),
        turno_id,
        funcionario_id: None,
        mensagem: mensagem.into(),
    }
}

fn gerar_marco(b: &mut Banco, cliente: i64, alocacoes: &[Alocacao], avisos: &[Aviso]) {
    b.substituir_mes(cliente, 2026, 3, d(1), d(31), alocacoes, avisos)
        .expect("mês");
}

fn remover_banco(caminho: &std::path::Path) {
    for sufixo in ["", "-wal", "-shm"] {
        let _ = std::fs::remove_file(format!("{}{sufixo}", caminho.display()));
    }
}

fn user_version(caminho: &std::path::Path) -> i64 {
    let conn = rusqlite::Connection::open(caminho).expect("conexão");
    conn.pragma_query_value(None, "user_version", |l| l.get(0))
        .expect("user_version")
}

fn caminho_temporario(nome: &str) -> std::path::PathBuf {
    let caminho =
        std::env::temp_dir().join(format!("escalas_db_{nome}_{}.sqlite3", std::process::id()));
    remover_banco(&caminho);
    caminho
}

// ---------------------------------------------------------------------- clientes e cascatas

#[test]
fn migracao_e_idempotente_em_arquivo() {
    let caminho = caminho_temporario("idempotente");
    {
        let mut b = Banco::abrir(&caminho).expect("abrir");
        novo_cliente(&mut b, "A", &[turno("Manhã")]);
    }
    let b = Banco::abrir(&caminho).expect("reabrir");
    assert_eq!(b.listar_clientes().expect("lista").len(), 1);
    drop(b);
    remover_banco(&caminho);
}

#[test]
fn dados_isolados_por_cliente_e_exclusao_em_cascata() {
    let mut b = Banco::em_memoria().expect("banco");
    let a = novo_cliente(&mut b, "A", &[turno("Manhã")]);
    let outro = novo_cliente(&mut b, "B", &[turno("Manhã")]);
    assert!(matches!(
        b.criar_cliente(
            "a",
            &RegrasCarga::default(),
            &RegimeLegal::Livre,
            &funcionamento(),
            &[]
        ),
        Err(ErroBanco::Conflito(_))
    ));

    let manha_a = b.turnos(a.id).expect("turnos")[0].turno.id;
    let manha_b = b.turnos(outro.id).expect("turnos")[0].turno.id;
    assert_ne!(manha_a, manha_b);
    let com_carga = |m: &str| DadosFuncionario {
        ctps: Some(format!("000{m}/001")),
        carga_semanal_min: Some(30 * 60),
        preferencia: Some(Periodo::Tarde),
        ..func(m)
    };
    b.gravar_importacao(
        a.id,
        &[com_carga("1")],
        &[DadosAusencia {
            matricula: "1".into(),
            inicio: d(2),
            fim: d(4),
            motivo: None,
            justificada: false,
        }],
    )
    .expect("importar a");
    // Mesma matrícula em outro cliente é outro funcionário.
    b.gravar_importacao(outro.id, &[com_carga("1")], &[])
        .expect("importar b");
    // Ausência de matrícula que não existe no cliente é recusada e não grava nada.
    let erro = b
        .gravar_importacao(
            a.id,
            &[com_carga("2")],
            &[DadosAusencia {
                matricula: "999".into(),
                inicio: d(2),
                fim: d(2),
                motivo: None,
                justificada: true,
            }],
        )
        .expect_err("matrícula da ausência desconhecida");
    assert!(matches!(erro, ErroBanco::NaoEncontrado(_)), "{erro}");
    assert_eq!(b.funcionarios(a.id).expect("funcionários").len(), 1);

    let fa = b.funcionarios(a.id).expect("funcionários");
    assert_eq!(fa.len(), 1);
    assert_eq!(fa[0].carga_semanal_min, Some(1800));
    assert_eq!(fa[0].preferencia, Some(Periodo::Tarde));
    assert_eq!(fa[0].ausencias.len(), 1);
    assert!(
        !fa[0].ausencias[0].justificada,
        "a falta gravada volta como não justificada"
    );

    let a1 = alocacao(fa[0].id, manha_a, d(10), h("07:00", "13:00"));
    gerar_marco(&mut b, a.id, &[a1], &[]);
    assert!(matches!(
        b.excluir_turno(a.id, manha_a),
        Err(ErroBanco::Conflito(_))
    ));
    assert!(
        b.substituir_mes(a.id, 2026, 3, d(1), d(9), &[a1], &[])
            .is_err(),
        "alocação fora do intervalo"
    );
    assert_eq!(
        b.alocacoes(a.id, d(1), d(31)).expect("alocações").len(),
        1,
        "transação recusada não altera nada"
    );

    b.excluir_cliente(a.id).expect("excluir");
    assert!(b.funcionarios(a.id).expect("vazio").is_empty());
    assert!(b.meses(a.id).expect("vazio").is_empty());
    assert!(b.turnos(a.id).expect("vazio").is_empty());
    assert!(
        b.funcionamento(a.id).is_err(),
        "funcionamento sai junto com o cliente"
    );
    assert_eq!(b.funcionarios(outro.id).expect("b intacto").len(), 1);
    assert_eq!(b.turnos(outro.id).expect("b intacto").len(), 1);
    assert_eq!(
        b.funcionamento(outro.id).expect("b intacto"),
        funcionamento()
    );
}

#[test]
fn dias_de_funcionamento_do_turno_sao_gravados_e_lidos() {
    let mut b = Banco::em_memoria().expect("banco");
    let c = novo_cliente(
        &mut b,
        "A",
        &[DadosTurno {
            dias: DiasSemana::de_indices([0, 1, 2, 3, 4]),
            ..turno("Comercial")
        }],
    );
    let lido = b.turnos(c.id).expect("turnos");
    assert_eq!(lido[0].turno.dias.indices(), vec![0, 1, 2, 3, 4]);
    assert!(!lido[0].arquivado, "turno novo não nasce arquivado");

    // Inserção e atualização gravam a coluna.
    let novo = b
        .salvar_turno(
            c.id,
            &DadosTurno {
                dias: DiasSemana::de_indices([5, 6]),
                ..turno("Plantão")
            },
        )
        .expect("novo");
    assert_eq!(novo.turno.dias.indices(), vec![5, 6]);
    assert!(!novo.arquivado);
    b.salvar_turno(
        c.id,
        &DadosTurno {
            id: Some(novo.turno.id),
            dias: DiasSemana::de_indices([0, 6]),
            ..turno("Plantão")
        },
    )
    .expect("atualizado");
    let lido = b.turnos(c.id).expect("turnos");
    let plantao = lido
        .iter()
        .find(|t| t.turno.nome == "Plantão")
        .expect("turno");
    assert_eq!(plantao.turno.dias.indices(), vec![0, 6]);

    // Turno sem nenhum dia é recusado com mensagem clara.
    let vazio = DadosTurno {
        dias: DiasSemana::NENHUM,
        ..turno("Fantasma")
    };
    let erro = b.salvar_turno(c.id, &vazio).expect_err("sem dias");
    assert!(erro.to_string().contains("ao menos um dia"), "{erro}");
    assert!(b
        .criar_cliente(
            "B",
            &RegrasCarga::default(),
            &RegimeLegal::Livre,
            &funcionamento(),
            &[vazio]
        )
        .is_err());
    assert!(
        b.listar_clientes()
            .expect("lista")
            .iter()
            .all(|c| c.nome != "B"),
        "criação recusada não deixa o cliente pela metade"
    );
}

#[test]
fn regras_novas_e_regime_sao_gravados_e_lidos() {
    let mut b = Banco::em_memoria().expect("banco");
    let publicacao = NaiveDate::from_ymd_opt(2026, 10, 16).expect("data");
    let regras = RegrasCarga {
        folgas_semanais_min: 2,
        domingos_seguidos_max: 2,
        ..RegrasCarga::default()
    };
    let c = b
        .criar_cliente(
            "Farmácia",
            &regras,
            &RegimeLegal::Ec141 { publicacao },
            &funcionamento(),
            &[turno("Comercial")],
        )
        .expect("cliente");
    assert_eq!(b.regras(c.id).expect("regras"), regras);
    assert_eq!(
        b.regime(c.id).expect("regime"),
        RegimeLegal::Ec141 { publicacao }
    );
    b.salvar_regime(c.id, &RegimeLegal::Livre).expect("salvar");
    assert_eq!(b.regime(c.id).expect("regime"), RegimeLegal::Livre);
    assert!(b.salvar_regime(9999, &RegimeLegal::Livre).is_err());

    // Salvar as regras não mexe no funcionamento (mesma linha da tabela `regras`).
    let novas = RegrasCarga {
        carga_semanal_max_min: 44 * 60,
        ..regras
    };
    b.salvar_regras(c.id, &novas).expect("regras");
    assert_eq!(b.regras(c.id).expect("regras"), novas);
    assert_eq!(
        b.funcionamento(c.id).expect("funcionamento"),
        funcionamento()
    );
    assert_eq!(
        b.regime(c.id).expect("regime"),
        RegimeLegal::Livre,
        "regime também sobrevive"
    );
}

// ---------------------------------------------------------------------- migrações

#[test]
fn banco_na_versao_1_migra_ate_a_versao_atual_com_turnos_em_todos_os_dias() {
    let caminho = caminho_temporario("v1");
    {
        let mut b = Banco::abrir(&caminho).expect("abrir");
        b.criar_cliente(
            "A",
            &RegrasCarga::default(),
            &RegimeLegal::Livre,
            &Funcionamento {
                janelas: janelas(0..5, "08:00", "20:00"),
                jornada_min: 7 * 60,
                intervalo_min: 60,
            },
            &[DadosTurno {
                dias: DiasSemana::de_indices([0, 1, 2, 3, 4]),
                ..turno("Comercial")
            }],
        )
        .expect("cliente");
    }
    assert_eq!(user_version(&caminho), 10);

    // Volta o arquivo ao esquema da versão 1: sem a coluna `dias_semana` nem
    // nada do que as versões 3 a 6 acrescentaram.
    {
        let conn = rusqlite::Connection::open(&caminho).expect("conexão");
        conn.execute_batch(
            "DROP TABLE funcionamento;
             ALTER TABLE regras DROP COLUMN jornada_padrao_min;
             ALTER TABLE regras DROP COLUMN intervalo_padrao_min;
             ALTER TABLE turnos DROP COLUMN arquivado;
             ALTER TABLE funcionarios DROP COLUMN preferencia;
             ALTER TABLE turnos DROP COLUMN dias_semana;
             ALTER TABLE regras DROP COLUMN folgas_semanais_min;
             ALTER TABLE regras DROP COLUMN domingos_seguidos_max;
             ALTER TABLE regras DROP COLUMN regime;
             ALTER TABLE regras DROP COLUMN ec141_publicacao;
             ALTER TABLE funcionarios DROP COLUMN ctps;
             ALTER TABLE funcionarios DROP COLUMN secao;
             ALTER TABLE funcionario_turnos DROP COLUMN preferido;
             ALTER TABLE ausencias DROP COLUMN justificada;
             DROP TABLE previsto_semanas;
             ALTER TABLE regras DROP COLUMN modelo;
             DROP TABLE funcoes_minimas;
             DROP TABLE ajustes_manuais;
             PRAGMA user_version = 1;",
        )
        .expect("rebaixar para v1");
    }
    assert_eq!(user_version(&caminho), 1);

    // Reabrir aplica as migrações 2 a 6: os turnos existentes passam a funcionar
    // todos os dias, nenhum nasce arquivado e o cliente fica sem funcionamento
    // configurado (com a jornada padrão da migração).
    let b = Banco::abrir(&caminho).expect("reabrir migra");
    let cliente = b.listar_clientes().expect("clientes")[0].id;
    let turnos = b.turnos(cliente).expect("turnos");
    assert_eq!(turnos.len(), 1);
    assert_eq!(turnos[0].turno.dias, DiasSemana::TODOS);
    assert_eq!(turnos[0].turno.dias.bits(), 127);
    assert!(!turnos[0].arquivado);
    let f = b.funcionamento(cliente).expect("funcionamento");
    assert!(f.janelas.is_empty(), "cliente antigo sem janelas");
    assert_eq!((f.jornada_min, f.intervalo_min), (360, 15));
    assert_eq!(
        b.regras(cliente).expect("regras"),
        RegrasCarga::default(),
        "regras novas com o padrão"
    );
    drop(b);
    assert_eq!(user_version(&caminho), 10);

    // Reabrir de novo não migra nada (idempotente).
    let b = Banco::abrir(&caminho).expect("reabrir de novo");
    assert_eq!(b.turnos(cliente).expect("turnos").len(), 1);
    drop(b);
    remover_banco(&caminho);
}

#[test]
fn banco_na_versao_4_converte_o_horario_preferido_em_preferencia_de_periodo() {
    let caminho = caminho_temporario("v4");
    let (cliente, turnos, funcs) = {
        let mut b = Banco::abrir(&caminho).expect("abrir");
        let c = novo_cliente(
            &mut b,
            "Loja",
            &[
                turno_em("Cedo", h("06:00", "12:00"), 0),
                turno_em("Tarde", h("14:00", "20:00"), 1),
                turno_em("Noite", h("18:00", "23:00"), 2),
                turno_em("Fecha", h("22:00", "04:00"), 3),
            ],
        );
        let turnos = b.turnos(c.id).expect("turnos");
        let ids: Vec<i64> = turnos.iter().map(|t| t.turno.id).collect();
        let funcs = importar(
            &mut b,
            c.id,
            &(1..=10).map(|m| func(&m.to_string())).collect::<Vec<_>>(),
        );
        (c.id, ids, funcs.iter().map(|f| f.id).collect::<Vec<_>>())
    };
    let (cedo, tarde, noite, fecha) = (turnos[0], turnos[1], turnos[2], turnos[3]);
    assert_eq!(user_version(&caminho), 10);

    // Volta ao esquema da versão 4: sem os objetos da 5 e da 6, com o horário
    // preferido gravado no formato antigo (`funcionario_turnos.preferido`).
    {
        let conn = rusqlite::Connection::open(&caminho).expect("conexão");
        // (funcionário, turno, preferido, horário próprio de início)
        let linhas: [(i64, i64, i64, Option<u32>); 12] = [
            (funcs[0], tarde, 1, None), // 14:00 -> tarde
            (funcs[1], cedo, 1, None),  // 06:00 -> manhã
            (funcs[2], fecha, 1, None), // 22:00 -> noite
            (funcs[3], cedo, 0, None),  // só opções, nenhuma preferida -> sem preferência
            (funcs[3], tarde, 0, None),
            (funcs[4], cedo, 1, Some(13 * 60)), // horário próprio às 13:00 vale mais que o do turno
            (funcs[5], noite, 1, None),         // 18:00 -> noite (limite)
            // funcs[6] não tem nenhum turno -> sem preferência
            (funcs[7], tarde, 1, None), // duas preferidas: vale a de menor ordem
            (funcs[7], cedo, 1, None),
            (funcs[5], tarde, 0, None),
            (funcs[8], cedo, 1, Some(4 * 60 + 59)), // 04:59 -> noite (antes das 5h)
            (funcs[9], cedo, 1, Some(5 * 60)),      // 05:00 -> manhã
        ];
        for (f, t, pref, inicio) in linhas {
            conn.execute(
                "INSERT INTO funcionario_turnos (funcionario_id, turno_id, preferido, inicio_min, fim_min, intervalo_min)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![f, t, pref, inicio, inicio.map(|i| i + 360), inicio.map(|_| 0)],
            )
            .expect("funcionario_turnos");
        }
        conn.execute_batch(
            "DROP TABLE funcionamento;
             ALTER TABLE regras DROP COLUMN jornada_padrao_min;
             ALTER TABLE regras DROP COLUMN intervalo_padrao_min;
             ALTER TABLE turnos DROP COLUMN arquivado;
             ALTER TABLE funcionarios DROP COLUMN preferencia;
             ALTER TABLE ausencias DROP COLUMN justificada;
             DROP TABLE previsto_semanas;
             ALTER TABLE regras DROP COLUMN modelo;
             DROP TABLE funcoes_minimas;
             DROP TABLE ajustes_manuais;
             PRAGMA user_version = 4;",
        )
        .expect("rebaixar para v4");
    }
    assert_eq!(user_version(&caminho), 4);

    let b = Banco::abrir(&caminho).expect("reabrir migra");
    let lidos = b.funcionarios(cliente).expect("funcionários");
    let pref = |m: &str| {
        lidos
            .iter()
            .find(|f| f.matricula == m)
            .expect("funcionário")
            .preferencia
    };
    assert_eq!(pref("1"), Some(Periodo::Tarde), "preferido às 14:00");
    assert_eq!(pref("2"), Some(Periodo::Manha));
    assert_eq!(pref("3"), Some(Periodo::Noite));
    assert_eq!(pref("4"), None, "sem horário preferido");
    assert_eq!(pref("5"), Some(Periodo::Tarde), "horário próprio às 13:00");
    assert_eq!(pref("6"), Some(Periodo::Noite), "18:00 já é noite");
    assert_eq!(pref("7"), None, "sem turnos");
    assert_eq!(
        pref("8"),
        Some(Periodo::Manha),
        "vale o turno de menor ordem"
    );
    assert_eq!(
        pref("9"),
        Some(Periodo::Noite),
        "04:59: antes das 5h é noite"
    );
    assert_eq!(pref("10"), Some(Periodo::Manha), "05:00 já é manhã");

    // O resto do banco passa a ter os objetos novos, sem mexer no que existia.
    let f = b.funcionamento(cliente).expect("funcionamento");
    assert!(f.janelas.is_empty());
    assert_eq!((f.jornada_min, f.intervalo_min), (360, 15));
    let turnos = b.turnos(cliente).expect("turnos");
    assert_eq!(turnos.len(), 4);
    assert!(turnos.iter().all(|t| !t.arquivado));
    drop(b);
    assert_eq!(user_version(&caminho), 10);
    remover_banco(&caminho);
}

#[test]
fn banco_na_versao_5_migra_para_a_6_com_as_ausencias_justificadas() {
    let caminho = caminho_temporario("v5");
    let (cliente, ana, bia) = {
        let mut b = Banco::abrir(&caminho).expect("abrir");
        let c = novo_cliente(&mut b, "Loja", &[turno("Manhã")]);
        let pessoas = importar(&mut b, c.id, &[func("1"), func("2")]);
        b.gravar_importacao(
            c.id,
            &[],
            &[
                DadosAusencia {
                    matricula: "1".into(),
                    inicio: d(2),
                    fim: d(6),
                    motivo: Some("Férias".into()),
                    justificada: true,
                },
                DadosAusencia {
                    matricula: "2".into(),
                    inicio: d(9),
                    fim: d(9),
                    motivo: Some("Falta".into()),
                    justificada: false,
                },
            ],
        )
        .expect("ausências");
        (c.id, pessoas[0].id, pessoas[1].id)
    };
    assert_eq!(user_version(&caminho), 10);

    // Volta ao esquema da versão 5: sem a coluna `justificada`, de modo que as
    // ausências são só período e motivo (a falta gravada acima perde a marca).
    {
        let conn = rusqlite::Connection::open(&caminho).expect("conexão");
        conn.execute_batch(
            "ALTER TABLE ausencias DROP COLUMN justificada;
             DROP TABLE previsto_semanas;
             ALTER TABLE regras DROP COLUMN modelo;
             DROP TABLE funcoes_minimas;
             DROP TABLE ajustes_manuais;
             PRAGMA user_version = 5;",
        )
        .expect("rebaixar para v5");
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM ausencias", [], |l| l.get(0))
            .expect("contar");
        assert_eq!(n, 2, "as ausências sobrevivem ao rebaixamento");
    }
    assert_eq!(user_version(&caminho), 5);

    // Reabrir aplica a migração 6: toda ausência já gravada vem da importação
    // (férias, afastamentos) e passa a ser justificada; nada mais muda.
    let mut b = Banco::abrir(&caminho).expect("reabrir migra");
    let lidos = b.funcionarios(cliente).expect("funcionários");
    let ausencias_de = |id: i64| {
        lidos
            .iter()
            .find(|f| f.id == id)
            .expect("funcionário")
            .ausencias
            .clone()
    };
    let da_ana = ausencias_de(ana);
    assert_eq!(da_ana.len(), 1);
    assert_eq!((da_ana[0].inicio, da_ana[0].fim), (d(2), d(6)));
    assert_eq!(da_ana[0].motivo.as_deref(), Some("Férias"));
    assert!(da_ana[0].justificada);
    let da_bia = ausencias_de(bia);
    assert_eq!(da_bia.len(), 1);
    assert_eq!((da_bia[0].inicio, da_bia[0].fim), (d(9), d(9)));
    assert_eq!(da_bia[0].motivo.as_deref(), Some("Falta"));
    assert!(
        da_bia[0].justificada,
        "ausência anterior à migração vira justificada"
    );

    // Depois de migrado, o banco já grava faltas normalmente.
    b.gravar_importacao(
        cliente,
        &[],
        &[DadosAusencia {
            matricula: "2".into(),
            inicio: d(10),
            fim: d(10),
            motivo: None,
            justificada: false,
        }],
    )
    .expect("falta nova");
    let da_bia = b.funcionarios(cliente).expect("funcionários")[1]
        .ausencias
        .clone();
    assert_eq!(da_bia.len(), 1, "a importação substitui as ausências");
    assert!(!da_bia[0].justificada);
    drop(b);
    assert_eq!(user_version(&caminho), 10);

    // Reabrir de novo não migra nada nem mexe nas ausências.
    let b = Banco::abrir(&caminho).expect("reabrir de novo");
    assert_eq!(b.funcionarios(cliente).expect("funcionários").len(), 2);
    drop(b);
    remover_banco(&caminho);
}

#[test]
fn banco_de_versao_futura_e_recusado() {
    let caminho = caminho_temporario("futuro");
    {
        let mut b = Banco::abrir(&caminho).expect("abrir");
        novo_cliente(&mut b, "A", &[turno("Manhã")]);
    }
    {
        let conn = rusqlite::Connection::open(&caminho).expect("conexão");
        conn.execute_batch("PRAGMA user_version = 99;")
            .expect("versão futura");
    }
    let erro = Banco::abrir(&caminho)
        .err()
        .expect("deve recusar um banco mais novo");
    assert!(
        matches!(erro, ErroBanco::VersaoFutura { banco: 99, app: 10 }),
        "{erro}"
    );
    assert_eq!(user_version(&caminho), 99, "nada é alterado");
    remover_banco(&caminho);
}

// ---------------------------------------------------------------------- funcionamento

#[test]
fn funcionamento_e_gravado_e_lido_por_cliente() {
    let mut b = Banco::em_memoria().expect("banco");
    let regras = RegrasCarga::default();
    let sem_domingo = funcionamento_sem_domingo();
    let a = b
        .criar_cliente(
            "A",
            &regras,
            &RegimeLegal::Livre,
            &sem_domingo,
            &[turno("Manhã")],
        )
        .expect("a");
    let outro = novo_cliente(&mut b, "B", &[turno("Manhã")]);

    let lido = b.funcionamento(a.id).expect("funcionamento");
    assert_eq!(lido, sem_domingo);
    assert_eq!(lido.janelas.len(), 6, "domingo fechado = sem janela");
    assert_eq!(
        lido.janelas.iter().map(|j| j.dia).collect::<Vec<_>>(),
        vec![0, 1, 2, 3, 4, 5],
        "ordenado por dia"
    );
    assert_eq!(
        (lido.janelas[5].abre, lido.janelas[5].fecha),
        (hora("09:00"), hora("18:00")),
        "sábado com horário próprio"
    );
    assert_eq!((lido.jornada_min, lido.intervalo_min), (7 * 60, 30));
    assert_eq!(
        b.funcionamento(outro.id).expect("outro"),
        funcionamento(),
        "cada cliente tem o seu"
    );
    assert!(matches!(
        b.funcionamento(9999),
        Err(ErroBanco::NaoEncontrado(_))
    ));

    // Janela que atravessa a meia-noite (fecha de madrugada) também é guardada.
    let noturno = Funcionamento {
        janelas: janelas([4, 5], "18:00", "02:00"),
        jornada_min: 6 * 60,
        intervalo_min: 0,
    };
    b.aplicar_funcionamento(a.id, &noturno, &[turno("Noite")])
        .expect("aplicar");
    assert_eq!(b.funcionamento(a.id).expect("funcionamento"), noturno);
    assert_eq!(
        b.funcionamento(outro.id).expect("outro"),
        funcionamento(),
        "o outro cliente não muda"
    );

    // Dia repetido, jornada e intervalo fora do permitido: recusados sem efeito.
    let mut repetido = funcionamento();
    repetido.janelas.push(repetido.janelas[0]);
    assert!(matches!(
        b.criar_cliente("C", &regras, &RegimeLegal::Livre, &repetido, &[]),
        Err(ErroBanco::Conflito(_))
    ));
    for ruim in [
        Funcionamento {
            jornada_min: 30,
            ..funcionamento()
        },
        Funcionamento {
            jornada_min: 13 * 60,
            ..funcionamento()
        },
        Funcionamento {
            intervalo_min: 121,
            ..funcionamento()
        },
    ] {
        assert!(
            b.criar_cliente("C", &regras, &RegimeLegal::Livre, &ruim, &[])
                .is_err(),
            "{ruim:?}"
        );
    }
    assert!(
        b.listar_clientes()
            .expect("lista")
            .iter()
            .all(|c| c.nome != "C"),
        "criação recusada não deixa o cliente pela metade"
    );
    assert!(b
        .aplicar_funcionamento(a.id, &repetido, &[turno("Manhã")])
        .is_err());
    assert_eq!(
        b.funcionamento(a.id).expect("funcionamento"),
        noturno,
        "falha ao aplicar desfaz tudo"
    );
}

#[test]
fn aplicar_funcionamento_mantem_atualiza_insere_arquiva_e_exclui() {
    let mut b = Banco::em_memoria().expect("banco");
    let c = novo_cliente(
        &mut b,
        "Loja",
        &[
            turno_em("Manhã", h("10:00", "16:15"), 0),
            turno_em("Tarde", h("15:45", "22:00"), 1),
            turno_em("Noite", h("18:00", "23:45"), 2),
        ],
    );
    let antes = b.turnos(c.id).expect("turnos");
    let (manha, tarde, noite) = (&antes[0], &antes[1], &antes[2]);
    let ana = importar(&mut b, c.id, &[func("1")])[0].id;
    // A "Tarde" está em uso numa escala gerada; a "Noite" não.
    gerar_marco(
        &mut b,
        c.id,
        &[alocacao(ana, tarde.turno.id, d(10), h("15:45", "22:00"))],
        &[],
    );

    let novo = funcionamento_sem_domingo();
    let resultado = b
        .aplicar_funcionamento(
            c.id,
            &novo,
            &[
                // Mantida: atualiza horário, dias, cor e efetivo mínimo.
                DadosTurno {
                    horario: hi("09:00", "16:30", 30),
                    efetivo_minimo: 2,
                    cor: "#123ABC".into(),
                    dias: DiasSemana::de_indices([0, 1, 2, 3, 4, 5]),
                    ..mantido(manha)
                },
                // Nova.
                turno_em("Extra", h("12:00", "19:30"), 1),
            ],
        )
        .expect("aplicar");
    assert_eq!(resultado, b.turnos(c.id).expect("turnos"));
    assert_eq!(b.funcionamento(c.id).expect("funcionamento"), novo);

    let ativos: Vec<&TurnoRow> = resultado.iter().filter(|t| !t.arquivado).collect();
    assert_eq!(
        ativos
            .iter()
            .map(|t| t.turno.nome.as_str())
            .collect::<Vec<_>>(),
        vec!["Manhã", "Extra"]
    );
    assert_eq!(
        ativos[0].turno.id, manha.turno.id,
        "a mantida conserva o id"
    );
    assert_eq!(ativos[0].turno.horario, hi("09:00", "16:30", 30));
    assert_eq!(ativos[0].turno.efetivo_minimo, 2);
    assert_eq!(ativos[0].cor, "#123ABC");
    assert_eq!(ativos[0].turno.dias.indices(), vec![0, 1, 2, 3, 4, 5]);
    assert_ne!(ativos[1].turno.id, tarde.turno.id);
    assert_eq!(ativos[1].turno.horario, h("12:00", "19:30"));

    // A em uso é arquivada e renomeada; a sem uso some; os arquivados vêm por último.
    assert_eq!(resultado.len(), 3);
    let arquivado = &resultado[2];
    assert!(arquivado.arquivado);
    assert_eq!(arquivado.turno.id, tarde.turno.id);
    assert_eq!(arquivado.turno.nome, "Tarde (antigo 15:45)");
    assert_eq!(
        arquivado.turno.horario,
        h("15:45", "22:00"),
        "horário do arquivado não muda"
    );
    assert!(
        resultado.iter().all(|t| t.turno.nome != noite.turno.nome),
        "turno sem alocações é excluído"
    );
    // A escala antiga continua apontando para o turno arquivado.
    assert_eq!(b.alocacoes_do_turno(c.id, tarde.turno.id).expect("uso"), 1);
    let alocadas = b.alocacoes(c.id, d(1), d(31)).expect("alocações");
    assert_eq!(alocadas.len(), 1);
    assert_eq!(alocadas[0].alocacao.turno_id, tarde.turno.id);

    // Aplicar de novo: o arquivado com uso continua como está (não é renomeado outra vez).
    let ids_ativos: Vec<DadosTurno> = ativos.iter().map(|t| mantido(t)).collect();
    let de_novo = b
        .aplicar_funcionamento(c.id, &novo, &ids_ativos)
        .expect("de novo");
    assert_eq!(de_novo, resultado);

    // Sem alocações o arquivado é excluído na aplicação seguinte.
    b.excluir_mes(c.id, 2026, 3, d(1), d(31))
        .expect("excluir mês");
    let limpo = b
        .aplicar_funcionamento(c.id, &novo, &ids_ativos)
        .expect("limpar");
    assert_eq!(limpo.len(), 2);
    assert!(limpo.iter().all(|t| !t.arquivado));
}

#[test]
fn aplicar_funcionamento_troca_nomes_entre_turnos_mantidos() {
    let mut b = Banco::em_memoria().expect("banco");
    let c = novo_cliente(
        &mut b,
        "Loja",
        &[
            turno_em("Manhã", h("10:00", "16:15"), 0),
            turno_em("Tarde", h("15:45", "22:00"), 1),
        ],
    );
    let antes = b.turnos(c.id).expect("turnos");
    let (manha, tarde) = (&antes[0], &antes[1]);

    // Direto, trocar os nomes bate na UNIQUE(cliente_id, nome).
    let erro = b
        .salvar_turno(
            c.id,
            &DadosTurno {
                nome: "Tarde".into(),
                ..mantido(manha)
            },
        )
        .expect_err("nome repetido");
    assert!(matches!(erro, ErroBanco::Conflito(_)), "{erro}");

    // Aplicando o funcionamento, os nomes podem trocar entre os mantidos.
    let resultado = b
        .aplicar_funcionamento(
            c.id,
            &funcionamento(),
            &[
                DadosTurno {
                    nome: "Tarde".into(),
                    ..mantido(manha)
                },
                DadosTurno {
                    nome: "Manhã".into(),
                    ..mantido(tarde)
                },
            ],
        )
        .expect("troca de nomes");
    assert_eq!(resultado.len(), 2);
    let por_id = |id: i64| resultado.iter().find(|t| t.turno.id == id).expect("turno");
    assert_eq!(por_id(manha.turno.id).turno.nome, "Tarde");
    assert_eq!(por_id(tarde.turno.id).turno.nome, "Manhã");
    assert!(resultado.iter().all(|t| !t.arquivado));
    // Mesmo com nomes em outra caixa: o nome é único sem diferenciar maiúsculas.
    let erro = b
        .aplicar_funcionamento(
            c.id,
            &funcionamento(),
            &[
                DadosTurno {
                    nome: "turno".into(),
                    ..mantido(manha)
                },
                DadosTurno {
                    nome: "TURNO".into(),
                    ..mantido(tarde)
                },
            ],
        )
        .expect_err("nomes iguais");
    assert!(matches!(erro, ErroBanco::Conflito(_)), "{erro}");
    assert_eq!(
        b.turnos(c.id).expect("turnos"),
        resultado,
        "falha desfaz a troca inteira"
    );
}

#[test]
fn aplicar_funcionamento_nomes_de_arquivados_e_turnos_reativados() {
    let mut b = Banco::em_memoria().expect("banco");
    let c = novo_cliente(
        &mut b,
        "Loja",
        &[
            turno_em("Manhã", h("10:00", "16:15"), 0),
            turno_em("Tarde", h("15:45", "22:00"), 1),
        ],
    );
    let antes = b.turnos(c.id).expect("turnos");
    let (manha, tarde) = (antes[0].clone(), antes[1].clone());
    let ana = importar(&mut b, c.id, &[func("1")])[0].id;
    gerar_marco(
        &mut b,
        c.id,
        &[
            alocacao(ana, manha.turno.id, d(9), h("10:00", "16:15")),
            alocacao(ana, tarde.turno.id, d(10), h("15:45", "22:00")),
        ],
        &[],
    );

    // 1) A "Tarde" sai: fica arquivada, liberando o nome para um turno novo igual.
    let r = b
        .aplicar_funcionamento(
            c.id,
            &funcionamento(),
            &[mantido(&manha), turno_em("Tarde", h("15:45", "22:00"), 1)],
        )
        .expect("nova Tarde");
    let nova_tarde = r
        .iter()
        .find(|t| !t.arquivado && t.turno.nome == "Tarde")
        .expect("tarde nova")
        .clone();
    assert_ne!(nova_tarde.turno.id, tarde.turno.id, "é outro turno");
    let velha = r
        .iter()
        .find(|t| t.turno.id == tarde.turno.id)
        .expect("velha");
    assert!(velha.arquivado);
    assert_eq!(velha.turno.nome, "Tarde (antigo 15:45)");

    // 2) A nova também sai, já usada na escala: o nome "(antigo 15:45)" está
    //    ocupado e o seguinte ganha sufixo.
    gerar_marco(
        &mut b,
        c.id,
        &[
            alocacao(ana, manha.turno.id, d(9), h("10:00", "16:15")),
            alocacao(ana, nova_tarde.turno.id, d(10), h("15:45", "22:00")),
            alocacao(ana, tarde.turno.id, d(11), h("15:45", "22:00")),
        ],
        &[],
    );
    let r = b
        .aplicar_funcionamento(c.id, &funcionamento(), &[mantido(&manha)])
        .expect("arquivar a segunda");
    let nomes: Vec<(&str, bool)> = r
        .iter()
        .map(|t| (t.turno.nome.as_str(), t.arquivado))
        .collect();
    assert_eq!(
        nomes,
        vec![
            ("Manhã", false),
            ("Tarde (antigo 15:45)", true),
            ("Tarde (antigo 15:45) (2)", true),
        ]
    );

    // 3) Um arquivado volta a ser usado quando o funcionamento o inclui de novo.
    let reativado = r
        .iter()
        .find(|t| t.turno.id == tarde.turno.id)
        .expect("arquivado");
    let r = b
        .aplicar_funcionamento(
            c.id,
            &funcionamento(),
            &[
                mantido(&manha),
                DadosTurno {
                    nome: "Tarde".into(),
                    ..mantido(reativado)
                },
            ],
        )
        .expect("reativar");
    let de_volta = r
        .iter()
        .find(|t| t.turno.id == tarde.turno.id)
        .expect("reativado");
    assert!(!de_volta.arquivado);
    assert_eq!(de_volta.turno.nome, "Tarde");
    assert_eq!(
        r.iter().filter(|t| t.arquivado).count(),
        1,
        "a outra continua arquivada"
    );
    assert_eq!(
        r.iter().position(|t| t.arquivado),
        Some(2),
        "arquivados no fim da lista"
    );
}

#[test]
fn aplicar_funcionamento_recusa_dados_invalidos_e_desfaz_tudo() {
    let mut b = Banco::em_memoria().expect("banco");
    let c = novo_cliente(&mut b, "A", &[turno("Manhã")]);
    let outro = novo_cliente(&mut b, "B", &[turno("Manhã")]);
    let turno_a = b.turnos(c.id).expect("turnos")[0].clone();
    let turno_b = b.turnos(outro.id).expect("turnos")[0].clone();
    let ana = importar(&mut b, c.id, &[func("1")])[0].id;
    gerar_marco(
        &mut b,
        c.id,
        &[alocacao(ana, turno_a.turno.id, d(3), h("06:00", "14:00"))],
        &[],
    );
    let turnos_antes = b.turnos(c.id).expect("turnos");
    let outro_antes = b.turnos(outro.id).expect("turnos");
    let novo = funcionamento_sem_domingo();

    // Turno de outro cliente e turno inexistente.
    for id in [turno_b.turno.id, 9999] {
        let erro = b
            .aplicar_funcionamento(
                c.id,
                &novo,
                &[DadosTurno {
                    id: Some(id),
                    ..turno("Roubado")
                }],
            )
            .expect_err("turno que não é do cliente");
        assert!(matches!(erro, ErroBanco::NaoEncontrado(_)), "{erro}");
    }
    // Cliente inexistente.
    assert!(matches!(
        b.aplicar_funcionamento(9999, &novo, &[turno("Manhã")]),
        Err(ErroBanco::NaoEncontrado(_))
    ));
    // Turno sem dias e nomes repetidos.
    let erro = b
        .aplicar_funcionamento(
            c.id,
            &novo,
            &[DadosTurno {
                dias: DiasSemana::NENHUM,
                ..mantido(&turno_a)
            }],
        )
        .expect_err("sem dias");
    assert!(erro.to_string().contains("ao menos um dia"), "{erro}");
    let erro = b
        .aplicar_funcionamento(
            c.id,
            &novo,
            &[turno("Igual"), turno_em("igual", h("14:00", "20:00"), 1)],
        )
        .expect_err("nomes repetidos");
    assert!(matches!(erro, ErroBanco::Conflito(_)), "{erro}");

    // Nada mudou: nem o funcionamento (gravado antes da falha), nem os turnos.
    assert_eq!(b.turnos(c.id).expect("turnos"), turnos_antes);
    assert_eq!(b.turnos(outro.id).expect("turnos"), outro_antes);
    assert_eq!(
        b.funcionamento(c.id).expect("funcionamento"),
        funcionamento()
    );
    assert_eq!(
        b.alocacoes_do_turno(c.id, turno_a.turno.id).expect("uso"),
        1
    );
}

// ---------------------------------------------------------------------- funcionários

#[test]
fn preferencia_de_periodo_e_gravada_e_lida() {
    let mut b = Banco::em_memoria().expect("banco");
    let c = novo_cliente(&mut b, "A", &[turno("Manhã")]);
    let com = |m: &str, p: Option<Periodo>| DadosFuncionario {
        cargo: Some("Atendente".into()),
        carga_semanal_min: Some(36 * 60),
        preferencia: p,
        ..func(m)
    };
    let gravados = importar(
        &mut b,
        c.id,
        &[
            com("1", Some(Periodo::Manha)),
            com("2", Some(Periodo::Tarde)),
            com("3", Some(Periodo::Noite)),
            com("4", None),
        ],
    );
    assert_eq!(
        gravados.iter().map(|f| f.preferencia).collect::<Vec<_>>(),
        vec![
            Some(Periodo::Manha),
            Some(Periodo::Tarde),
            Some(Periodo::Noite),
            None
        ]
    );
    assert!(gravados.iter().all(|f| f.ativo));
    // Outro cliente com a mesma matrícula não enxerga a preferência.
    let outro = novo_cliente(&mut b, "B", &[turno("Manhã")]);
    let gravados_b = importar(&mut b, outro.id, &[com("1", None)]);
    assert_eq!(gravados_b[0].preferencia, None);
    assert_eq!(
        b.funcionarios(c.id).expect("a")[0].preferencia,
        Some(Periodo::Manha)
    );
}

#[test]
fn importacao_sem_preferencia_mantem_a_gravada() {
    let mut b = Banco::em_memoria().expect("banco");
    let c = novo_cliente(&mut b, "A", &[turno("Manhã")]);
    let primeira = DadosFuncionario {
        cargo: Some("Caixa".into()),
        ctps: Some("0001/001".into()),
        secao: Some("Loja".into()),
        carga_semanal_min: Some(36 * 60),
        preferencia: Some(Periodo::Noite),
        ..func("1")
    };
    let acoes = b
        .gravar_importacao(c.id, std::slice::from_ref(&primeira), &[])
        .expect("criar");
    assert_eq!(acoes, vec![("1".to_string(), AcaoImportacao::Criado)]);

    // Reimportar sem preferência, carga, CTPS ou seção mantém o que estava gravado
    // (a carga editada no app não se perde); nome e cargo são os da planilha.
    let acoes = b
        .gravar_importacao(
            c.id,
            &[DadosFuncionario {
                nome: "Nome Novo".into(),
                cargo: None,
                ctps: None,
                secao: None,
                carga_semanal_min: None,
                preferencia: None,
                ..func("1")
            }],
            &[],
        )
        .expect("atualizar");
    assert_eq!(acoes, vec![("1".to_string(), AcaoImportacao::Atualizado)]);
    let f = b.funcionarios(c.id).expect("lista")[0].clone();
    assert_eq!(f.preferencia, Some(Periodo::Noite), "COALESCE mantém");
    assert_eq!(f.ctps.as_deref(), Some("0001/001"));
    assert_eq!(f.secao.as_deref(), Some("Loja"));
    assert_eq!(f.nome, "Nome Novo");
    assert_eq!(f.cargo, None);
    assert_eq!(f.carga_semanal_min, Some(36 * 60), "COALESCE mantém");

    // Com preferência na planilha, ela substitui.
    b.gravar_importacao(
        c.id,
        &[DadosFuncionario {
            preferencia: Some(Periodo::Manha),
            ..func("1")
        }],
        &[],
    )
    .expect("trocar");
    assert_eq!(
        b.funcionarios(c.id).expect("lista")[0].preferencia,
        Some(Periodo::Manha)
    );
}

#[test]
fn edicao_do_funcionario_troca_cargo_carga_e_preferencia() {
    let mut b = Banco::em_memoria().expect("banco");
    let c = novo_cliente(&mut b, "A", &[turno("Cedo")]);
    let outro = novo_cliente(&mut b, "B", &[turno("Cedo")]);
    let f = importar(
        &mut b,
        c.id,
        &[DadosFuncionario {
            preferencia: Some(Periodo::Manha),
            ..func("1")
        }],
    )[0]
    .clone();

    b.atualizar_funcionario(
        c.id,
        f.id,
        &EdicaoFuncionario {
            cargo: Some("Atendente".into()),
            carga_semanal_min: Some(36 * 60),
            preferencia: Some(Periodo::Tarde),
        },
    )
    .expect("editar");
    let lido = b.funcionarios(c.id).expect("lista")[0].clone();
    assert_eq!(lido.cargo.as_deref(), Some("Atendente"));
    assert_eq!(lido.carga_semanal_min, Some(36 * 60));
    assert_eq!(lido.preferencia, Some(Periodo::Tarde));
    assert_eq!(lido.nome, f.nome, "nome e matrícula não mudam");
    assert_eq!(lido.matricula, f.matricula);

    // Na edição `None` limpa a preferência (não há COALESCE como na importação).
    b.atualizar_funcionario(
        c.id,
        f.id,
        &EdicaoFuncionario {
            cargo: None,
            carga_semanal_min: None,
            preferencia: None,
        },
    )
    .expect("limpar");
    let lido = b.funcionarios(c.id).expect("lista")[0].clone();
    assert_eq!(lido.preferencia, None);
    assert_eq!(lido.cargo, None);
    assert_eq!(lido.carga_semanal_min, None);

    // Funcionário de outro cliente ou inexistente.
    for (cliente, funcionario) in [(outro.id, f.id), (c.id, 9999)] {
        let erro = b
            .atualizar_funcionario(
                cliente,
                funcionario,
                &EdicaoFuncionario {
                    cargo: Some("Invasor".into()),
                    carga_semanal_min: None,
                    preferencia: Some(Periodo::Noite),
                },
            )
            .expect_err("não é do cliente");
        assert!(matches!(erro, ErroBanco::NaoEncontrado(_)), "{erro}");
    }
    assert_eq!(b.funcionarios(c.id).expect("lista")[0].cargo, None);
}

// ---------------------------------------------------------------------- marcação manual de dias

/// Cliente com dois turnos, duas pessoas e março gerado (mais abril, para provar o isolamento).
struct Cenario {
    banco: Banco,
    cliente: i64,
    t1: TurnoRow,
    t2: TurnoRow,
    ana: i64,
    bia: i64,
}

fn cenario() -> Cenario {
    let mut banco = Banco::em_memoria().expect("banco");
    let c = novo_cliente(
        &mut banco,
        "Loja",
        &[
            turno_em("Manhã", hi("10:00", "16:15", 15), 0),
            turno_em("Tarde", hi("15:45", "22:00", 15), 1),
        ],
    );
    let turnos = banco.turnos(c.id).expect("turnos");
    let (t1, t2) = (turnos[0].clone(), turnos[1].clone());
    let pessoas = importar(&mut banco, c.id, &[func("1"), func("2")]);
    let (ana, bia) = (pessoas[0].id, pessoas[1].id);
    gerar_marco(
        &mut banco,
        c.id,
        &[
            alocacao(ana, t1.turno.id, d(10), t1.turno.horario),
            alocacao(bia, t2.turno.id, d(10), t2.turno.horario),
            alocacao(ana, t1.turno.id, d(11), t1.turno.horario),
        ],
        &[
            aviso(
                TipoAviso::CoberturaInsuficiente,
                d(12),
                Some(t1.turno.id),
                "antigo de março",
            ),
            aviso(TipoAviso::CargaAbaixoDoAlvo, d(5), None, "outro antigo"),
        ],
    );
    banco
        .substituir_mes(
            c.id,
            2026,
            4,
            abril(1),
            abril(30),
            &[alocacao(ana, t1.turno.id, abril(2), t1.turno.horario)],
            &[aviso(
                TipoAviso::CoberturaInsuficiente,
                abril(3),
                Some(t2.turno.id),
                "de abril",
            )],
        )
        .expect("abril");
    Cenario {
        banco,
        cliente: c.id,
        t1,
        t2,
        ana,
        bia,
    }
}

fn do_dia(b: &Banco, cliente: i64, data: NaiveDate) -> Vec<(i64, i64)> {
    b.alocacoes(cliente, data, data)
        .expect("alocações")
        .into_iter()
        .map(|a| (a.alocacao.funcionario_id, a.alocacao.turno_id))
        .collect()
}

/// Ausências do funcionário como (início, fim, motivo, justificada), em ordem de início.
fn ausencias_de(
    b: &Banco,
    cliente: i64,
    funcionario: i64,
) -> Vec<(NaiveDate, NaiveDate, Option<String>, bool)> {
    b.funcionarios(cliente)
        .expect("funcionários")
        .into_iter()
        .find(|f| f.id == funcionario)
        .expect("funcionário")
        .ausencias
        .into_iter()
        .map(|a| (a.inicio, a.fim, a.motivo, a.justificada))
        .collect()
}

/// Substitui as ausências da matrícula (a importação troca todas as da pessoa).
fn gravar_ausencias(b: &mut Banco, cliente: i64, ausencias: &[DadosAusencia]) {
    b.gravar_importacao(cliente, &[], ausencias)
        .expect("ausências");
}

fn periodo_de_ausencia(
    matricula: &str,
    inicio: u32,
    fim: u32,
    motivo: Option<&str>,
    justificada: bool,
) -> DadosAusencia {
    DadosAusencia {
        matricula: matricula.into(),
        inicio: d(inicio),
        fim: d(fim),
        motivo: motivo.map(str::to_string),
        justificada,
    }
}

fn periodo_lido(
    inicio: u32,
    fim: u32,
    motivo: Option<&str>,
    justificada: bool,
) -> (NaiveDate, NaiveDate, Option<String>, bool) {
    (d(inicio), d(fim), motivo.map(str::to_string), justificada)
}

fn falta(motivo: Option<&str>) -> DiaMarcado {
    DiaMarcado::Ausencia {
        justificada: false,
        motivo: motivo.map(str::to_string),
    }
}

#[test]
fn marcar_dia_define_turno_folga_e_troca_os_avisos() {
    let Cenario {
        mut banco,
        cliente,
        t1,
        t2,
        ana,
        bia,
    } = cenario();
    let (id1, id2) = (t1.turno.id, t2.turno.id);

    // Troca de turno num dia já alocado: substitui, sem duplicar, com o horário do turno novo.
    let novos = [aviso(
        TipoAviso::CoberturaInsuficiente,
        d(10),
        Some(id1),
        "Manhã sem ninguém em 10/03",
    )];
    banco
        .marcar_dia(
            cliente,
            2026,
            3,
            ana,
            d(10),
            &DiaMarcado::Turno(id2, t2.turno.horario),
            &novos,
        )
        .expect("trocar");
    assert_eq!(do_dia(&banco, cliente, d(10)), vec![(ana, id2), (bia, id2)]);
    let ana_10 = banco
        .alocacoes(cliente, d(10), d(10))
        .expect("alocações")
        .into_iter()
        .find(|a| a.alocacao.funcionario_id == ana)
        .expect("ana");
    assert_eq!(ana_10.alocacao.horario, t2.turno.horario);
    assert_eq!(ana_10.alocacao.minutos_trabalhados(), 360);
    // Os avisos do mês foram trocados pelos novos (os antigos saíram).
    assert_eq!(
        banco.avisos_do_mes(cliente, 2026, 3).expect("avisos"),
        novos
    );

    // Folga: remove a alocação do dia, e os avisos passam a ser os informados (nenhum).
    banco
        .marcar_dia(cliente, 2026, 3, ana, d(11), &DiaMarcado::Folga, &[])
        .expect("folga");
    assert!(do_dia(&banco, cliente, d(11)).is_empty());
    assert!(banco
        .avisos_do_mes(cliente, 2026, 3)
        .expect("avisos")
        .is_empty());

    // Folga num dia em que a pessoa já está de folga não é erro.
    banco
        .marcar_dia(cliente, 2026, 3, ana, d(20), &DiaMarcado::Folga, &[])
        .expect("folga em dia livre");

    // Folga não é ausência: nada é gravado em `ausencias`.
    assert!(ausencias_de(&banco, cliente, ana).is_empty());
    assert!(ausencias_de(&banco, cliente, bia).is_empty());

    // Define um turno num dia livre; o horário gravado é o informado (pode diferir do turno).
    let proprio = hi("12:00", "18:00", 30);
    banco
        .marcar_dia(
            cliente,
            2026,
            3,
            bia,
            d(12),
            &DiaMarcado::Turno(id1, proprio),
            &[],
        )
        .expect("definir");
    let bia_12 = banco.alocacoes(cliente, d(12), d(12)).expect("alocações");
    assert_eq!(bia_12.len(), 1);
    assert_eq!(bia_12[0].alocacao.funcionario_id, bia);
    assert_eq!(bia_12[0].alocacao.turno_id, id1);
    assert_eq!(bia_12[0].alocacao.horario, proprio);
    assert_eq!(bia_12[0].alocacao.minutos_trabalhados(), 330);

    // Resto do mês e do cliente intactos: a Bia do dia 10, abril e seus avisos.
    assert_eq!(do_dia(&banco, cliente, d(10)), vec![(ana, id2), (bia, id2)]);
    let abril_avisos = banco.avisos_do_mes(cliente, 2026, 4).expect("abril");
    assert_eq!(abril_avisos.len(), 1);
    assert_eq!(abril_avisos[0].mensagem, "de abril");
    assert_eq!(
        banco
            .alocacoes(cliente, abril(1), abril(30))
            .expect("abril")
            .len(),
        1
    );
    assert_eq!(banco.meses(cliente).expect("meses").len(), 2);
}

#[test]
fn marcar_dia_divide_um_periodo_de_ferias_de_dez_dias() {
    let Cenario {
        mut banco,
        cliente,
        t1,
        ana,
        bia,
        ..
    } = cenario();
    let id1 = t1.turno.id;
    // Ana de férias de 01 a 10/03 (justificada); Bia com uma falta no mesmo período.
    gravar_ausencias(
        &mut banco,
        cliente,
        &[
            periodo_de_ausencia("1", 1, 10, Some("Férias"), true),
            periodo_de_ausencia("2", 1, 10, Some("Licença"), false),
        ],
    );
    assert_eq!(
        ausencias_de(&banco, cliente, ana),
        vec![periodo_lido(1, 10, Some("Férias"), true)]
    );

    // Turno no dia 5: o período vira dois (1–4 e 6–10), com o mesmo motivo e a mesma marca.
    banco
        .marcar_dia(
            cliente,
            2026,
            3,
            ana,
            d(5),
            &DiaMarcado::Turno(id1, t1.turno.horario),
            &[],
        )
        .expect("turno no meio das férias");
    assert_eq!(
        ausencias_de(&banco, cliente, ana),
        vec![
            periodo_lido(1, 4, Some("Férias"), true),
            periodo_lido(6, 10, Some("Férias"), true),
        ]
    );
    assert_eq!(do_dia(&banco, cliente, d(5)), vec![(ana, id1)]);
    // A ausência da Bia no mesmo período não é tocada.
    assert_eq!(
        ausencias_de(&banco, cliente, bia),
        vec![periodo_lido(1, 10, Some("Licença"), false)]
    );

    // A divisão também preserva a marca de falta.
    banco
        .marcar_dia(
            cliente,
            2026,
            3,
            bia,
            d(5),
            &DiaMarcado::Turno(id1, t1.turno.horario),
            &[],
        )
        .expect("turno no meio da licença");
    assert_eq!(
        ausencias_de(&banco, cliente, bia),
        vec![
            periodo_lido(1, 4, Some("Licença"), false),
            periodo_lido(6, 10, Some("Licença"), false),
        ]
    );

    // Nas pontas o período só encolhe (não sobra pedaço vazio).
    banco
        .marcar_dia(cliente, 2026, 3, ana, d(1), &DiaMarcado::Folga, &[])
        .expect("primeiro dia");
    banco
        .marcar_dia(cliente, 2026, 3, ana, d(10), &DiaMarcado::Folga, &[])
        .expect("último dia");
    assert_eq!(
        ausencias_de(&banco, cliente, ana),
        vec![
            periodo_lido(2, 4, Some("Férias"), true),
            periodo_lido(6, 9, Some("Férias"), true),
        ]
    );
    // Folga no meio também divide, e um período de um dia só some por inteiro.
    banco
        .marcar_dia(cliente, 2026, 3, ana, d(7), &DiaMarcado::Folga, &[])
        .expect("folga no meio");
    banco
        .marcar_dia(cliente, 2026, 3, ana, d(6), &DiaMarcado::Folga, &[])
        .expect("período de um dia");
    assert_eq!(
        ausencias_de(&banco, cliente, ana),
        vec![
            periodo_lido(2, 4, Some("Férias"), true),
            periodo_lido(8, 9, Some("Férias"), true),
        ]
    );
    // Dia fora de qualquer ausência não mexe nos períodos.
    banco
        .marcar_dia(cliente, 2026, 3, ana, d(20), &DiaMarcado::Folga, &[])
        .expect("dia livre");
    assert_eq!(ausencias_de(&banco, cliente, ana).len(), 2);
    // Tudo isso sem sair do mês: o outro mês gerado e seus avisos continuam como estavam.
    assert_eq!(
        banco
            .alocacoes(cliente, abril(1), abril(30))
            .expect("abril")
            .len(),
        1
    );
}

#[test]
fn marcar_dia_registra_falta_e_a_troca_por_folga_ou_turno() {
    let Cenario {
        mut banco,
        cliente,
        t1,
        ana,
        bia,
        ..
    } = cenario();
    let id1 = t1.turno.id;

    // Falta no dia em que a Ana trabalhava (10/03): a alocação sai e entra uma ausência
    // de um dia só, não justificada, com o motivo informado.
    assert_eq!(do_dia(&banco, cliente, d(10)).len(), 2);
    let avisos = [aviso(
        TipoAviso::CoberturaInsuficiente,
        d(10),
        Some(id1),
        "Manhã sem ninguém em 10/03",
    )];
    banco
        .marcar_dia(
            cliente,
            2026,
            3,
            ana,
            d(10),
            &falta(Some("Não compareceu")),
            &avisos,
        )
        .expect("falta");
    assert!(do_dia(&banco, cliente, d(10))
        .iter()
        .all(|(f, _)| *f != ana));
    assert_eq!(
        ausencias_de(&banco, cliente, ana),
        vec![periodo_lido(10, 10, Some("Não compareceu"), false)]
    );
    assert_eq!(
        banco.avisos_do_mes(cliente, 2026, 3).expect("avisos"),
        avisos,
        "os avisos do mês são os informados"
    );
    // A Ana continua com o dia 11 e a Bia com o dia 10.
    assert_eq!(do_dia(&banco, cliente, d(11)), vec![(ana, id1)]);
    assert_eq!(do_dia(&banco, cliente, d(10)).len(), 1);

    // Marcar a falta de novo não duplica o período.
    banco
        .marcar_dia(
            cliente,
            2026,
            3,
            ana,
            d(10),
            &falta(Some("Não compareceu")),
            &[],
        )
        .expect("falta de novo");
    assert_eq!(ausencias_de(&banco, cliente, ana).len(), 1);

    // Falta no meio de férias (12 a 16/03 da Bia): as férias se dividem e a falta fica entre elas.
    gravar_ausencias(
        &mut banco,
        cliente,
        &[periodo_de_ausencia("2", 12, 16, Some("Férias"), true)],
    );
    banco
        .marcar_dia(cliente, 2026, 3, bia, d(14), &falta(None), &[])
        .expect("falta nas férias");
    assert_eq!(
        ausencias_de(&banco, cliente, bia),
        vec![
            periodo_lido(12, 13, Some("Férias"), true),
            periodo_lido(14, 14, None, false),
            periodo_lido(15, 16, Some("Férias"), true),
        ]
    );
    // A pessoa continua sem alocação nesses dias.
    assert!(banco
        .alocacoes(cliente, d(12), d(16))
        .expect("alocações")
        .iter()
        .all(|a| a.alocacao.funcionario_id != bia));

    // Trocar a falta por folga: a ausência some (as férias não voltam a se juntar).
    banco
        .marcar_dia(cliente, 2026, 3, bia, d(14), &DiaMarcado::Folga, &[])
        .expect("folga no lugar da falta");
    assert_eq!(
        ausencias_de(&banco, cliente, bia),
        vec![
            periodo_lido(12, 13, Some("Férias"), true),
            periodo_lido(15, 16, Some("Férias"), true),
        ]
    );
    banco
        .marcar_dia(cliente, 2026, 3, ana, d(10), &DiaMarcado::Folga, &[])
        .expect("folga no lugar da falta");
    assert!(ausencias_de(&banco, cliente, ana).is_empty());
    assert!(do_dia(&banco, cliente, d(10))
        .iter()
        .all(|(f, _)| *f != ana));

    // Trocar a falta por justificada (abonada, sem motivo) e depois por turno.
    banco
        .marcar_dia(cliente, 2026, 3, ana, d(10), &falta(Some("Atestado")), &[])
        .expect("falta");
    banco
        .marcar_dia(
            cliente,
            2026,
            3,
            ana,
            d(10),
            &DiaMarcado::Ausencia {
                justificada: true,
                motivo: None,
            },
            &[],
        )
        .expect("abonada");
    assert_eq!(
        ausencias_de(&banco, cliente, ana),
        vec![periodo_lido(10, 10, None, true)]
    );
    banco
        .marcar_dia(
            cliente,
            2026,
            3,
            ana,
            d(10),
            &DiaMarcado::Turno(id1, t1.turno.horario),
            &[],
        )
        .expect("turno no lugar da abonada");
    assert!(ausencias_de(&banco, cliente, ana).is_empty());
    assert_eq!(
        do_dia(&banco, cliente, d(10)).len(),
        2,
        "Ana volta ao dia 10"
    );
}

#[test]
fn marcar_dia_recusa_dados_invalidos_sem_alterar_nada() {
    let Cenario {
        mut banco,
        cliente,
        t1,
        t2,
        ana,
        bia,
    } = cenario();
    let outro = novo_cliente(&mut banco, "Outra loja", &[turno("Turno B")]);
    let turno_de_outro = banco.turnos(outro.id).expect("turnos")[0].clone();
    let pessoa_de_outro = importar(&mut banco, outro.id, &[func("1")])[0].id;
    // A Bia de férias de 12 a 14/03 e a pessoa do outro cliente com uma falta no dia 10.
    gravar_ausencias(
        &mut banco,
        cliente,
        &[periodo_de_ausencia("2", 12, 14, Some("Férias"), true)],
    );
    gravar_ausencias(
        &mut banco,
        outro.id,
        &[periodo_de_ausencia("1", 10, 10, None, false)],
    );

    // Tudo o que um ajuste poderia mexer, nos dois clientes.
    let foto = |banco: &Banco| {
        (
            banco.funcionarios(cliente).expect("funcionários"),
            banco.funcionarios(outro.id).expect("funcionários"),
            banco
                .alocacoes(cliente, d(1), abril(30))
                .expect("alocações"),
            banco
                .alocacoes(outro.id, d(1), abril(30))
                .expect("alocações"),
            banco.avisos_do_mes(cliente, 2026, 3).expect("avisos"),
            banco.avisos_do_mes(cliente, 2026, 4).expect("avisos"),
            banco.meses(cliente).expect("meses"),
        )
    };
    let antes = foto(&banco);
    let todos_os_dias = |t: &escala_db::TurnoRow, outro_turno: i64| {
        [
            DiaMarcado::Turno(t.turno.id, t.turno.horario),
            DiaMarcado::Turno(outro_turno, t.turno.horario),
            DiaMarcado::Folga,
            falta(Some("Falta")),
            DiaMarcado::Ausencia {
                justificada: true,
                motivo: None,
            },
        ]
    };
    let nao_deve_gravar = [aviso(
        TipoAviso::CargaAbaixoDoAlvo,
        d(10),
        None,
        "não deve gravar",
    )];

    // Data fora do (ano, mês) informado: dado inválido (ano, mês e dia de outro mês).
    for (ano, mes, data) in [
        (2026, 3, abril(2)),
        (2026, 4, d(10)),
        (2025, 3, d(10)),
        (2026, 3, NaiveDate::from_ymd_opt(2026, 2, 28).expect("data")),
    ] {
        for dia in todos_os_dias(&t1, t2.turno.id) {
            let erro = banco
                .marcar_dia(cliente, ano, mes, ana, data, &dia, &nao_deve_gravar)
                .expect_err("data fora do mês");
            assert!(matches!(erro, ErroBanco::DadoInvalido(_)), "{erro}");
        }
    }
    assert!(foto(&banco) == antes, "data fora do mês não altera nada");

    // Mês que não foi gerado (maio), com data de maio.
    let maio = NaiveDate::from_ymd_opt(2026, 5, 4).expect("data");
    for dia in todos_os_dias(&t1, t2.turno.id) {
        let erro = banco
            .marcar_dia(cliente, 2026, 5, ana, maio, &dia, &nao_deve_gravar)
            .expect_err("mês não gerado");
        assert!(matches!(erro, ErroBanco::NaoEncontrado(_)), "{erro}");
    }
    assert!(foto(&banco) == antes, "mês não gerado não altera nada");

    // Funcionário de outro cliente e inexistente, em qualquer tipo de dia (inclusive o
    // dia 10, em que a pessoa do outro cliente tem uma falta).
    for funcionario in [pessoa_de_outro, 9999] {
        for dia in todos_os_dias(&t1, t2.turno.id) {
            let erro = banco
                .marcar_dia(cliente, 2026, 3, funcionario, d(10), &dia, &nao_deve_gravar)
                .expect_err("funcionário que não é do cliente");
            assert!(matches!(erro, ErroBanco::NaoEncontrado(_)), "{erro}");
        }
    }
    assert!(foto(&banco) == antes, "funcionário alheio não altera nada");

    // Turno de outro cliente e inexistente: o dia da Ana (10/03, com alocação) e um dia
    // de férias da Bia (13/03) ficam exatamente como estavam, sem dividir o período.
    for turno_id in [turno_de_outro.turno.id, 9999] {
        for (funcionario, data) in [(ana, d(10)), (bia, d(13)), (bia, d(20))] {
            let erro = banco
                .marcar_dia(
                    cliente,
                    2026,
                    3,
                    funcionario,
                    data,
                    &DiaMarcado::Turno(turno_id, t2.turno.horario),
                    &nao_deve_gravar,
                )
                .expect_err("turno que não é do cliente");
            assert!(matches!(erro, ErroBanco::NaoEncontrado(_)), "{erro}");
        }
    }
    assert!(foto(&banco) == antes, "turno alheio não altera nada");
    assert_eq!(
        ausencias_de(&banco, cliente, bia),
        vec![periodo_lido(12, 14, Some("Férias"), true)],
        "as férias não foram divididas"
    );
    assert_eq!(do_dia(&banco, cliente, d(10)).len(), 2);
    // A pessoa do outro cliente também ficou com a falta de antes.
    assert_eq!(
        ausencias_de(&banco, outro.id, pessoa_de_outro),
        vec![periodo_lido(10, 10, None, false)]
    );
}
