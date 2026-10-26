//! Testes do motor de distribuição de escalas.
//!
//! Foco: o limite semanal nunca é ultrapassado (sem hora extra), inclusive em
//! semanas que atravessam a virada do mês, em qualquer ordem de geração.
//! Toda escala gerada também passa pelo verificador independente.

use std::collections::{BTreeMap, BTreeSet};

use chrono::{Datelike, Days, NaiveDate, Weekday};
use escala_core::{
    etapas_ec141, gerar_escala, gerar_turnos, limites_do_mes, semanas_cobrindo, verificar,
    Alocacao, Aviso, DiasSemana, EntradaPlanejamento, ErroPlanejamento, EtapaRegime, FuncaoMinima,
    FuncionarioId, FuncionarioPlano, HoraDoDia, Horario, InicioSemana, JanelaDia, OpcaoTurno,
    Periodo, RegrasCarga, ResultadoPlanejamento, Semana, TipoAviso, Turno, TurnoId, Violacao,
};

// ---------------------------------------------------------------------------
// Utilitários
// ---------------------------------------------------------------------------

const MANHA: TurnoId = 1;
const TARDE: TurnoId = 2;
const NOITE: TurnoId = 3;
const H40: u32 = 40 * 60;

fn d(ano: i32, mes: u32, dia: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(ano, mes, dia).expect("data válida")
}

fn horario(inicio: &str, fim: &str, intervalo: u32) -> Horario {
    let i: HoraDoDia = inicio.parse().expect("hora");
    let f: HoraDoDia = fim.parse().expect("hora");
    Horario::novo(i, f, intervalo).expect("horário")
}

fn turnos(efetivo_minimo: u32) -> Vec<Turno> {
    vec![
        Turno {
            id: MANHA,
            nome: "Manhã".into(),
            horario: horario("06:00", "14:00", 0),
            efetivo_minimo,
            ordem: 0,
            dias: DiasSemana::TODOS,
        },
        Turno {
            id: TARDE,
            nome: "Tarde".into(),
            horario: horario("14:00", "22:00", 0),
            efetivo_minimo,
            ordem: 1,
            dias: DiasSemana::TODOS,
        },
        Turno {
            id: NOITE,
            nome: "Noite".into(),
            horario: horario("22:00", "06:00", 0),
            efetivo_minimo,
            ordem: 2,
            dias: DiasSemana::TODOS,
        },
    ]
}

fn funcionario(id: FuncionarioId, opcoes: &[TurnoId], turnos: &[Turno]) -> FuncionarioPlano {
    FuncionarioPlano {
        id,
        nome: format!("Funcionário {id}"),
        opcoes: opcoes
            .iter()
            .map(|t| OpcaoTurno {
                turno_id: *t,
                horario: turnos.iter().find(|x| x.id == *t).expect("turno").horario,
            })
            .collect(),
        carga_semanal_min: None,
        dias_disponiveis: DiasSemana::TODOS,
        indisponivel: BTreeSet::new(),
        faltas: BTreeSet::new(),
        preferencia: None,
        saldo_anterior_min: 0,
        funcao: None,
    }
}

/// `n` funcionários por turno, cada um fixo em um turno.
fn equipe(n_por_turno: i64, turnos: &[Turno]) -> Vec<FuncionarioPlano> {
    let mut v = Vec::new();
    for (i, t) in turnos.iter().enumerate() {
        for k in 0..n_por_turno {
            v.push(funcionario(i as i64 * 100 + k + 1, &[t.id], turnos));
        }
    }
    v
}

fn entrada(
    inicio: NaiveDate,
    fim: NaiveDate,
    regras: RegrasCarga,
    turnos: Vec<Turno>,
    funcionarios: Vec<FuncionarioPlano>,
) -> EntradaPlanejamento {
    EntradaPlanejamento {
        inicio,
        fim,
        regras,
        turnos,
        funcionarios,
        alocacoes_fixas: Vec::new(),
        alocacoes_travadas: Vec::new(),
        datas_planejadas: BTreeSet::new(),
        regime: Vec::new(),
        minimo_por_funcao: BTreeMap::new(),
    }
}

const SEG_SEX: [u8; 5] = [0, 1, 2, 3, 4];
const SEG_SAB: [u8; 6] = [0, 1, 2, 3, 4, 5];

fn dias(indices: &[u8]) -> DiasSemana {
    DiasSemana::de_indices(indices.iter().copied())
}

/// Troca os dias de funcionamento de um turno.
fn com_dias(mut turnos: Vec<Turno>, turno: TurnoId, novos: DiasSemana) -> Vec<Turno> {
    for t in &mut turnos {
        if t.id == turno {
            t.dias = novos;
        }
    }
    turnos
}

fn fim_de_semana(data: NaiveDate) -> bool {
    matches!(data.weekday(), Weekday::Sat | Weekday::Sun)
}

fn mes(ano: i32, mes: u32) -> (NaiveDate, NaiveDate) {
    limites_do_mes(ano, mes).expect("mês válido")
}

/// Minutos por (funcionário, semana de apuração), somando todas as alocações.
fn horas_por_semana<'a>(
    alocacoes: impl IntoIterator<Item = &'a Alocacao>,
    inicio_semana: InicioSemana,
) -> BTreeMap<(FuncionarioId, Semana), u32> {
    let mut m = BTreeMap::new();
    for a in alocacoes {
        let s = Semana::contendo(a.data, inicio_semana).expect("semana");
        *m.entry((a.funcionario_id, s)).or_insert(0) += a.minutos_trabalhados();
    }
    m
}

fn assert_sem_violacoes(entrada: &EntradaPlanejamento, resultado: &ResultadoPlanejamento) {
    let violacoes = verificar(entrada, &resultado.alocacoes);
    assert!(
        violacoes.is_empty(),
        "violações encontradas: {:#?}",
        violacoes
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
    );
}

fn assert_limite_semanal(
    alocacoes: &[Alocacao],
    funcionarios: &[FuncionarioPlano],
    regras: &RegrasCarga,
) {
    for ((id, semana), minutos) in horas_por_semana(alocacoes, regras.inicio_semana) {
        let f = funcionarios
            .iter()
            .find(|f| f.id == id)
            .expect("funcionário");
        let limite = f.limite_semanal_min(regras);
        assert!(
            minutos <= limite,
            "funcionário {id} com {minutos} min na semana {semana:?} (limite {limite})"
        );
    }
}

/// Simula o uso do app: meses gerados um a um, cada geração recebendo como
/// fixas as alocações dos meses vizinhos já gerados.
struct Simulacao {
    regras: RegrasCarga,
    regime: Vec<EtapaRegime>,
    turnos: Vec<Turno>,
    funcionarios: Vec<FuncionarioPlano>,
    meses: BTreeMap<(i32, u32), Vec<Alocacao>>,
    minimo_por_funcao: BTreeMap<String, FuncaoMinima>,
}

impl Simulacao {
    fn nova(regras: RegrasCarga, turnos: Vec<Turno>, funcionarios: Vec<FuncionarioPlano>) -> Self {
        Simulacao {
            regras,
            regime: Vec::new(),
            turnos,
            funcionarios,
            meses: BTreeMap::new(),
            minimo_por_funcao: BTreeMap::new(),
        }
    }

    fn entrada_para(&self, ano: i32, m: u32) -> EntradaPlanejamento {
        let (ini, fim) = mes(ano, m);
        let janela_ini = ini.checked_sub_days(Days::new(35)).expect("data");
        let janela_fim = fim.checked_add_days(Days::new(35)).expect("data");
        let mut e = entrada(
            ini,
            fim,
            self.regras,
            self.turnos.clone(),
            self.funcionarios.clone(),
        );
        e.regime = self.regime.clone();
        e.minimo_por_funcao = self.minimo_por_funcao.clone();
        for (&(a, mm), alocs) in &self.meses {
            if (a, mm) == (ano, m) {
                continue;
            }
            let (mi, mf) = mes(a, mm);
            e.datas_planejadas.extend(
                mi.iter_days()
                    .take_while(|x| *x <= mf)
                    .filter(|x| *x >= janela_ini && *x <= janela_fim),
            );
            e.alocacoes_fixas.extend(
                alocs
                    .iter()
                    .filter(|x| x.data >= janela_ini && x.data <= janela_fim),
            );
        }
        e
    }

    fn gerar(&mut self, ano: i32, m: u32) -> (EntradaPlanejamento, ResultadoPlanejamento) {
        let e = self.entrada_para(ano, m);
        let r = gerar_escala(&e).expect("geração");
        assert_sem_violacoes(&e, &r);
        self.meses.insert((ano, m), r.alocacoes.clone());
        (e, r)
    }

    fn todas(&self) -> Vec<Alocacao> {
        self.meses.values().flatten().copied().collect()
    }

    /// Verificação global de todos os meses gerados, como uma escala única.
    fn verificar_tudo(&self) {
        let todas = self.todas();
        let (Some(ini), Some(fim)) = (
            todas.iter().map(|a| a.data).min(),
            todas.iter().map(|a| a.data).max(),
        ) else {
            return;
        };
        let mut e = entrada(
            ini,
            fim,
            self.regras,
            self.turnos.clone(),
            self.funcionarios.clone(),
        );
        e.regime = self.regime.clone();
        let v = verificar(&e, &todas);
        assert!(
            v.is_empty(),
            "violações globais: {:#?}",
            v.iter().map(ToString::to_string).collect::<Vec<_>>()
        );
        assert_limite_semanal(&todas, &self.funcionarios, &self.regras);
    }
}

// ---------------------------------------------------------------------------
// Limite semanal e ausência de hora extra
// ---------------------------------------------------------------------------

#[test]
fn nenhuma_semana_passa_de_40h_em_tres_anos_gerados_em_sequencia() {
    let t = turnos(2);
    let mut sim = Simulacao::nova(RegrasCarga::default(), t.clone(), equipe(4, &t));
    for ano in 2025..=2027 {
        for m in 1..=12 {
            sim.gerar(ano, m);
        }
    }
    sim.verificar_tudo();
}

#[test]
fn semanas_completas_usam_toda_a_carga_sem_ultrapassar() {
    // Fevereiro de 2027: começa na segunda e tem 28 dias (4 semanas completas, sem vizinhos).
    let t = turnos(2);
    let funcs = equipe(4, &t);
    let (ini, fim) = mes(2027, 2);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs.clone());
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    let semanas = horas_por_semana(&r.alocacoes, InicioSemana::Segunda);
    for f in &funcs {
        for s in semanas_cobrindo(ini, fim, InicioSemana::Segunda).expect("semanas") {
            assert_eq!(
                semanas.get(&(f.id, s)).copied().unwrap_or(0),
                H40,
                "funcionário {} semana {s:?}",
                f.id
            );
        }
    }
    assert!(r.avisos.is_empty(), "{:?}", r.avisos);
}

#[test]
fn folgas_distribuidas_em_5x2_mantem_cobertura_estavel() {
    // 7 pessoas no mesmo turno, 5 jornadas cada por semana: 5 pessoas todos os dias.
    let t = turnos(0);
    let funcs: Vec<_> = (1..=7).map(|i| funcionario(i, &[MANHA], &t)).collect();
    let (ini, fim) = mes(2027, 2);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    let mut por_dia: BTreeMap<NaiveDate, u32> = BTreeMap::new();
    for a in &r.alocacoes {
        *por_dia.entry(a.data).or_default() += 1;
    }
    for dia in ini.iter_days().take_while(|x| *x <= fim) {
        assert_eq!(
            por_dia.get(&dia).copied().unwrap_or(0),
            5,
            "cobertura em {dia}"
        );
    }
}

#[test]
fn limite_configuravel_e_carga_individual() {
    let regras = RegrasCarga {
        carga_semanal_max_min: 36 * 60,
        ..RegrasCarga::default()
    };
    let t = turnos(1);
    let mut funcs = equipe(3, &t);
    funcs[0].carga_semanal_min = Some(30 * 60); // contrato menor que a regra
    funcs[1].carga_semanal_min = Some(44 * 60); // contrato maior: vale a regra (36h)
    let mut sim = Simulacao::nova(regras, t, funcs.clone());
    for m in 1..=6 {
        sim.gerar(2026, m);
    }
    sim.verificar_tudo();
    for ((id, _), minutos) in horas_por_semana(&sim.todas(), InicioSemana::Segunda) {
        match id {
            x if x == funcs[0].id => assert!(minutos <= 30 * 60),
            _ => assert!(minutos <= 36 * 60),
        }
    }
}

#[test]
fn turnos_com_intervalo_contam_apenas_horas_trabalhadas() {
    // 07:00–16:00 com 1h de intervalo = 8h trabalhadas; 9h de permanência.
    let t = vec![Turno {
        id: MANHA,
        nome: "Comercial".into(),
        horario: horario("07:00", "16:00", 60),
        efetivo_minimo: 0,
        ordem: 0,
        dias: DiasSemana::TODOS,
    }];
    let funcs: Vec<_> = (1..=3).map(|i| funcionario(i, &[MANHA], &t)).collect();
    let (ini, fim) = mes(2027, 2);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    for (_, minutos) in horas_por_semana(&r.alocacoes, InicioSemana::Segunda) {
        assert_eq!(minutos, H40);
    }
}

#[test]
fn jornadas_que_nao_dividem_o_limite_ficam_abaixo_dele() {
    // 7h20 por dia: 5 jornadas = 36h40; a 6ª passaria de 40h.
    let t = vec![Turno {
        id: MANHA,
        nome: "Manhã".into(),
        horario: horario("06:00", "13:20", 0),
        efetivo_minimo: 0,
        ordem: 0,
        dias: DiasSemana::TODOS,
    }];
    let funcs: Vec<_> = (1..=4).map(|i| funcionario(i, &[MANHA], &t)).collect();
    let (ini, fim) = mes(2027, 2);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    for (_, minutos) in horas_por_semana(&r.alocacoes, InicioSemana::Segunda) {
        assert_eq!(minutos, 5 * 440);
    }
}

// ---------------------------------------------------------------------------
// Semanas incompletas e virada de mês
// ---------------------------------------------------------------------------

#[test]
fn mes_que_comeca_no_meio_da_semana_reserva_saldo_para_o_mes_anterior() {
    // Outubro/2025 começa numa quarta. Gerado sozinho, a semana 29/09–05/10 tem
    // 2 dias em aberto (setembro) e recebe só a parte proporcional do alvo.
    let t = turnos(1);
    let mut sim = Simulacao::nova(RegrasCarga::default(), t.clone(), equipe(4, &t));
    let (_, r) = sim.gerar(2025, 10);
    let primeira = Semana::contendo(d(2025, 10, 1), InicioSemana::Segunda).expect("semana");
    for ((_, s), minutos) in horas_por_semana(&r.alocacoes, InicioSemana::Segunda) {
        if s == primeira {
            assert!(
                minutos < H40,
                "semana parcial não deveria esgotar a carga: {minutos}"
            );
        }
    }
    // Setembro gerado depois (fora de ordem) completa a semana sem passar de 40h.
    sim.gerar(2025, 9);
    sim.verificar_tudo();
    let total = horas_por_semana(&sim.todas(), InicioSemana::Segunda);
    for f in &sim.funcionarios {
        let minutos = total.get(&(f.id, primeira)).copied().unwrap_or(0);
        assert!(minutos <= H40);
        assert!(
            minutos >= H40 - 8 * 60,
            "funcionário {} subutilizado na semana da virada: {minutos}",
            f.id
        );
    }
}

#[test]
fn mes_que_termina_no_meio_da_semana_e_mes_seguinte_respeita_o_saldo() {
    // Janeiro/2026 termina num sábado; a semana 26/01–01/02 tem só o domingo em fevereiro.
    let t = turnos(1);
    let mut sim = Simulacao::nova(RegrasCarga::default(), t.clone(), equipe(4, &t));
    sim.gerar(2026, 1);
    let (e_fev, r_fev) = sim.gerar(2026, 2);
    // Fevereiro recebeu janeiro como fixo.
    assert!(e_fev
        .alocacoes_fixas
        .iter()
        .any(|a| a.data == d(2026, 1, 31) || a.data == d(2026, 1, 30)));
    let virada = Semana::contendo(d(2026, 2, 1), InicioSemana::Segunda).expect("semana");
    let total = horas_por_semana(&sim.todas(), InicioSemana::Segunda);
    for f in &sim.funcionarios {
        assert!(total.get(&(f.id, virada)).copied().unwrap_or(0) <= H40);
    }
    // Quem já tinha 40h na semana não trabalha no domingo 01/02.
    let cheios: BTreeSet<FuncionarioId> = sim.meses[&(2026, 1)]
        .iter()
        .filter(|a| virada.contem(a.data))
        .fold(BTreeMap::<FuncionarioId, u32>::new(), |mut m, a| {
            *m.entry(a.funcionario_id).or_default() += a.minutos_trabalhados();
            m
        })
        .into_iter()
        .filter(|(_, m)| *m >= H40)
        .map(|(id, _)| id)
        .collect();
    assert!(r_fev
        .alocacoes
        .iter()
        .filter(|a| a.data == d(2026, 2, 1))
        .all(|a| !cheios.contains(&a.funcionario_id)));
    sim.verificar_tudo();
}

#[test]
fn mes_gerado_entre_dois_meses_ja_gerados() {
    let t = turnos(2);
    let mut sim = Simulacao::nova(RegrasCarga::default(), t.clone(), equipe(5, &t));
    sim.gerar(2026, 3);
    sim.gerar(2026, 5);
    let (e, _) = sim.gerar(2026, 4);
    assert!(e.alocacoes_fixas.iter().any(|a| a.data.month() == 3));
    assert!(e.alocacoes_fixas.iter().any(|a| a.data.month() == 5));
    sim.verificar_tudo();
}

#[test]
fn regenerar_um_mes_mantem_os_vizinhos_validos() {
    let t = turnos(1);
    let mut sim = Simulacao::nova(RegrasCarga::default(), t.clone(), equipe(3, &t));
    for m in 6..=8 {
        sim.gerar(2026, m);
    }
    // Muda a equipe (um funcionário passa a ter só 20h) e regenera julho.
    sim.funcionarios[0].carga_semanal_min = Some(20 * 60);
    sim.gerar(2026, 7);
    let julho = &sim.meses[&(2026, 7)];
    for ((id, _), minutos) in horas_por_semana(julho, InicioSemana::Segunda) {
        if id == sim.funcionarios[0].id {
            assert!(minutos <= 20 * 60);
        }
    }
}

#[test]
fn semana_iniciando_no_domingo() {
    let regras = RegrasCarga {
        inicio_semana: InicioSemana::Domingo,
        ..RegrasCarga::default()
    };
    let t = turnos(1);
    let mut sim = Simulacao::nova(regras, t.clone(), equipe(3, &t));
    for m in 1..=4 {
        sim.gerar(2026, m);
    }
    sim.verificar_tudo();
    for ((_, s), minutos) in horas_por_semana(&sim.todas(), InicioSemana::Domingo) {
        assert_eq!(s.inicio.weekday(), Weekday::Sun);
        assert!(minutos <= H40);
    }
}

#[test]
fn periodo_de_um_unico_dia() {
    let t = turnos(1);
    let funcs = equipe(2, &t);
    let e = entrada(
        d(2026, 3, 15),
        d(2026, 3, 15),
        RegrasCarga::default(),
        t,
        funcs,
    );
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    assert!(r.alocacoes.iter().all(|a| a.data == d(2026, 3, 15)));
}

// ---------------------------------------------------------------------------
// Demais restrições
// ---------------------------------------------------------------------------

#[test]
fn horario_acima_da_jornada_diaria_e_ignorado_com_aviso() {
    let t = turnos(0);
    let mut f = funcionario(1, &[MANHA], &t);
    f.opcoes[0].horario = horario("06:00", "16:00", 0); // 10h
    let (ini, fim) = mes(2026, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t, vec![f]);
    let r = gerar_escala(&e).expect("geração");
    assert!(r.alocacoes.is_empty());
    assert!(r
        .avisos
        .iter()
        .any(|a| a.tipo == TipoAviso::TurnoExcedeJornada));
}

#[test]
fn descanso_entre_jornadas_considera_o_mes_anterior() {
    // Noite em 28/02 (22:00–06:00 de 01/03): Manhã em 01/03 teria 0h de descanso.
    let t = turnos(0);
    let f = funcionario(1, &[MANHA], &t);
    let (ini, fim) = mes(2026, 3);
    let mut e = entrada(ini, fim, RegrasCarga::default(), t.clone(), vec![f]);
    e.alocacoes_fixas.push(Alocacao {
        funcionario_id: 1,
        turno_id: NOITE,
        data: d(2026, 2, 28),
        horario: t[2].horario,
    });
    e.datas_planejadas.insert(d(2026, 2, 28));
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    assert!(r.alocacoes.iter().all(|a| a.data != d(2026, 3, 1)));
}

#[test]
fn funcionario_com_varios_turnos_respeita_descanso_ao_trocar_de_turno() {
    let t = turnos(2);
    let mut funcs = vec![
        funcionario(1, &[MANHA, TARDE, NOITE], &t),
        funcionario(2, &[MANHA, TARDE, NOITE], &t),
    ];
    funcs.extend((3..=6).map(|i| funcionario(i, &[MANHA, NOITE], &t)));
    let mut sim = Simulacao::nova(RegrasCarga::default(), t, funcs);
    for m in 1..=3 {
        sim.gerar(2026, m);
    }
    sim.verificar_tudo();
}

#[test]
fn dias_consecutivos_respeitados_na_virada_do_mes() {
    let t = turnos(0);
    let f = funcionario(1, &[MANHA], &t);
    let (ini, fim) = mes(2026, 3);
    let mut e = entrada(ini, fim, RegrasCarga::default(), t.clone(), vec![f]);
    // 23/02 a 28/02: 6 dias seguidos (o máximo). 01/03 deve ser folga.
    for dia in 23..=28 {
        e.alocacoes_fixas.push(Alocacao {
            funcionario_id: 1,
            turno_id: MANHA,
            data: d(2026, 2, dia),
            horario: t[0].horario,
        });
        e.datas_planejadas.insert(d(2026, 2, dia));
    }
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    assert!(r.alocacoes.iter().all(|a| a.data != d(2026, 3, 1)));
}

#[test]
fn ausencias_e_dias_disponiveis_sao_respeitados() {
    let t = turnos(0);
    let mut f = funcionario(1, &[MANHA], &t);
    f.dias_disponiveis = DiasSemana::de_indices([0, 1, 2, 3, 4]); // seg–sex
    f.indisponivel = d(2026, 3, 9).iter_days().take(5).collect(); // férias 09–13/03
    let (ini, fim) = mes(2026, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t, vec![f.clone()]);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    assert!(!r.alocacoes.is_empty());
    for a in &r.alocacoes {
        assert!(f.disponivel_em(a.data), "escalado em {}", a.data);
    }
    // Semana de férias inteira: sem aviso de carga abaixo do alvo.
    assert!(!r
        .avisos
        .iter()
        .any(|a| a.tipo == TipoAviso::CargaAbaixoDoAlvo && a.data == Some(d(2026, 3, 9))));
}

#[test]
fn efetivo_minimo_impossivel_gera_aviso_e_nao_gera_hora_extra() {
    let t = turnos(3);
    let funcs: Vec<_> = (1..=2).map(|i| funcionario(i, &[MANHA], &t)).collect();
    let (ini, fim) = mes(2026, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs.clone());
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    assert_limite_semanal(&r.alocacoes, &funcs, &e.regras);
    let faltas = r
        .avisos
        .iter()
        .filter(|a| a.tipo == TipoAviso::CoberturaInsuficiente)
        .collect::<Vec<_>>();
    // Manhã: aviso por dia; Tarde e Noite sem ninguém: um aviso geral cada.
    assert!(faltas.iter().filter(|a| a.turno_id == Some(MANHA)).count() >= 28);
    assert_eq!(
        faltas.iter().filter(|a| a.turno_id == Some(TARDE)).count(),
        1
    );
    assert_eq!(
        faltas.iter().filter(|a| a.turno_id == Some(NOITE)).count(),
        1
    );
}

#[test]
fn funcionario_sem_turno_gera_aviso() {
    let t = turnos(0);
    let f = funcionario(1, &[], &t);
    let (ini, fim) = mes(2026, 3);
    let r = gerar_escala(&entrada(ini, fim, RegrasCarga::default(), t, vec![f])).expect("geração");
    assert!(r.alocacoes.is_empty());
    assert!(r
        .avisos
        .iter()
        .any(|a| a.tipo == TipoAviso::FuncionarioSemTurno));
}

#[test]
fn geracao_e_deterministica() {
    let t = turnos(2);
    let funcs = equipe(4, &t);
    let (ini, fim) = mes(2026, 5);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    assert_eq!(
        gerar_escala(&e).expect("geração"),
        gerar_escala(&e).expect("geração")
    );
}

#[test]
fn entradas_invalidas_sao_rejeitadas() {
    let t = turnos(0);
    let funcs = equipe(1, &t);
    let base = entrada(
        d(2026, 3, 1),
        d(2026, 3, 31),
        RegrasCarga::default(),
        t.clone(),
        funcs,
    );

    let mut e = base.clone();
    e.fim = d(2026, 2, 1);
    assert!(matches!(
        gerar_escala(&e),
        Err(ErroPlanejamento::PeriodoInvalido { .. })
    ));

    let mut e = base.clone();
    e.fim = d(2027, 6, 1);
    assert!(matches!(
        gerar_escala(&e),
        Err(ErroPlanejamento::PeriodoLongo { .. })
    ));

    let mut e = base.clone();
    e.regras.carga_semanal_max_min = 0;
    assert!(matches!(gerar_escala(&e), Err(ErroPlanejamento::Regras(_))));

    let mut e = base.clone();
    e.funcionarios[0].opcoes[0].turno_id = 99;
    assert!(matches!(
        gerar_escala(&e),
        Err(ErroPlanejamento::TurnoDesconhecido { .. })
    ));

    let mut e = base.clone();
    e.alocacoes_fixas.push(Alocacao {
        funcionario_id: 1,
        turno_id: MANHA,
        data: d(2026, 3, 10),
        horario: t[0].horario,
    });
    assert!(matches!(
        gerar_escala(&e),
        Err(ErroPlanejamento::FixaDentroDoPeriodo { .. })
    ));

    let mut e = base;
    let dup = e.funcionarios[0].clone();
    e.funcionarios.push(dup);
    assert!(matches!(
        gerar_escala(&e),
        Err(ErroPlanejamento::FuncionarioDuplicado(_))
    ));
}

// ---------------------------------------------------------------------------
// Dias de funcionamento do turno
// ---------------------------------------------------------------------------

#[test]
fn turno_seg_sex_nao_recebe_ninguem_no_fim_de_semana_e_fecha_40h() {
    // Fevereiro de 2027 só tem semanas completas: 5 jornadas de 8h em 5 dias.
    let t = com_dias(turnos(2), MANHA, dias(&SEG_SEX));
    let funcs = equipe(4, &t);
    let (ini, fim) = mes(2027, 2);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs.clone());
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);

    assert!(r
        .alocacoes
        .iter()
        .filter(|a| a.turno_id == MANHA)
        .all(|a| !fim_de_semana(a.data)));
    assert!(
        r.alocacoes
            .iter()
            .any(|a| a.turno_id == TARDE && fim_de_semana(a.data)),
        "turnos que funcionam todos os dias continuam recebendo o fim de semana"
    );

    let semanas = horas_por_semana(&r.alocacoes, InicioSemana::Segunda);
    for f in funcs
        .iter()
        .filter(|f| f.opcoes.iter().all(|o| o.turno_id == MANHA))
    {
        for s in semanas_cobrindo(ini, fim, InicioSemana::Segunda).expect("semanas") {
            assert_eq!(
                semanas.get(&(f.id, s)).copied().unwrap_or(0),
                H40,
                "funcionário {} semana {s:?}",
                f.id
            );
        }
    }
    assert!(r.avisos.is_empty(), "{:?}", r.avisos);
}

#[test]
fn semana_que_termina_em_dias_sem_funcionamento_nao_reduz_o_alvo() {
    // Abril/2027 termina numa sexta: sábado e domingo da última semana caem em maio
    // (ainda não gerado), mas o turno seg–sex não funciona neles e não reserva saldo.
    let t = com_dias(turnos(0), MANHA, dias(&SEG_SEX));
    let funcs: Vec<_> = (1..=4).map(|i| funcionario(i, &[MANHA], &t)).collect();
    let (ini, fim) = mes(2027, 4);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs.clone());
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    let ultima = Semana::contendo(fim, InicioSemana::Segunda).expect("semana");
    let semanas = horas_por_semana(&r.alocacoes, InicioSemana::Segunda);
    for f in &funcs {
        assert_eq!(
            semanas.get(&(f.id, ultima)).copied().unwrap_or(0),
            H40,
            "funcionário {}",
            f.id
        );
    }
}

#[test]
fn turno_seg_sab_com_funcionario_de_dois_turnos_escala_domingo_so_no_turno_ativo() {
    // Manhã funciona seg–sáb; Tarde, todos os dias. Domingo só pode ter Tarde.
    let t = com_dias(turnos(1), MANHA, dias(&SEG_SAB));
    let mut funcs = vec![
        funcionario(1, &[MANHA, TARDE], &t),
        funcionario(2, &[MANHA, TARDE], &t),
        funcionario(3, &[MANHA, TARDE], &t),
    ];
    funcs.extend((4..=6).map(|i| funcionario(i, &[MANHA], &t)));
    funcs.extend((7..=9).map(|i| funcionario(i, &[TARDE], &t)));
    let (ini, fim) = mes(2026, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);

    let domingos: Vec<&Alocacao> = r
        .alocacoes
        .iter()
        .filter(|a| a.data.weekday() == Weekday::Sun)
        .collect();
    assert!(!domingos.is_empty());
    assert!(domingos.iter().all(|a| a.turno_id == TARDE));
    // Quem só tem Manhã nunca é escalado no domingo.
    assert!(domingos
        .iter()
        .all(|a| !(4..=6).contains(&a.funcionario_id)));
    // Funcionários com dois turnos também trabalham no domingo, na Tarde.
    assert!(domingos.iter().any(|a| (1..=3).contains(&a.funcionario_id)));
    // O efetivo mínimo da Manhã é atendido de segunda a sábado.
    assert!(!r
        .avisos
        .iter()
        .any(|a| { a.tipo == TipoAviso::CoberturaInsuficiente && a.turno_id == Some(MANHA) }));
}

#[test]
fn efetivo_minimo_nao_gera_aviso_de_cobertura_em_dia_sem_funcionamento() {
    // Mínimo de 3 com só 2 pessoas: falta cobertura nos dias úteis, nunca no fim de semana.
    let t = com_dias(turnos(3), MANHA, dias(&SEG_SEX));
    let funcs: Vec<_> = (1..=2).map(|i| funcionario(i, &[MANHA], &t)).collect();
    let (ini, fim) = mes(2026, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);

    let faltas: Vec<_> = r
        .avisos
        .iter()
        .filter(|a| a.tipo == TipoAviso::CoberturaInsuficiente && a.turno_id == Some(MANHA))
        .collect();
    assert!(faltas.len() >= 20, "{}", faltas.len());
    for a in faltas {
        let data = a.data.expect("aviso diário");
        assert!(
            !fim_de_semana(data),
            "aviso em dia sem funcionamento: {data}"
        );
    }
    assert!(r.alocacoes.iter().all(|a| !fim_de_semana(a.data)));
}

#[test]
fn turno_sem_nenhum_dia_nao_recebe_ninguem_nem_causa_panico() {
    let t = com_dias(turnos(1), MANHA, DiasSemana::NENHUM);
    let funcs = vec![
        funcionario(1, &[MANHA], &t),
        funcionario(2, &[MANHA, TARDE], &t),
    ];
    let (ini, fim) = mes(2026, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert!(r.alocacoes.iter().all(|a| a.turno_id != MANHA));
    assert!(r.alocacoes.iter().any(|a| a.funcionario_id == 2));
    assert!(r.alocacoes.iter().all(|a| a.funcionario_id != 1));
    // O funcionário que só tem o turno inativo não gera aviso de carga abaixo do alvo.
    assert!(!r
        .avisos
        .iter()
        .any(|a| a.tipo == TipoAviso::CargaAbaixoDoAlvo && a.funcionario_id == Some(1)));
}

// ---------------------------------------------------------------------------
// O verificador detecta violações (garante que os testes acima não são vazios)
// ---------------------------------------------------------------------------

#[test]
fn verificador_detecta_hora_extra_descanso_e_dias_seguidos() {
    let t = turnos(0);
    let f = funcionario(1, &[MANHA, NOITE], &t);
    let (ini, fim) = mes(2026, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t.clone(), vec![f]);
    // 02/03 (seg) a 08/03 (dom): 7 dias seguidos de Manhã = 56h.
    let mut alocs: Vec<Alocacao> = (2..=8)
        .map(|dia| Alocacao {
            funcionario_id: 1,
            turno_id: MANHA,
            data: d(2026, 3, dia),
            horario: t[0].horario,
        })
        .collect();
    // Noite em 10/03 seguida de Manhã em 11/03 (descanso zero).
    alocs.push(Alocacao {
        funcionario_id: 1,
        turno_id: NOITE,
        data: d(2026, 3, 10),
        horario: t[2].horario,
    });
    alocs.push(Alocacao {
        funcionario_id: 1,
        turno_id: MANHA,
        data: d(2026, 3, 11),
        horario: t[0].horario,
    });
    let v = verificar(&e, &alocs);
    assert!(v
        .iter()
        .any(|x| matches!(x, Violacao::CargaSemanal { minutos, .. } if *minutos == 56 * 60)));
    assert!(v
        .iter()
        .any(|x| matches!(x, Violacao::DiasConsecutivos { dias: 7, .. })));
    assert!(v
        .iter()
        .any(|x| matches!(x, Violacao::Descanso { minutos: 0, .. })));
}

#[test]
fn verificador_soma_semana_que_atravessa_o_mes() {
    let t = turnos(0);
    let f = funcionario(1, &[MANHA], &t);
    let (ini, fim) = mes(2026, 2); // 01/02/2026 é domingo
    let mut e = entrada(ini, fim, RegrasCarga::default(), t.clone(), vec![f]);
    // 26/01–31/01 (seg–sáb): 5 jornadas fixas = 40h.
    for dia in 26..=30 {
        e.alocacoes_fixas.push(Alocacao {
            funcionario_id: 1,
            turno_id: MANHA,
            data: d(2026, 1, dia),
            horario: t[0].horario,
        });
    }
    let extra = Alocacao {
        funcionario_id: 1,
        turno_id: MANHA,
        data: d(2026, 2, 1),
        horario: t[0].horario,
    };
    assert!(verificar(&e, &[extra])
        .iter()
        .any(|x| matches!(x, Violacao::CargaSemanal { .. })));
}

#[test]
fn verificador_detecta_alocacao_em_turno_inativo_no_dia() {
    let t = vec![Turno {
        id: MANHA,
        nome: "Comercial".into(),
        horario: horario("08:00", "17:00", 60),
        efetivo_minimo: 0,
        ordem: 0,
        dias: dias(&SEG_SEX),
    }];
    let mut ana = funcionario(1, &[MANHA], &t);
    ana.nome = "Ana".into();
    let (ini, fim) = mes(2026, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t.clone(), vec![ana]);
    let aloc = |turno_id: TurnoId, dia: u32| Alocacao {
        funcionario_id: 1,
        turno_id,
        data: d(2026, 3, dia),
        horario: t[0].horario,
    };

    // 07/03/2026 é sábado: o turno Comercial não funciona.
    let v = verificar(&e, &[aloc(MANHA, 6), aloc(MANHA, 7)]);
    let inativos: Vec<&Violacao> = v
        .iter()
        .filter(|x| matches!(x, Violacao::TurnoInativoNoDia { .. }))
        .collect();
    assert_eq!(inativos.len(), 1, "{v:?}");
    assert_eq!(
        inativos[0],
        &Violacao::TurnoInativoNoDia {
            funcionario: "Ana".into(),
            data: d(2026, 3, 7),
            turno: "Comercial".into(),
        }
    );
    assert_eq!(inativos[0].data(), d(2026, 3, 7));
    assert_eq!(
        inativos[0].to_string(),
        "Ana: escalada em 07/03/2026 no turno Comercial, que não funciona nesse dia"
    );

    // Dia de funcionamento: sem violação; turno desconhecido é ignorado nessa checagem.
    assert!(verificar(&e, &[aloc(MANHA, 9)]).is_empty());
    assert!(!verificar(&e, &[aloc(99, 7)])
        .iter()
        .any(|x| matches!(x, Violacao::TurnoInativoNoDia { .. })));
}

// ---------------------------------------------------------------------------
// Propriedade: configurações variadas nunca produzem hora extra
// ---------------------------------------------------------------------------

/// Gerador pseudoaleatório simples e reprodutível (sem dependências externas).
struct Lcg(u64);

impl Lcg {
    fn prox(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn entre(&mut self, min: u64, max: u64) -> u64 {
        min + self.prox() % (max - min + 1)
    }
    fn chance(&mut self, pct: u64) -> bool {
        self.entre(1, 100) <= pct
    }
}

#[test]
fn propriedade_configuracoes_aleatorias_nunca_geram_hora_extra() {
    let mut rng = Lcg(0x5EED_2026);
    for rodada in 0..120 {
        let regras = RegrasCarga {
            carga_semanal_max_min: rng.entre(16, 44) as u32 * 60
                + if rng.chance(30) { 30 } else { 0 },
            jornada_diaria_max_min: rng.entre(6, 10) as u32 * 60,
            descanso_entre_jornadas_min: rng.entre(8, 12) as u32 * 60,
            max_dias_consecutivos: rng.entre(3, 7) as u32,
            inicio_semana: if rng.chance(50) {
                InicioSemana::Segunda
            } else {
                InicioSemana::Domingo
            },
            folgas_semanais_min: rng.entre(1, 2) as u32,
            domingos_seguidos_max: [0, 0, 2, 3][rng.entre(0, 3) as usize],
        };
        let regras = RegrasCarga {
            jornada_diaria_max_min: regras
                .jornada_diaria_max_min
                .min(regras.carga_semanal_max_min),
            ..regras
        };
        let mut t = Vec::new();
        let qtd_turnos = rng.entre(1, 4);
        for i in 0..qtd_turnos {
            let inicio = rng.entre(0, 23) as u32;
            let duracao = rng.entre(4, 12) as u32;
            let intervalo = if rng.chance(40) {
                rng.entre(15, 60) as u32
            } else {
                0
            };
            let h = Horario::novo(
                HoraDoDia::de_hm(inicio, 0).expect("hora"),
                HoraDoDia::de_hm((inicio + duracao) % 24, if rng.chance(30) { 30 } else { 0 })
                    .expect("hora"),
                intervalo,
            )
            .expect("horário");
            t.push(Turno {
                id: i as i64 + 1,
                nome: format!("T{i}"),
                horario: h,
                efetivo_minimo: rng.entre(0, 3) as u32,
                ordem: i as i32,
                dias: if rng.chance(50) {
                    DiasSemana::TODOS
                } else {
                    DiasSemana::de_bits(rng.entre(1, 127) as u8)
                },
            });
        }
        let mut funcs = Vec::new();
        for id in 1..=rng.entre(1, 18) as i64 {
            let opcoes: Vec<TurnoId> = t.iter().filter(|_| rng.chance(45)).map(|x| x.id).collect();
            let opcoes = if opcoes.is_empty() {
                vec![t[0].id]
            } else {
                opcoes
            };
            let mut f = funcionario(id, &opcoes, &t);
            if rng.chance(25) {
                f.carga_semanal_min = Some(rng.entre(12, 44) as u32 * 60);
            }
            if rng.chance(25) {
                f.dias_disponiveis = DiasSemana::de_bits(rng.entre(1, 127) as u8);
            }
            if rng.chance(20) {
                let inicio = d(2026, rng.entre(1, 12) as u32, rng.entre(1, 28) as u32);
                f.indisponivel = inicio.iter_days().take(rng.entre(1, 20) as usize).collect();
            }
            funcs.push(f);
        }
        let mut sim = Simulacao::nova(regras, t, funcs);
        if rng.chance(40) {
            // Regime da EC 141 com publicação em data aleatória de 2026.
            sim.regime = etapas_ec141(d(2026, rng.entre(1, 9) as u32, rng.entre(1, 28) as u32));
        }
        let primeiro = rng.entre(1, 10) as u32;
        let mut meses: Vec<u32> = (primeiro..=primeiro + 2).collect();
        if rng.chance(50) {
            meses.swap(0, 2); // gera fora de ordem
        }
        for m in meses {
            let (e, r) = sim.gerar(2026, m);
            assert_limite_semanal(&r.alocacoes, &e.funcionarios, &e.regras);
        }
        sim.verificar_tudo();
        let _ = rodada;
    }
}

// ---------------------------------------------------------------------------
// Fim da escala 6x1 (EC 141/2026): folgas semanais, transição e domingos
// ---------------------------------------------------------------------------

/// Dias trabalhados por (funcionário, semana).
fn dias_por_semana(
    alocacoes: &[Alocacao],
    inicio_semana: InicioSemana,
) -> BTreeMap<(FuncionarioId, Semana), u32> {
    let mut m = BTreeMap::new();
    for a in alocacoes {
        let s = Semana::contendo(a.data, inicio_semana).expect("semana");
        *m.entry((a.funcionario_id, s)).or_insert(0) += 1;
    }
    m
}

#[test]
fn transicao_da_ec141_reduz_para_42h_e_exige_duas_folgas() {
    // Empresa na regra antiga (44h, 1 folga); o regime legal aplica a transição.
    let regras = RegrasCarga {
        carga_semanal_max_min: 44 * 60,
        ..RegrasCarga::default()
    };
    // Turno de 7h20: 6 jornadas = 44h (6x1); a partir de 16/12/2026 só cabem 5 (2 folgas).
    let t = vec![Turno {
        id: MANHA,
        nome: "Comercial".into(),
        horario: horario("08:00", "15:20", 0),
        efetivo_minimo: 0,
        ordem: 0,
        dias: DiasSemana::TODOS,
    }];
    let funcs: Vec<_> = (1..=6).map(|i| funcionario(i, &[MANHA], &t)).collect();
    let mut sim = Simulacao::nova(regras, t, funcs);
    sim.regime = etapas_ec141(d(2026, 10, 16));
    for (a, m) in [(2026, 11), (2026, 12), (2027, 1)] {
        sim.gerar(a, m);
    }
    sim.verificar_tudo();
    let todas = sim.todas();
    let virada = d(2026, 12, 16);
    for ((id, semana), dias) in dias_por_semana(&todas, InicioSemana::Segunda) {
        let minutos = horas_por_semana(&todas, InicioSemana::Segunda)[&(id, semana)];
        if semana.fim < virada {
            assert!(
                dias <= 6 && minutos <= 44 * 60,
                "antes da EC: {dias} dias, {minutos} min"
            );
        } else {
            assert!(
                dias <= 5,
                "{id}: {dias} dias na semana {semana:?} (exige 2 folgas)"
            );
            assert!(
                minutos <= 42 * 60,
                "{id}: {minutos} min na semana {semana:?}"
            );
        }
    }
    // Semanas completas antes da virada usam a 6x1 (44h); depois, 5 jornadas (36h40).
    let antes = Semana::contendo(d(2026, 11, 9), InicioSemana::Segunda).expect("semana");
    let depois = Semana::contendo(d(2027, 1, 11), InicioSemana::Segunda).expect("semana");
    let horas = horas_por_semana(&todas, InicioSemana::Segunda);
    assert!(sim
        .funcionarios
        .iter()
        .all(|f| horas.get(&(f.id, antes)) == Some(&(6 * 440))));
    assert!(sim
        .funcionarios
        .iter()
        .all(|f| horas.get(&(f.id, depois)) == Some(&(5 * 440))));
}

#[test]
fn fase_final_da_ec141_limita_a_40h() {
    let regras = RegrasCarga {
        carga_semanal_max_min: 44 * 60,
        ..RegrasCarga::default()
    };
    let t = turnos(1);
    let mut sim = Simulacao::nova(regras, t.clone(), equipe(3, &t));
    sim.regime = etapas_ec141(d(2026, 10, 16));
    sim.gerar(2028, 2);
    sim.verificar_tudo();
    for (_, minutos) in horas_por_semana(&sim.todas(), InicioSemana::Segunda) {
        assert!(minutos <= 40 * 60);
    }
}

#[test]
fn folgas_minimas_limitam_dias_mesmo_com_horas_sobrando() {
    // Turnos de 4h e 44h semanais: sem a regra caberiam 11 jornadas; com 2 folgas, no máximo 5.
    let regras = RegrasCarga {
        carga_semanal_max_min: 44 * 60,
        folgas_semanais_min: 2,
        ..RegrasCarga::default()
    };
    let t = vec![Turno {
        id: MANHA,
        nome: "Meio período".into(),
        horario: horario("08:00", "12:00", 0),
        efetivo_minimo: 0,
        ordem: 0,
        dias: DiasSemana::TODOS,
    }];
    let funcs: Vec<_> = (1..=4).map(|i| funcionario(i, &[MANHA], &t)).collect();
    let (ini, fim) = mes(2027, 2);
    let e = entrada(ini, fim, regras, t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    for (_, dias) in dias_por_semana(&r.alocacoes, InicioSemana::Segunda) {
        assert_eq!(dias, 5);
    }
}

#[test]
fn domingos_seguidos_respeitam_o_maximo_e_rodam_entre_a_equipe() {
    // Loja aberta todos os dias, 1 pessoa mínima por dia; ninguém trabalha 3 domingos seguidos.
    let regras = RegrasCarga {
        folgas_semanais_min: 2,
        domingos_seguidos_max: 2,
        ..RegrasCarga::default()
    };
    let t = turnos(0);
    let t = vec![Turno {
        efetivo_minimo: 2,
        ..t[0].clone()
    }];
    let funcs: Vec<_> = (1..=5).map(|i| funcionario(i, &[MANHA], &t)).collect();
    let mut sim = Simulacao::nova(regras, t, funcs);
    for m in 1..=4 {
        sim.gerar(2027, m);
    }
    sim.verificar_tudo();
    let todas = sim.todas();
    let mut por_pessoa: BTreeMap<FuncionarioId, u32> = BTreeMap::new();
    for a in todas.iter().filter(|a| a.data.weekday() == Weekday::Sun) {
        *por_pessoa.entry(a.funcionario_id).or_default() += 1;
    }
    let (min, max) = (
        por_pessoa.values().min().copied().unwrap_or(0),
        por_pessoa.values().max().copied().unwrap_or(0),
    );
    // Rodízio aproximado: em 17 domingos, ninguém trabalha mais que 3 domingos a mais que outro.
    assert!(max - min <= 3, "domingos mal distribuídos: {por_pessoa:?}");
}

#[test]
fn verificador_detecta_falta_de_folga_e_domingos_seguidos() {
    let regras = RegrasCarga {
        folgas_semanais_min: 2,
        domingos_seguidos_max: 1,
        ..RegrasCarga::default()
    };
    let t = vec![Turno {
        id: MANHA,
        nome: "Curto".into(),
        horario: horario("08:00", "12:00", 0),
        efetivo_minimo: 0,
        ordem: 0,
        dias: DiasSemana::TODOS,
    }];
    let f = funcionario(1, &[MANHA], &t);
    let (ini, fim) = mes(2026, 3);
    let e = entrada(ini, fim, regras, t.clone(), vec![f]);
    // 02/03 (seg) a 07/03 (sáb): 6 dias = 24h, dentro das horas mas sem as 2 folgas.
    let mut alocs: Vec<Alocacao> = (2..=7)
        .map(|dia| Alocacao {
            funcionario_id: 1,
            turno_id: MANHA,
            data: d(2026, 3, dia),
            horario: t[0].horario,
        })
        .collect();
    // Domingos 15/03 e 22/03 seguidos com máximo 1.
    for dia in [15, 22] {
        alocs.push(Alocacao {
            funcionario_id: 1,
            turno_id: MANHA,
            data: d(2026, 3, dia),
            horario: t[0].horario,
        });
    }
    let v = verificar(&e, &alocs);
    assert!(
        v.iter().any(|x| matches!(
            x,
            Violacao::FolgasSemanais {
                dias_trabalhados: 6,
                folgas_minimas: 2,
                ..
            }
        )),
        "{v:?}"
    );
    assert!(
        v.iter().any(|x| matches!(
            x,
            Violacao::DomingosSeguidos {
                domingos: 2,
                maximo: 1,
                ..
            }
        )),
        "{v:?}"
    );
}

// ---------------------------------------------------------------------------
// Distribuição entre horários
// ---------------------------------------------------------------------------

#[test]
fn quem_pode_varios_horarios_e_distribuido_e_fica_no_mesmo_no_mes() {
    // 12 pessoas que preferem a Manhã, mas podem fazer Manhã, Tarde ou Noite.
    let t = turnos(1);
    let funcs: Vec<_> = (1..=12)
        .map(|i| funcionario(i, &[MANHA, TARDE, NOITE], &t))
        .collect();
    let (ini, fim) = mes(2027, 2);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    // Cada pessoa fica num só horário no mês.
    let mut horario: BTreeMap<FuncionarioId, BTreeSet<TurnoId>> = BTreeMap::new();
    for a in &r.alocacoes {
        horario
            .entry(a.funcionario_id)
            .or_default()
            .insert(a.turno_id);
    }
    assert!(horario.values().all(|h| h.len() == 1), "{horario:?}");
    // E os horários ficam equilibrados: 4 pessoas em cada.
    let mut por_turno: BTreeMap<TurnoId, usize> = BTreeMap::new();
    for h in horario.values() {
        for t in h {
            *por_turno.entry(*t).or_default() += 1;
        }
    }
    assert_eq!(
        por_turno.values().copied().collect::<Vec<_>>(),
        vec![4, 4, 4]
    );
    // Todo dia todos os horários têm gente.
    for dia in ini.iter_days().take_while(|d| *d <= fim) {
        for turno in [MANHA, TARDE, NOITE] {
            assert!(
                r.alocacoes
                    .iter()
                    .any(|a| a.data == dia && a.turno_id == turno),
                "{dia} sem {turno}"
            );
        }
    }
}

#[test]
fn horario_do_mes_anterior_e_mantido_se_estiver_equilibrado() {
    let t = turnos(0);
    // 2 pessoas, ambas podem Manhã ou Tarde; no mês anterior, a 1 fazia Tarde.
    let funcs: Vec<_> = (1..=2)
        .map(|i| funcionario(i, &[MANHA, TARDE], &t))
        .collect();
    let (ini, fim) = mes(2026, 3);
    let mut e = entrada(ini, fim, RegrasCarga::default(), t.clone(), funcs);
    e.alocacoes_fixas.push(Alocacao {
        funcionario_id: 1,
        turno_id: TARDE,
        data: d(2026, 2, 27),
        horario: t[1].horario,
    });
    e.datas_planejadas.insert(d(2026, 2, 27));
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    assert!(r
        .alocacoes
        .iter()
        .filter(|a| a.funcionario_id == 1)
        .all(|a| a.turno_id == TARDE));
    assert!(r
        .alocacoes
        .iter()
        .filter(|a| a.funcionario_id == 2)
        .all(|a| a.turno_id == MANHA));
}

// ---------------------------------------------------------------------------
// Funcionamento do estabelecimento e preferência de período
// ---------------------------------------------------------------------------

/// Loja de shopping aberta todos os dias, das 10h às 22h, com jornada de 6h + 15 min.
fn turnos_da_loja() -> Vec<Turno> {
    let janelas: Vec<JanelaDia> = (0..7)
        .map(|dia| JanelaDia {
            dia,
            abre: "10:00".parse().expect("hora"),
            fecha: "22:00".parse().expect("hora"),
        })
        .collect();
    gerar_turnos(&janelas, 6 * 60, 15)
        .expect("turnos")
        .into_iter()
        .enumerate()
        .map(|(i, g)| Turno {
            id: i as TurnoId + 1,
            nome: g.nome,
            horario: g.horario,
            efetivo_minimo: 1,
            ordem: i as i32,
            dias: g.dias,
        })
        .collect()
}

fn com_preferencia(
    id: FuncionarioId,
    preferencia: Option<Periodo>,
    turnos: &[Turno],
) -> FuncionarioPlano {
    let ids: Vec<TurnoId> = turnos.iter().map(|t| t.id).collect();
    FuncionarioPlano {
        preferencia,
        ..funcionario(id, &ids, turnos)
    }
}

fn turno_de_cada_um(r: &ResultadoPlanejamento) -> BTreeMap<FuncionarioId, BTreeSet<TurnoId>> {
    let mut m: BTreeMap<FuncionarioId, BTreeSet<TurnoId>> = BTreeMap::new();
    for a in &r.alocacoes {
        m.entry(a.funcionario_id).or_default().insert(a.turno_id);
    }
    m
}

#[test]
fn loja_de_shopping_intercala_abertura_e_fechamento() {
    let t = turnos_da_loja();
    assert_eq!(t.len(), 2);
    let (abre, fecha) = (t[0].id, t[1].id);
    let funcs: Vec<_> = (1..=10).map(|i| com_preferencia(i, None, &t)).collect();
    let (ini, fim) = mes(2027, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);

    let por_pessoa = turno_de_cada_um(&r);
    assert!(por_pessoa.values().all(|h| h.len() == 1), "{por_pessoa:?}");
    let abrem = por_pessoa.values().filter(|h| h.contains(&abre)).count();
    assert_eq!(abrem, 5);
    // Todo dia a loja tem gente na abertura e no fechamento.
    for dia in ini.iter_days().take_while(|d| *d <= fim) {
        for turno in [abre, fecha] {
            assert!(
                r.alocacoes
                    .iter()
                    .any(|a| a.data == dia && a.turno_id == turno),
                "{dia} sem o turno {turno}"
            );
        }
    }
}

#[test]
fn preferencia_de_periodo_e_atendida_quando_ha_vaga() {
    let t = turnos_da_loja();
    let (manha, tarde) = (t[0].id, t[1].id);
    // 6 preferem manhã, 3 preferem tarde e 1 não tem preferência: vagas de 5 e 5.
    let mut funcs: Vec<_> = (1..=6)
        .map(|i| com_preferencia(i, Some(Periodo::Manha), &t))
        .collect();
    funcs.extend((7..=9).map(|i| com_preferencia(i, Some(Periodo::Tarde), &t)));
    funcs.push(com_preferencia(10, None, &t));
    let (ini, fim) = mes(2027, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);

    let por_pessoa = turno_de_cada_um(&r);
    let turno = |id: FuncionarioId| por_pessoa.get(&id).and_then(|h| h.iter().next()).copied();
    // Quem prefere a tarde fica na tarde.
    assert!((7..=9).all(|i| turno(i) == Some(tarde)));
    // Da manhã, 5 ficam na manhã e 1 vai para a tarde para equilibrar.
    assert_eq!((1..=6).filter(|i| turno(*i) == Some(manha)).count(), 5);
    // Quem não tem preferência completa a tarde.
    assert_eq!(turno(10), Some(tarde));
}

// ---------------------------------------------------------------------------
// Saldo de horas, faltas e ausências justificadas
// ---------------------------------------------------------------------------

/// Loja 10h–22h com 6 pessoas; regras padrão (40h, 8h por dia, 1 folga): previsto de 36h.
fn loja_marco_2027(
    ajuste: impl FnOnce(&mut FuncionarioPlano),
) -> (EntradaPlanejamento, ResultadoPlanejamento) {
    let t = turnos_da_loja();
    let mut funcs: Vec<_> = (1..=6).map(|i| com_preferencia(i, None, &t)).collect();
    ajuste(&mut funcs[0]);
    let (ini, fim) = mes(2027, 3);
    let e = entrada(ini, fim, RegrasCarga::default(), t, funcs);
    let r = gerar_escala(&e).expect("geração");
    assert_sem_violacoes(&e, &r);
    (e, r)
}

fn minutos_entre(
    r: &ResultadoPlanejamento,
    f: FuncionarioId,
    de: NaiveDate,
    ate: NaiveDate,
) -> u32 {
    r.alocacoes
        .iter()
        .filter(|a| a.funcionario_id == f && de <= a.data && a.data <= ate)
        .map(|a| a.minutos_trabalhados())
        .sum()
}

#[test]
fn horas_a_mais_do_mes_anterior_viram_folga_a_mais() {
    let (_, r) = loja_marco_2027(|f| f.saldo_anterior_min = 6 * 60);
    // Primeira semana fechada: uma jornada a menos; depois volta ao previsto.
    assert_eq!(minutos_entre(&r, 1, d(2027, 3, 1), d(2027, 3, 7)), 30 * 60);
    assert_eq!(minutos_entre(&r, 1, d(2027, 3, 8), d(2027, 3, 14)), 36 * 60);
    assert_eq!(minutos_entre(&r, 2, d(2027, 3, 1), d(2027, 3, 7)), 36 * 60);
}

#[test]
fn poucas_horas_a_mais_encurtam_uma_jornada() {
    let (_, r) = loja_marco_2027(|f| f.saldo_anterior_min = 2 * 60);
    assert_eq!(minutos_entre(&r, 1, d(2027, 3, 1), d(2027, 3, 7)), 34 * 60);
    assert_eq!(minutos_entre(&r, 1, d(2027, 3, 8), d(2027, 3, 14)), 36 * 60);
}

#[test]
fn horas_devidas_sao_pagas_esticando_jornadas_dentro_do_limite() {
    let (_, r) = loja_marco_2027(|f| f.saldo_anterior_min = -4 * 60);
    // 36h previstas + 4h devidas = 40h, o limite semanal; nenhuma jornada passa de 8h.
    assert_eq!(minutos_entre(&r, 1, d(2027, 3, 1), d(2027, 3, 7)), 40 * 60);
    assert_eq!(minutos_entre(&r, 1, d(2027, 3, 8), d(2027, 3, 14)), 36 * 60);
    let esticadas: Vec<&Alocacao> = r
        .alocacoes
        .iter()
        .filter(|a| a.funcionario_id == 1 && a.minutos_trabalhados() > 360)
        .collect();
    assert!(!esticadas.is_empty());
    for a in esticadas {
        assert!(a.minutos_trabalhados() <= 8 * 60);
        // Acima de 6h, o intervalo passa a 1h e o horário fica dentro das 10h às 22h.
        assert_eq!(a.horario.intervalo_min(), 60);
        assert!(a.horario.inicio() >= "10:00".parse().expect("hora"));
        assert!(a.horario.fim() <= "22:00".parse().expect("hora"));
    }
}

#[test]
fn falta_nao_e_escalada_e_as_horas_sao_pagas_na_mesma_semana_quando_cabe() {
    // Duas faltas na primeira semana: sobram 5 dias (30h de 36h previstas). Com 5
    // dias há folga até o limite de 40h, então as jornadas da semana esticam e ela
    // fecha nas 36h, sem passar de 8h por dia.
    let faltas = [d(2027, 3, 2), d(2027, 3, 3)];
    let (_, r) = loja_marco_2027(|f| f.faltas.extend(faltas));
    assert!(r
        .alocacoes
        .iter()
        .all(|a| !(a.funcionario_id == 1 && faltas.contains(&a.data))));
    assert_eq!(minutos_entre(&r, 1, d(2027, 3, 1), d(2027, 3, 7)), 36 * 60);
    assert_eq!(minutos_entre(&r, 1, d(2027, 3, 8), d(2027, 3, 14)), 36 * 60);
    let semana1: Vec<&Alocacao> = r
        .alocacoes
        .iter()
        .filter(|a| a.funcionario_id == 1 && a.data <= d(2027, 3, 7))
        .collect();
    assert_eq!(semana1.len(), 5);
    assert!(semana1.iter().all(|a| a.minutos_trabalhados() <= 8 * 60));
}

#[test]
fn ausencia_justificada_abona_a_jornada_do_dia() {
    let (_, r) = loja_marco_2027(|f| {
        f.indisponivel.insert(d(2027, 3, 3));
    });
    assert!(r
        .alocacoes
        .iter()
        .all(|a| !(a.funcionario_id == 1 && a.data == d(2027, 3, 3))));
    // Previsto de 5 jornadas (30h) e nenhuma jornada esticada para "pagar" o dia.
    assert_eq!(minutos_entre(&r, 1, d(2027, 3, 1), d(2027, 3, 7)), 30 * 60);
    assert!(r
        .alocacoes
        .iter()
        .filter(|a| a.funcionario_id == 1)
        .all(|a| a.minutos_trabalhados() == 360));
}

#[test]
fn rodizio_de_domingos_nao_deixa_o_domingo_vazio_com_limite_de_dois_seguidos() {
    // Comércio (Lei 10.101): no máximo 2 domingos seguidos. Sem rodízio escalonado,
    // a equipe toda chegaria ao limite junta e o 3º domingo ficaria vazio.
    let t = turnos_da_loja();
    let funcs: Vec<_> = (1..=10).map(|i| com_preferencia(i, None, &t)).collect();
    let regras = RegrasCarga {
        domingos_seguidos_max: 2,
        carga_semanal_max_min: 44 * 60,
        ..RegrasCarga::default()
    };
    let mut sim = Simulacao::nova(regras, t.clone(), funcs);
    for m in 1..=3 {
        sim.gerar(2027, m);
    }
    sim.verificar_tudo();
    let domingos: BTreeSet<NaiveDate> = sim
        .todas()
        .iter()
        .map(|a| a.data)
        .filter(|d| d.weekday() == Weekday::Sun)
        .collect();
    assert!(domingos.len() >= 12);
    for dia in &domingos {
        for turno in &t {
            let n = sim
                .todas()
                .iter()
                .filter(|a| a.data == *dia && a.turno_id == turno.id)
                .count();
            assert!(n >= 2, "{dia}: {} com {n} pessoa(s)", turno.nome);
        }
    }
}

// ---------------------------------------------------------------------------
// Cobertura por função
// ---------------------------------------------------------------------------

fn com_funcao(
    id: FuncionarioId,
    funcao: &str,
    preferencia: Option<Periodo>,
    t: &[Turno],
) -> FuncionarioPlano {
    FuncionarioPlano {
        funcao: Some(funcao.to_string()),
        ..com_preferencia(id, preferencia, t)
    }
}

fn minimos(funcoes: &[(&str, u32)]) -> BTreeMap<String, FuncaoMinima> {
    funcoes
        .iter()
        .map(|(f, m)| {
            (
                f.to_string(),
                FuncaoMinima {
                    nome: f.to_string(),
                    minimo: *m,
                },
            )
        })
        .collect()
}

#[test]
fn cafeteria_tem_atendente_e_cozinheiro_em_todo_turno_todo_dia() {
    // 6 atendentes e 4 cozinheiros, todos preferindo a manhã: a preferência sozinha
    // deixaria a tarde sem cozinheiro.
    let t = turnos_da_loja();
    let mut funcs: Vec<_> = (1..=6)
        .map(|i| com_funcao(i, "atendente", Some(Periodo::Manha), &t))
        .collect();
    funcs.extend((7..=10).map(|i| com_funcao(i, "cozinheiro", Some(Periodo::Manha), &t)));
    let regras = RegrasCarga {
        carga_semanal_max_min: 44 * 60,
        domingos_seguidos_max: 2,
        ..RegrasCarga::default()
    };
    let mut sim = Simulacao::nova(regras, t.clone(), funcs);
    sim.minimo_por_funcao = minimos(&[("atendente", 1), ("cozinheiro", 1)]);
    // Atravessa a mudança da EC 141 (16/12/2026: 42h e 2 folgas).
    sim.regime = etapas_ec141(d(2026, 10, 16));
    let mut avisos = Vec::new();
    for (ano, m) in [(2026, 11), (2026, 12), (2027, 1), (2027, 2)] {
        avisos.extend(sim.gerar(ano, m).1.avisos);
    }
    sim.verificar_tudo();
    assert!(
        avisos.iter().all(|a| a.tipo != TipoAviso::FuncaoDescoberta),
        "{:?}",
        avisos
            .iter()
            .filter(|a| a.tipo == TipoAviso::FuncaoDescoberta)
            .collect::<Vec<_>>()
    );
    let todas = sim.todas();
    let (ini, fim) = (d(2026, 11, 1), d(2027, 2, 28));
    for dia in ini.iter_days().take_while(|x| *x <= fim) {
        for turno in &t {
            for (faixa, ids) in [("atendente", 1..=6), ("cozinheiro", 7..=10)] {
                assert!(
                    todas.iter().any(|a| a.data == dia
                        && a.turno_id == turno.id
                        && ids.contains(&a.funcionario_id)),
                    "{dia}: {} sem {faixa}",
                    turno.nome
                );
            }
        }
    }
}

#[test]
fn funcao_com_gente_de_menos_gera_aviso_sem_quebrar_regra() {
    // Um cozinheiro só não cobre dois turnos todos os dias: a escala sai, sem hora
    // extra, com o aviso da função descoberta.
    let t = turnos_da_loja();
    let mut funcs: Vec<_> = (1..=6)
        .map(|i| com_funcao(i, "atendente", None, &t))
        .collect();
    funcs.push(com_funcao(7, "cozinheiro", None, &t));
    let mut sim = Simulacao::nova(RegrasCarga::default(), t, funcs);
    sim.minimo_por_funcao = minimos(&[("cozinheiro", 1)]);
    let (_, r) = sim.gerar(2027, 3);
    sim.verificar_tudo();
    let descobertas: Vec<&Aviso> = r
        .avisos
        .iter()
        .filter(|a| a.tipo == TipoAviso::FuncaoDescoberta)
        .collect();
    assert!(!descobertas.is_empty());
    assert!(descobertas
        .iter()
        .all(|a| a.mensagem.starts_with("cozinheiro: turno")));
    // Um aviso por semana e turno, com os dias juntos.
    assert!(descobertas.len() <= 2 * 6, "{}", descobertas.len());
}

// ---------------------------------------------------------------------------
// Reequilibrar o resto do mês com jornadas travadas
// ---------------------------------------------------------------------------

#[test]
fn reequilibrar_respeita_o_ajuste_manual_e_tira_outro_dia_da_semana() {
    // Março gerado inteiro; depois, à mão, a pessoa 1 trabalha num dia de folga da
    // semana de 15 a 21/03. Reequilibrar a partir de 10/03 mantém o dia editado e tira
    // outro dia dessa semana, fechando nas 36h previstas.
    let (e, r) = loja_marco_2027(|_| {});
    let semana = (d(2027, 3, 15), d(2027, 3, 21));
    let trabalhados: BTreeSet<NaiveDate> = r
        .alocacoes
        .iter()
        .filter(|a| a.funcionario_id == 1 && semana.0 <= a.data && a.data <= semana.1)
        .map(|a| a.data)
        .collect();
    let folga = semana
        .0
        .iter_days()
        .take_while(|x| *x <= semana.1)
        .find(|x| !trabalhados.contains(x))
        .expect("dia de folga");
    let modelo = r
        .alocacoes
        .iter()
        .find(|a| a.funcionario_id == 1)
        .expect("jornada");
    let travada = Alocacao {
        data: folga,
        ..*modelo
    };
    let inicio = d(2027, 3, 10);
    let mut e2 = e.clone();
    e2.inicio = inicio;
    e2.alocacoes_fixas = r
        .alocacoes
        .iter()
        .filter(|a| a.data < inicio)
        .copied()
        .collect();
    e2.datas_planejadas
        .extend(d(2027, 3, 1).iter_days().take_while(|x| *x < inicio));
    e2.alocacoes_travadas = vec![travada];
    let r2 = gerar_escala(&e2).expect("reequilíbrio");
    assert!(r2.alocacoes.iter().all(|a| a.data >= inicio));
    assert!(r2
        .alocacoes
        .iter()
        .all(|a| !(a.funcionario_id == 1 && a.data == folga)));
    let mut todas: Vec<Alocacao> = e2.alocacoes_fixas.clone();
    todas.push(travada);
    todas.extend(r2.alocacoes.iter().copied());
    let completo = EntradaPlanejamento {
        inicio: d(2027, 3, 1),
        alocacoes_fixas: Vec::new(),
        alocacoes_travadas: Vec::new(),
        ..e2.clone()
    };
    assert!(
        verificar(&completo, &todas).is_empty(),
        "{:?}",
        verificar(&completo, &todas)
    );
    let horas: u32 = todas
        .iter()
        .filter(|a| a.funcionario_id == 1 && semana.0 <= a.data && a.data <= semana.1)
        .map(|a| a.minutos_trabalhados())
        .sum();
    assert_eq!(horas, 36 * 60);

    // Jornada travada fora do período é recusada.
    let mut e3 = e2.clone();
    e3.alocacoes_travadas = vec![Alocacao {
        data: d(2027, 3, 2),
        ..travada
    }];
    assert!(matches!(
        gerar_escala(&e3),
        Err(ErroPlanejamento::TravadaForaDoPeriodo { .. })
    ));
}
