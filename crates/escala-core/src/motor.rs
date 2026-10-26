//! Motor de distribuição automática de escalas.
//!
//! # Garantias (restrições rígidas — nunca violadas)
//! - Carga semanal: minutos da semana completa de apuração (incluindo dias de
//!   meses vizinhos já gerados, passados em `alocacoes_fixas`) nunca passam de
//!   `min(carga contratual, regra do cliente, regime legal vigente)`. Portanto não
//!   há hora extra.
//! - Folgas semanais: dias trabalhados na semana ≤ 7 − folgas mínimas (a maior
//!   exigência entre empresa e regime legal; 2 folgas no fim da escala 6x1).
//! - Domingos seguidos: quando configurado, ninguém trabalha mais domingos em
//!   sequência que o permitido (folga dominical periódica do comércio).
//! - Jornada diária: horários acima de `jornada_diaria_max_min` são descartados.
//! - Descanso mínimo entre jornadas e máximo de dias consecutivos, também
//!   considerando as alocações fixas antes e depois do período.
//! - Dias indisponíveis (dia da semana não disponível, férias, afastamentos).
//! - Dias de funcionamento do turno: ninguém é escalado em um turno num dia da
//!   semana em que ele não funciona.
//! - No máximo uma jornada por funcionário por dia.
//!
//! # Objetivo (heurística gulosa, determinística)
//! Cada funcionário recebe, por semana, uma carga-alvo igual ao seu teto menos as
//! horas já fixadas na semana. Quando parte da semana está em um mês ainda não
//! gerado, o alvo é proporcional aos dias disponíveis dentro do período, deixando
//! saldo para o mês vizinho. Os dias são processados em ordem; em cada dia, cada
//! turno tem uma cota (demanda restante ÷ dias restantes, no mínimo o efetivo
//! mínimo), e os funcionários com maior "pressão" (turnos que faltam ÷ dias que
//! restam) entram primeiro. Quem não pode mais folgar sem perder o alvo é
//! escalado mesmo acima da cota. Isso espalha as folgas (ex.: 5x2) e equilibra a
//! cobertura dos turnos. Cota e efetivo mínimo só valem nos dias em que o turno
//! funciona, e um dia só conta como "possível" para o funcionário se ele está
//! disponível e ao menos um turno dele funciona nesse dia. Aos domingos, entre os
//! que podem folgar, folga primeiro quem trabalhou mais domingos recentes — a
//! folga é "preferencialmente aos domingos" e o domingo de trabalho roda entre todos.
//!
//! # Saldo de horas
//! Cada semana fechada (sem dias em mês ainda não gerado) tem horas previstas
//! (`saldo::previsto_da_semana`). O saldo vindo de meses anteriores e o que sobrar
//! ou faltar na semana são compensados dentro das regras: com horas a mais, a
//! pessoa ganha uma folga a mais na semana ou sai mais cedo (até 2h); devendo,
//! ganha uma jornada a mais se o limite e as folgas deixarem, ou fica até mais
//! tarde/chega mais cedo dentro do horário de funcionamento, sem passar da jornada
//! diária máxima nem do limite semanal e respeitando o descanso entre jornadas.
//!
//! # Funções
//! Com mínimo por função (ex.: 1 cozinheiro e 1 atendente em cada turno), cada
//! função é espalhada pelas faixas antes da preferência de período; em cada dia,
//! quem cobre a função entra antes dos demais e, se ainda faltar, alguém da função
//! com saldo semanal é chamado (mesmo de outra faixa). Sem ninguém, a semana gera
//! um aviso de função descoberta.
//!
//! # Horários
//! Quem pode fazer mais de um turno recebe uma faixa do dia para o período inteiro
//! (abertura, fechamento, ...), igual para todos os dias: na loja que abre das 10h
//! às 22h com jornada de 6h, metade da equipe abre e metade fecha. As faixas ficam
//! com o mesmo número de pessoas; a faixa do mês anterior e a preferência de
//! período (manhã, tarde, noite) são atendidas enquanto houver vaga.

use std::cmp::{Ordering, Reverse};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use chrono::{Datelike, NaiveDate, Weekday};
use thiserror::Error;

use crate::agenda::Agenda;
use crate::calendario::{semanas_cobrindo, Semana};
use crate::funcionamento::{intervalo_padrao, Periodo};
use crate::hora::{formatar_minutos, HoraDoDia, Horario};
use crate::modelo::{
    Alocacao, Aviso, DiasSemana, ErroRegras, FuncaoMinima, FuncionarioId, FuncionarioPlano,
    OpcaoTurno, RegrasCarga, TipoAviso, Turno, TurnoId,
};
use crate::regime::{limite_do_funcionario, limites_da_semana, EtapaRegime, LimitesSemana};
use crate::saldo::previsto_da_semana;

const SEMANA: [Weekday; 7] = [
    Weekday::Mon,
    Weekday::Tue,
    Weekday::Wed,
    Weekday::Thu,
    Weekday::Fri,
    Weekday::Sat,
    Weekday::Sun,
];

const MINUTOS_NO_DIA: u32 = 24 * 60;

/// Passo dos ajustes de horário na compensação de saldo.
const PASSO_AJUSTE_MIN: u32 = 15;
/// Quanto uma jornada pode encolher na compensação de horas a mais.
const MAX_ENCURTAR_MIN: u32 = 2 * 60;
/// Jornada mínima depois de encurtada.
const JORNADA_MIN_ENCURTADA: u32 = 4 * 60;

/// Semanas olhadas para trás ao decidir quem folga no domingo.
const SEMANAS_HISTORICO_DOMINGO: i64 = 8;

/// Maior período aceito em uma geração.
pub const MAX_DIAS_PERIODO: i64 = 366;

/// Tudo o que o motor precisa para gerar a escala de um período.
#[derive(Debug, Clone)]
pub struct EntradaPlanejamento {
    /// Primeiro dia do período (inclusive).
    pub inicio: NaiveDate,
    /// Último dia do período (inclusive).
    pub fim: NaiveDate,
    pub regras: RegrasCarga,
    pub turnos: Vec<Turno>,
    pub funcionarios: Vec<FuncionarioPlano>,
    /// Alocações já existentes fora do período (meses vizinhos). Contam para os
    /// limites, mas não são alteradas.
    pub alocacoes_fixas: Vec<Alocacao>,
    /// Jornadas dentro do período que ficam como estão (ajustes feitos à mão, ao
    /// reequilibrar o resto do mês). Contam para limites, folgas e cobertura, não
    /// são mexidas na compensação e não voltam no resultado.
    pub alocacoes_travadas: Vec<Alocacao>,
    /// Datas fora do período cujo planejamento está fechado (meses já gerados).
    /// Datas da semana fora do período e fora deste conjunto são "em aberto" e
    /// recebem parte proporcional da carga-alvo.
    pub datas_planejadas: BTreeSet<NaiveDate>,
    /// Regime legal com vigência por data (vazio = só as regras da empresa).
    pub regime: Vec<EtapaRegime>,
    /// Mínimo de pessoas de cada função (chave de `chave_funcao`) em cada turno de
    /// cada dia. Funções fora do mapa não têm mínimo.
    pub minimo_por_funcao: BTreeMap<String, FuncaoMinima>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ResultadoPlanejamento {
    /// Alocações do período, ordenadas por data, turno e funcionário.
    pub alocacoes: Vec<Alocacao>,
    pub avisos: Vec<Aviso>,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ErroPlanejamento {
    #[error("período inválido: {inicio} a {fim}")]
    PeriodoInvalido { inicio: NaiveDate, fim: NaiveDate },
    #[error("o período de {dias} dias excede o máximo de {MAX_DIAS_PERIODO} dias")]
    PeriodoLongo { dias: i64 },
    #[error("regras de carga inválidas: {0}")]
    Regras(#[from] ErroRegras),
    #[error("funcionário {0} informado mais de uma vez")]
    FuncionarioDuplicado(FuncionarioId),
    #[error("turno {0} informado mais de uma vez")]
    TurnoDuplicado(TurnoId),
    #[error("o funcionário \"{funcionario}\" referencia um turno inexistente (id {turno})")]
    TurnoDesconhecido { funcionario: String, turno: TurnoId },
    #[error("a alocação fixa de {data} está dentro do período a gerar")]
    FixaDentroDoPeriodo { data: NaiveDate },
    #[error("a jornada travada de {data} está fora do período a gerar")]
    TravadaForaDoPeriodo { data: NaiveDate },
}

/// Gera a escala do período respeitando as restrições rígidas descritas no módulo.
pub fn gerar_escala(
    entrada: &EntradaPlanejamento,
) -> Result<ResultadoPlanejamento, ErroPlanejamento> {
    validar(entrada)?;
    let semanas = semanas_cobrindo(entrada.inicio, entrada.fim, entrada.regras.inicio_semana)
        .ok_or(ErroPlanejamento::PeriodoInvalido {
            inicio: entrada.inicio,
            fim: entrada.fim,
        })?;

    let mut motor = Motor::novo(entrada);
    for semana in &semanas {
        motor.planejar_semana(semana);
    }
    Ok(motor.concluir())
}

fn validar(entrada: &EntradaPlanejamento) -> Result<(), ErroPlanejamento> {
    let (inicio, fim) = (entrada.inicio, entrada.fim);
    if fim < inicio {
        return Err(ErroPlanejamento::PeriodoInvalido { inicio, fim });
    }
    let dias = (fim - inicio).num_days() + 1;
    if dias > MAX_DIAS_PERIODO {
        return Err(ErroPlanejamento::PeriodoLongo { dias });
    }
    entrada.regras.validar()?;

    let mut turnos = HashSet::new();
    for t in &entrada.turnos {
        if !turnos.insert(t.id) {
            return Err(ErroPlanejamento::TurnoDuplicado(t.id));
        }
    }
    let mut funcionarios = HashSet::new();
    for f in &entrada.funcionarios {
        if !funcionarios.insert(f.id) {
            return Err(ErroPlanejamento::FuncionarioDuplicado(f.id));
        }
        if let Some(o) = f.opcoes.iter().find(|o| !turnos.contains(&o.turno_id)) {
            return Err(ErroPlanejamento::TurnoDesconhecido {
                funcionario: f.nome.clone(),
                turno: o.turno_id,
            });
        }
    }
    if let Some(a) = entrada
        .alocacoes_fixas
        .iter()
        .find(|a| inicio <= a.data && a.data <= fim)
    {
        return Err(ErroPlanejamento::FixaDentroDoPeriodo { data: a.data });
    }
    if let Some(a) = entrada
        .alocacoes_travadas
        .iter()
        .find(|a| a.data < inicio || a.data > fim)
    {
        return Err(ErroPlanejamento::TravadaForaDoPeriodo { data: a.data });
    }
    Ok(())
}

/// Funcionário apto a ser escalado, com as opções que cabem na jornada diária.
struct Apto<'a> {
    func: &'a FuncionarioPlano,
    opcoes: Vec<OpcaoTurno>,
    /// Duração de referência de uma jornada, para converter minutos em turnos.
    duracao_ref: u32,
    duracao_min: u32,
    posicao: usize,
    /// Dias da semana em que ao menos um dos turnos do funcionário funciona.
    dias_turnos: DiasSemana,
    /// Faixa do dia no período para quem pode fazer mais de um turno (ver `atribuir_faixas`).
    faixa: Option<usize>,
    /// Posição no rodízio de domingos, contada dentro da faixa (ver `folga_dominical`).
    rodizio_domingo: usize,
}

impl Apto<'_> {
    fn id(&self) -> FuncionarioId {
        self.func.id
    }

    /// O funcionário está disponível no dia e ao menos um turno dele funciona nele.
    fn pode_trabalhar_em(&self, data: NaiveDate) -> bool {
        self.func.disponivel_em(data) && self.dias_turnos.contem(data.weekday())
    }

    fn turnos_para(&self, minutos: u32) -> u32 {
        minutos.div_ceil(self.duracao_ref.max(1))
    }
}

/// Candidato a trabalhar em um dia, com sua urgência.
struct Candidato {
    indice: usize,
    /// Minutos que faltam para a carga-alvo da semana.
    falta_min: u32,
    duracao_ref: u32,
    /// Dias restantes da semana (no período) em que ainda pode trabalhar.
    dias_possiveis: u32,
    /// Precisa trabalhar todos os dias restantes para chegar ao alvo.
    obrigatorio: bool,
}

impl Candidato {
    /// Turnos (fracionários) que faltam para o alvo.
    fn turnos_faltando(&self) -> f64 {
        f64::from(self.falta_min) / f64::from(self.duracao_ref.max(1))
    }
}

struct Motor<'a> {
    entrada: &'a EntradaPlanejamento,
    turnos: Vec<&'a Turno>,
    aptos: Vec<Apto<'a>>,
    agenda: Agenda,
    novas: Vec<Alocacao>,
    avisos: Vec<Aviso>,
    minutos_no_periodo: HashMap<FuncionarioId, u32>,
    turnos_sem_equipe: HashSet<TurnoId>,
    dias_turno: HashMap<TurnoId, DiasSemana>,
    /// Maior número de turnos num mesmo dia da semana (= número de faixas).
    faixas: usize,
    /// Saldo de horas de cada funcionário até a última semana fechada (minutos).
    saldos: HashMap<FuncionarioId, i64>,
    /// Horário de funcionamento por dia da semana (0 = segunda), em minutos desde
    /// a meia-noite: do primeiro início ao último fim dos turnos do dia.
    janelas: [Option<(u32, u32)>; 7],
    /// Dias da semana em curso em que uma função ficou abaixo do mínimo num turno.
    funcoes_descobertas: BTreeMap<(String, TurnoId), Vec<NaiveDate>>,
}

impl<'a> Motor<'a> {
    fn novo(entrada: &'a EntradaPlanejamento) -> Self {
        let regras = &entrada.regras;
        let mut turnos: Vec<&Turno> = entrada.turnos.iter().collect();
        turnos.sort_by_key(|t| (t.ordem, t.id));
        let nome_turno: HashMap<TurnoId, &str> = entrada
            .turnos
            .iter()
            .map(|t| (t.id, t.nome.as_str()))
            .collect();
        let dias_turno: HashMap<TurnoId, DiasSemana> =
            entrada.turnos.iter().map(|t| (t.id, t.dias)).collect();

        let mut avisos = Vec::new();
        let mut funcionarios: Vec<&FuncionarioPlano> = entrada.funcionarios.iter().collect();
        funcionarios.sort_by_key(|f| f.id);

        let mut aptos = Vec::new();
        for func in funcionarios {
            if func.opcoes.is_empty() {
                avisos.push(Aviso {
                    tipo: TipoAviso::FuncionarioSemTurno,
                    data: None,
                    turno_id: None,
                    funcionario_id: Some(func.id),
                    mensagem: format!("{} não tem turno definido e não foi escalado.", func.nome),
                });
                continue;
            }
            let mut opcoes = Vec::new();
            for o in &func.opcoes {
                if o.horario.minutos_trabalhados() > regras.jornada_diaria_max_min {
                    avisos.push(Aviso {
                        tipo: TipoAviso::TurnoExcedeJornada,
                        data: None,
                        turno_id: Some(o.turno_id),
                        funcionario_id: Some(func.id),
                        mensagem: format!(
                            "{}: o horário {} no turno {} soma {} e excede a jornada diária máxima de {}; turno ignorado.",
                            func.nome,
                            o.horario,
                            nome_turno.get(&o.turno_id).copied().unwrap_or("?"),
                            formatar_minutos(o.horario.minutos_trabalhados()),
                            formatar_minutos(regras.jornada_diaria_max_min),
                        ),
                    });
                } else {
                    opcoes.push(*o);
                }
            }
            if opcoes.is_empty() {
                continue;
            }
            // Jornada de referência: a do turno que funciona mais dias na semana (a
            // jornada normal), não a média: um turno curto de domingo não pode baixar
            // o alvo de horas da semana inteira.
            let duracao_ref = opcoes
                .iter()
                .max_by_key(|o| {
                    let dias = dias_turno.get(&o.turno_id).map_or(0, |d| d.indices().len());
                    (dias, o.horario.minutos_trabalhados())
                })
                .map_or(1, |o| o.horario.minutos_trabalhados())
                .max(1);
            let dias_turnos = opcoes.iter().fold(DiasSemana::NENHUM, |acc, o| {
                acc.uniao(
                    dias_turno
                        .get(&o.turno_id)
                        .copied()
                        .unwrap_or(DiasSemana::NENHUM),
                )
            });
            let duracao_min = opcoes
                .iter()
                .map(|o| o.horario.minutos_trabalhados())
                .min()
                .unwrap_or(1)
                .max(1);
            aptos.push(Apto {
                func,
                duracao_ref,
                duracao_min,
                posicao: aptos.len(),
                dias_turnos,
                opcoes,
                faixa: None,
                rodizio_domingo: 0,
            });
        }

        // Turnos com efetivo mínimo mas sem ninguém habilitado: um aviso só, em vez de um por dia.
        let mut turnos_sem_equipe = HashSet::new();
        for t in &turnos {
            let tem_equipe = aptos
                .iter()
                .any(|a| a.opcoes.iter().any(|o| o.turno_id == t.id));
            if t.efetivo_minimo > 0 && !tem_equipe {
                turnos_sem_equipe.insert(t.id);
                avisos.push(Aviso {
                    tipo: TipoAviso::CoberturaInsuficiente,
                    data: None,
                    turno_id: Some(t.id),
                    funcionario_id: None,
                    mensagem: format!(
                        "O turno {} não tem funcionários habilitados; o efetivo mínimo de {} pessoa(s) não será atendido.",
                        t.nome, t.efetivo_minimo
                    ),
                });
            }
        }

        let mut agenda = Agenda::default();
        for a in entrada
            .alocacoes_fixas
            .iter()
            .chain(&entrada.alocacoes_travadas)
        {
            agenda.inserir(*a);
        }

        let faixas = SEMANA
            .iter()
            .map(|d| turnos.iter().filter(|t| t.dias.contem(*d)).count())
            .max()
            .unwrap_or(0);
        let saldos = aptos
            .iter()
            .map(|a| (a.id(), a.func.saldo_anterior_min))
            .collect();
        let mut janelas = [None; 7];
        for (i, dia) in SEMANA.iter().enumerate() {
            janelas[i] = turnos
                .iter()
                .filter(|t| t.dias.contem(*dia))
                .map(|t| {
                    let inicio = t.horario.inicio().minutos();
                    (inicio, inicio + t.horario.duracao_total_min())
                })
                .reduce(|(a, b), (c, d)| (a.min(c), b.max(d)));
        }
        let mut motor = Motor {
            entrada,
            turnos,
            aptos,
            agenda,
            novas: Vec::new(),
            avisos,
            minutos_no_periodo: HashMap::new(),
            turnos_sem_equipe,
            dias_turno,
            faixas,
            saldos,
            janelas,
            funcoes_descobertas: BTreeMap::new(),
        };
        motor.atribuir_faixas();
        motor.distribuir_rodizio_domingo();
        motor
    }

    /// Quem pode fazer mais de um turno recebe uma faixa do dia (0 = a que abre)
    /// para o período inteiro, para não trocar de horário a cada dia. As faixas
    /// ficam com o mesmo número de pessoas (diferença máxima de 1). Primeiro fica
    /// quem mantém a faixa do mês anterior (se combina com a preferência), depois
    /// quem tem preferência de período, e os demais vão para as faixas com vaga,
    /// o mais perto possível do período preferido.
    fn atribuir_faixas(&mut self) {
        let k = self.faixas;
        let flexiveis: Vec<usize> = (0..self.aptos.len())
            .filter(|i| self.aptos[*i].opcoes.len() > 1)
            .collect();
        if k < 2 || flexiveis.is_empty() {
            return;
        }
        // Período de cada faixa, pelos turnos do dia da semana com mais turnos.
        let dia_cheio = SEMANA.iter().copied().max_by_key(|d| {
            (
                self.turnos.iter().filter(|t| t.dias.contem(*d)).count(),
                Reverse(d.num_days_from_monday()),
            )
        });
        let mut do_dia: Vec<&Turno> = self
            .turnos
            .iter()
            .copied()
            .filter(|t| dia_cheio.is_some_and(|d| t.dias.contem(d)))
            .collect();
        do_dia.sort_by_key(|t| (t.horario.inicio(), t.ordem, t.id));
        let periodos: Vec<Periodo> = do_dia
            .iter()
            .map(|t| Periodo::de_inicio(t.horario.inicio()))
            .collect();
        let distancia =
            |preferencia: Option<Periodo>, faixa: usize| match (preferencia, periodos.get(faixa)) {
                (Some(p), Some(q)) => p.distancia(*q),
                _ => 0,
            };

        let mut vagas = Vagas::novas(flexiveis.len(), k);
        let mut escolha: Vec<Option<usize>> = vec![None; self.aptos.len()];
        // Funções com mínimo vêm antes da preferência: cada faixa recebe as pessoas
        // da função que a cobertura diária pede (mínimo × 7 dias ÷ 5 dias de trabalho,
        // ou o que a função tiver), escolhendo primeiro quem prefere aquele período. O
        // resto da função segue a preferência como os demais.
        let mut grupos: BTreeMap<String, Vec<usize>> = BTreeMap::new();
        for &i in &flexiveis {
            if let Some(f) = self.funcao_com_minimo(i) {
                grupos.entry(f.to_string()).or_default().push(i);
            }
        }
        for (funcao, mut livres) in grupos {
            let minimo = self
                .entrada
                .minimo_por_funcao
                .get(&funcao)
                .map_or(0, |m| m.minimo as usize);
            let por_faixa = (livres.len() / k).min((minimo * 7).div_ceil(5));
            for _ in 0..por_faixa {
                for c in 0..k {
                    if !vagas.cabe(c) {
                        continue;
                    }
                    // Quanto a pessoa perde indo para esta faixa em vez da melhor para ela.
                    let perda = |i: usize| {
                        let preferencia = self.aptos[i].func.preferencia;
                        let melhor = (0..k).map(|x| distancia(preferencia, x)).min().unwrap_or(0);
                        distancia(preferencia, c) - melhor
                    };
                    let melhor = livres.iter().copied().min_by_key(|i| {
                        (
                            perda(*i),
                            self.aptos[*i].func.preferencia.is_none(),
                            self.faixa_anterior(*i) != Some(c),
                            *i,
                        )
                    });
                    if let Some(i) = melhor {
                        vagas.ocupar(c);
                        escolha[i] = Some(c);
                        livres.retain(|x| *x != i);
                    }
                }
            }
        }
        for &i in &flexiveis {
            if escolha[i].is_some() {
                continue;
            }
            let preferencia = self.aptos[i].func.preferencia;
            if let Some(c) = self
                .faixa_anterior(i)
                .filter(|c| distancia(preferencia, *c) == 0 && vagas.cabe(*c))
            {
                vagas.ocupar(c);
                escolha[i] = Some(c);
            }
        }
        for &i in &flexiveis {
            let Some(p) = self.aptos[i].func.preferencia else {
                continue;
            };
            if escolha[i].is_some() {
                continue;
            }
            if let Some(c) = (0..k)
                .filter(|c| periodos.get(*c) == Some(&p) && vagas.cabe(*c))
                .min_by_key(|c| (vagas.carga(*c), *c))
            {
                vagas.ocupar(c);
                escolha[i] = Some(c);
            }
        }
        // Quem tem preferência e ficou sem vaga escolhe antes de quem não tem.
        let mut restantes: Vec<usize> = flexiveis
            .iter()
            .copied()
            .filter(|i| escolha[*i].is_none())
            .collect();
        restantes.sort_by_key(|i| (self.aptos[*i].func.preferencia.is_none(), *i));
        for i in restantes {
            let preferencia = self.aptos[i].func.preferencia;
            if let Some(c) = (0..k)
                .filter(|c| vagas.cabe(*c))
                .min_by_key(|c| (distancia(preferencia, *c), vagas.carga(*c), *c))
            {
                vagas.ocupar(c);
                escolha[i] = Some(c);
            }
        }
        for (apto, faixa) in self.aptos.iter_mut().zip(escolha) {
            apto.faixa = faixa;
        }
    }

    /// Função do funcionário, se ela tem mínimo por turno.
    fn funcao_com_minimo(&self, indice: usize) -> Option<&str> {
        self.aptos[indice].func.funcao.as_deref().filter(|f| {
            self.entrada
                .minimo_por_funcao
                .get(*f)
                .is_some_and(|m| m.minimo > 0)
        })
    }

    /// Pessoas da função escaladas no turno no dia.
    fn da_funcao_no_turno(&self, funcao: &str, turno: TurnoId, dia: NaiveDate) -> u32 {
        let n = self
            .aptos
            .iter()
            .filter(|a| a.func.funcao.as_deref() == Some(funcao))
            .filter(|a| {
                self.agenda
                    .em(a.id(), dia)
                    .is_some_and(|x| x.turno_id == turno)
            })
            .count();
        u32::try_from(n).unwrap_or(u32::MAX)
    }

    /// Numera as pessoas de cada faixa e função (e as de turno único, por turno) para
    /// o rodízio de domingos: assim cada turno perde só uma parte de cada função a
    /// cada domingo.
    fn distribuir_rodizio_domingo(&mut self) {
        // (faixa, turno único, função) → pessoas já numeradas.
        type Grupo = (Option<usize>, Option<TurnoId>, Option<String>);
        let mut contagem: HashMap<Grupo, usize> = HashMap::new();
        for apto in &mut self.aptos {
            let unico = (apto.opcoes.len() == 1)
                .then(|| apto.opcoes.first().map(|o| o.turno_id))
                .flatten();
            let n = contagem
                .entry((apto.faixa, unico, apto.func.funcao.clone()))
                .or_default();
            apto.rodizio_domingo = *n;
            *n += 1;
        }
    }

    /// Pode ser escalado no dia pela distribuição normal: disponível e fora da folga
    /// dominical programada (o efetivo mínimo ainda pode chamá-lo, se as regras deixarem).
    fn livre_em(&self, indice: usize, dia: NaiveDate) -> bool {
        self.aptos[indice].pode_trabalhar_em(dia) && !self.folga_dominical(indice, dia)
    }

    /// Domingo de folga programado. Com no máximo `k` domingos seguidos, cada pessoa
    /// folga um domingo a cada `k + 1`, em rodízio escalonado: sem isso, a equipe
    /// inteira chegaria ao limite no mesmo domingo e ele ficaria sem ninguém.
    fn folga_dominical(&self, indice: usize, dia: NaiveDate) -> bool {
        let k = self.entrada.regras.domingos_seguidos_max;
        if k == 0 || dia.weekday() != Weekday::Sun {
            return false;
        }
        let ciclo = i64::from(k) + 1;
        let semana = i64::from(dia.num_days_from_ce()) / 7;
        let posicao = i64::try_from(self.aptos[indice].rodizio_domingo).unwrap_or(0);
        (semana + posicao) % ciclo == 0
    }

    /// Faixa do último turno antes do período (até 7 dias antes), se houver.
    fn faixa_anterior(&self, indice: usize) -> Option<usize> {
        let apto = &self.aptos[indice];
        let anterior = self
            .agenda
            .anterior(apto.id(), self.entrada.inicio)
            .filter(|a| (self.entrada.inicio - a.data).num_days() <= 7)?;
        let do_dia = self.opcoes_ordenadas(indice, anterior.data);
        let posicao = do_dia
            .iter()
            .position(|o| o.turno_id == anterior.turno_id)?;
        // Menor faixa que cai nessa posição (ver `opcoes_do_dia`).
        Some((posicao * self.faixas).div_ceil(do_dia.len())).filter(|c| *c < self.faixas)
    }

    /// Opções do funcionário que funcionam no dia, da que começa mais cedo à mais tarde.
    fn opcoes_ordenadas(&self, indice: usize, dia: NaiveDate) -> Vec<OpcaoTurno> {
        let mut opcoes: Vec<OpcaoTurno> = self.aptos[indice]
            .opcoes
            .iter()
            .filter(|o| self.turno_funciona(o.turno_id, dia))
            .copied()
            .collect();
        opcoes.sort_by_key(|o| (o.horario.inicio(), self.ordem_turno(o.turno_id)));
        opcoes
    }

    /// Opções do funcionário que funcionam no dia: o turno da sua faixa (na mesma
    /// posição proporcional entre os turnos do dia); sem faixa, ou com `todas`,
    /// qualquer opção que funcione.
    fn opcoes_do_dia(&self, indice: usize, dia: NaiveDate, todas: bool) -> Vec<OpcaoTurno> {
        let apto = &self.aptos[indice];
        if let Some(faixa) = apto.faixa.filter(|_| !todas) {
            let do_dia = self.opcoes_ordenadas(indice, dia);
            if let Some(o) = do_dia.get(faixa * do_dia.len() / self.faixas.max(1)) {
                return vec![*o];
            }
        }
        apto.opcoes
            .iter()
            .filter(|o| self.turno_funciona(o.turno_id, dia))
            .copied()
            .collect()
    }

    /// O turno funciona no dia da semana de `dia` (turno desconhecido nunca funciona).
    fn turno_funciona(&self, turno: TurnoId, dia: NaiveDate) -> bool {
        self.dias_turno
            .get(&turno)
            .is_some_and(|d| d.contem(dia.weekday()))
    }

    fn limites(&self, semana: &Semana) -> LimitesSemana {
        limites_da_semana(&self.entrada.regras, &self.entrada.regime, semana)
    }

    fn no_periodo(&self, data: NaiveDate) -> bool {
        self.entrada.inicio <= data && data <= self.entrada.fim
    }

    fn planejar_semana(&mut self, semana: &Semana) {
        let dias: Vec<NaiveDate> = semana.dias().filter(|d| self.no_periodo(*d)).collect();
        if dias.is_empty() {
            return;
        }

        // Carga-alvo de cada funcionário nesta semana (dentro do período).
        let limites = self.limites(semana);
        let mut alvos = Vec::with_capacity(self.aptos.len());
        // Horas previstas da semana inteira e se ela fecha nesta geração.
        let mut fechamento = Vec::with_capacity(self.aptos.len());
        for (indice, apto) in self.aptos.iter().enumerate() {
            let id = apto.id();
            let dur = apto.duracao_ref;
            let fixos = self.agenda.minutos_na_semana(id, semana);
            let teto = limite_do_funcionario(apto.func, &limites).saturating_sub(fixos);
            // Alvo em jornadas inteiras: com turnos de 7h20 e teto de 40h, o alvo é 36h40.
            // E nunca mais jornadas do que os dias que as folgas mínimas deixam livres.
            let dias_livres = limites
                .dias_trabalho_max()
                .saturating_sub(self.agenda.dias_na_semana(id, semana));
            let teto_inteiro = (teto / dur).min(dias_livres) * dur;
            // O previsto da semana (com as ausências justificadas abonadas) menos o que
            // já está feito nos meses vizinhos, em jornadas inteiras.
            let previsto =
                previsto_da_semana(apto.func, &self.entrada.turnos, &limites, semana, dur);
            let mut base =
                ((previsto.saturating_sub(fixos) + dur / 2) / dur * dur).min(teto_inteiro);
            let disponiveis = dias.iter().filter(|d| self.livre_em(indice, **d)).count();
            let em_aberto = semana
                .dias()
                .filter(|d| {
                    !self.no_periodo(*d)
                        && !self.entrada.datas_planejadas.contains(d)
                        && self.agenda.em(id, *d).is_none()
                        && self.livre_em(indice, *d)
                })
                .count();
            let fechada = em_aberto == 0;
            if fechada {
                // Saldo de semanas anteriores: até uma jornada por semana, uma folga a
                // mais para quem tem horas sobrando ou um dia a mais para quem deve.
                let saldo = self.saldos.get(&id).copied().unwrap_or(0);
                let meia = i64::from(dur / 2).max(1);
                if saldo >= meia && base >= dur {
                    base -= dur;
                } else if saldo <= -meia && base + dur <= teto_inteiro {
                    base += dur;
                }
            }
            let alvo = if disponiveis == 0 {
                0
            } else if fechada {
                base
            } else {
                proporcional(base, disponiveis, disponiveis + em_aberto)
            };
            alvos.push((alvo, disponiveis));
            fechamento.push((previsto, fechada));
        }

        self.prealocar_funcoes(semana, &dias, &alvos);
        for (i, dia) in dias.iter().enumerate() {
            self.planejar_dia(*dia, semana, &dias[i..], &alvos);
        }

        // Semana fechada: o que ainda sobra ou falta do saldo vira ajuste de horário
        // nas jornadas desta semana, e o saldo segue para a próxima.
        for (indice, (previsto, fechada)) in fechamento.into_iter().enumerate() {
            if !fechada {
                continue;
            }
            let id = self.aptos[indice].id();
            let saldo = self.saldos.get(&id).copied().unwrap_or(0);
            let feito = i64::from(self.agenda.minutos_na_semana(id, semana));
            let projetado = saldo + feito - i64::from(previsto);
            let minutos = u32::try_from(projetado.unsigned_abs()).unwrap_or(u32::MAX);
            if projetado < 0 {
                self.estender(indice, semana, &limites, minutos);
            } else if projetado > 0 {
                self.encurtar(indice, semana, minutos);
            }
            let feito = i64::from(self.agenda.minutos_na_semana(id, semana));
            self.saldos.insert(id, saldo + feito - i64::from(previsto));
        }

        self.avisar_funcoes_descobertas();

        // Quem ficou pelo menos uma jornada abaixo do alvo, tendo dias para cumpri-lo.
        for (apto, (alvo, disponiveis)) in self.aptos.iter().zip(&alvos) {
            let feito = self.minutos_novos_na_semana(apto.id(), semana);
            let falta = alvo.saturating_sub(feito);
            let dias_suficientes =
                u32::try_from(*disponiveis).unwrap_or(u32::MAX) >= apto.turnos_para(*alvo);
            if falta >= apto.duracao_min && dias_suficientes {
                self.avisos.push(Aviso {
                    tipo: TipoAviso::CargaAbaixoDoAlvo,
                    data: Some(semana.inicio),
                    turno_id: None,
                    funcionario_id: Some(apto.id()),
                    mensagem: format!(
                        "{} ficou com {} de {} previstas na semana de {} a {} (folgas, descanso ou cobertura impediram completar).",
                        apto.func.nome,
                        formatar_minutos(feito),
                        formatar_minutos(*alvo),
                        semana.inicio.format("%d/%m"),
                        semana.fim.format("%d/%m"),
                    ),
                });
            }
        }
    }

    /// Estica jornadas novas da semana até cobrir `falta` minutos (passos de 15 min):
    /// sem passar da jornada diária máxima nem do limite semanal, dentro do horário
    /// de funcionamento do dia e respeitando o descanso entre jornadas.
    fn estender(
        &mut self,
        indice: usize,
        semana: &Semana,
        limites: &LimitesSemana,
        mut falta: u32,
    ) {
        let id = self.aptos[indice].id();
        let limite = limite_do_funcionario(self.aptos[indice].func, limites);
        let jornada_max = self.entrada.regras.jornada_diaria_max_min;
        for dia in self.dias_novos(id, semana) {
            let Some(atual) = self.agenda.em(id, dia).copied() else {
                continue;
            };
            let livre_semana = limite.saturating_sub(self.agenda.minutos_na_semana(id, semana));
            let livre_dia = jornada_max.saturating_sub(atual.minutos_trabalhados());
            let mut x =
                falta.min(livre_semana).min(livre_dia) / PASSO_AJUSTE_MIN * PASSO_AJUSTE_MIN;
            while x >= PASSO_AJUSTE_MIN {
                if let Some(nova) = self.esticada(&atual, x).filter(|n| self.cabe(n)) {
                    self.substituir(nova);
                    falta -= x;
                    break;
                }
                x -= PASSO_AJUSTE_MIN;
            }
            if falta < PASSO_AJUSTE_MIN {
                break;
            }
        }
    }

    /// Encurta jornadas novas da semana até tirar `sobra` minutos: no máximo 2h por
    /// jornada e nunca abaixo de 4h trabalhadas (ou da metade da jornada).
    fn encurtar(&mut self, indice: usize, semana: &Semana, mut sobra: u32) {
        let id = self.aptos[indice].id();
        for dia in self.dias_novos(id, semana) {
            let Some(atual) = self.agenda.em(id, dia).copied() else {
                continue;
            };
            let trabalhado = atual.minutos_trabalhados();
            let piso = JORNADA_MIN_ENCURTADA.max(trabalhado / 2);
            let x = sobra
                .min(MAX_ENCURTAR_MIN)
                .min(trabalhado.saturating_sub(piso))
                / PASSO_AJUSTE_MIN
                * PASSO_AJUSTE_MIN;
            if x == 0 {
                continue;
            }
            if let Some(nova) = self.encurtada(&atual, x) {
                self.substituir(nova);
                sobra -= x;
            }
            if sobra < PASSO_AJUSTE_MIN {
                break;
            }
        }
    }

    /// Datas das jornadas novas do funcionário na semana.
    fn dias_novos(&self, id: FuncionarioId, semana: &Semana) -> Vec<NaiveDate> {
        self.novas
            .iter()
            .filter(|a| a.funcionario_id == id && semana.contem(a.data))
            .map(|a| a.data)
            .collect()
    }

    /// Horário de funcionamento do dia, incluindo a própria jornada.
    fn janela(&self, a: &Alocacao) -> (u32, u32) {
        let inicio = a.horario.inicio().minutos();
        let fim = inicio + a.horario.duracao_total_min();
        let indice = a.data.weekday().num_days_from_monday() as usize;
        self.janelas
            .get(indice)
            .copied()
            .flatten()
            .map_or((inicio, fim), |(i, f)| (i.min(inicio), f.max(fim)))
    }

    /// A jornada com `minutos` a mais: quem abre fica até mais tarde, quem fecha
    /// chega mais cedo e quem está no meio tenta os dois. O intervalo cresce se a
    /// nova jornada exigir (CLT: acima de 6h, 1h).
    fn esticada(&self, a: &Alocacao, minutos: u32) -> Option<Alocacao> {
        let (abre, fecha) = self.janela(a);
        let inicio = a.horario.inicio().minutos();
        let fim = inicio + a.horario.duracao_total_min();
        let trabalhado = a.horario.minutos_trabalhados() + minutos;
        let intervalo = a.horario.intervalo_min().max(intervalo_padrao(trabalhado));
        let duracao = trabalhado + intervalo;
        let depois = (inicio, inicio + duracao);
        let antes = fim.checked_sub(duracao).map(|i| (i, fim));
        let opcoes = if inicio <= abre {
            vec![Some(depois)]
        } else if fim >= fecha {
            vec![antes]
        } else {
            vec![Some(depois), antes]
        };
        opcoes
            .into_iter()
            .flatten()
            .find(|(i, f)| *i >= abre && *f <= fecha)
            .and_then(|(i, f)| self.com_horario(a, i, f, intervalo))
    }

    /// A jornada com `minutos` a menos: quem fecha chega mais tarde; os demais saem
    /// mais cedo. O intervalo diminui se a jornada menor permitir.
    fn encurtada(&self, a: &Alocacao, minutos: u32) -> Option<Alocacao> {
        let (_, fecha) = self.janela(a);
        let inicio = a.horario.inicio().minutos();
        let fim = inicio + a.horario.duracao_total_min();
        let trabalhado = a.horario.minutos_trabalhados().checked_sub(minutos)?;
        let intervalo = a.horario.intervalo_min().min(intervalo_padrao(trabalhado));
        let duracao = trabalhado + intervalo;
        let (i, f) = if fim >= fecha && inicio > 0 {
            (fim.checked_sub(duracao)?, fim)
        } else {
            (inicio, inicio + duracao)
        };
        self.com_horario(a, i, f, intervalo)
    }

    fn com_horario(&self, a: &Alocacao, inicio: u32, fim: u32, intervalo: u32) -> Option<Alocacao> {
        if inicio >= MINUTOS_NO_DIA {
            return None;
        }
        let horario = Horario::novo(
            HoraDoDia::de_minutos(inicio)?,
            HoraDoDia::de_minutos(fim % MINUTOS_NO_DIA)?,
            intervalo,
        )
        .ok()?;
        Some(Alocacao { horario, ..*a })
    }

    /// A jornada ajustada respeita a jornada diária e o descanso entre jornadas.
    fn cabe(&self, nova: &Alocacao) -> bool {
        let regras = &self.entrada.regras;
        let descanso = i64::from(regras.descanso_entre_jornadas_min);
        let id = nova.funcionario_id;
        nova.minutos_trabalhados() <= regras.jornada_diaria_max_min
            && self
                .agenda
                .anterior(id, nova.data)
                .is_none_or(|p| nova.inicio_absoluto() - p.fim_absoluto() >= descanso)
            && self
                .agenda
                .seguinte(id, nova.data)
                .is_none_or(|s| s.inicio_absoluto() - nova.fim_absoluto() >= descanso)
    }

    /// Troca a jornada nova do mesmo funcionário e dia por `nova`.
    fn substituir(&mut self, nova: Alocacao) {
        if let Some(a) = self
            .novas
            .iter_mut()
            .find(|a| a.funcionario_id == nova.funcionario_id && a.data == nova.data)
        {
            let total = self
                .minutos_no_periodo
                .entry(nova.funcionario_id)
                .or_default();
            *total = (*total + nova.minutos_trabalhados()).saturating_sub(a.minutos_trabalhados());
            *a = nova;
            self.agenda.inserir(nova);
        }
    }

    fn minutos_novos_na_semana(&self, id: FuncionarioId, semana: &Semana) -> u32 {
        self.novas
            .iter()
            .filter(|a| a.funcionario_id == id && semana.contem(a.data))
            .map(Alocacao::minutos_trabalhados)
            .sum()
    }

    fn planejar_dia(
        &mut self,
        dia: NaiveDate,
        semana: &Semana,
        restantes: &[NaiveDate],
        alvos: &[(u32, usize)],
    ) {
        let deslocamento = usize::try_from((dia - self.entrada.inicio).num_days()).unwrap_or(0);
        let total_aptos = self.aptos.len().max(1);

        // 1. Candidatos com carga a cumprir e sua urgência.
        let mut candidatos = Vec::new();
        for (indice, apto) in self.aptos.iter().enumerate() {
            let id = apto.id();
            if !self.livre_em(indice, dia) || self.agenda.em(id, dia).is_some() {
                continue;
            }
            let alvo = alvos.get(indice).map_or(0, |(a, _)| *a);
            let falta = alvo.saturating_sub(self.minutos_novos_na_semana(id, semana));
            if falta == 0 {
                continue;
            }
            let dias_possiveis = restantes
                .iter()
                .filter(|d| self.livre_em(indice, **d) && self.agenda.em(id, **d).is_none())
                .count();
            let dias_possiveis = u32::try_from(dias_possiveis).unwrap_or(u32::MAX).max(1);
            candidatos.push(Candidato {
                indice,
                falta_min: falta,
                duracao_ref: apto.duracao_ref,
                dias_possiveis,
                obrigatorio: u64::from(falta)
                    >= u64::from(dias_possiveis) * u64::from(apto.duracao_ref),
            });
        }

        // 2. Cota de cada turno que funciona no dia: demanda restante distribuída pelos
        //    dias restantes em que o turno funciona. A demanda de cada candidato é
        //    repartida só entre os turnos dele que funcionam hoje.
        let mut demanda: HashMap<TurnoId, f64> = HashMap::new();
        for c in &candidatos {
            let ativas = self.opcoes_do_dia(c.indice, dia, false);
            let fatia = c.turnos_faltando() / ativas.len().max(1) as f64;
            for o in &ativas {
                *demanda.entry(o.turno_id).or_default() += fatia;
            }
        }
        let cotas: HashMap<TurnoId, u32> = self
            .turnos
            .iter()
            .filter(|t| t.funciona_em(dia))
            .map(|t| {
                let dias_do_turno = restantes.iter().filter(|d| t.funciona_em(**d)).count();
                let dias_do_turno = u32::try_from(dias_do_turno).unwrap_or(u32::MAX).max(1);
                let media = demanda.get(&t.id).copied().unwrap_or(0.0) / f64::from(dias_do_turno);
                // Arredonda a média com um deslocamento que varia por turno e por dia
                // (sequência de baixa discrepância): a parte fracionária vira, ao longo
                // da semana, a quantidade certa de vagas, sem que toda equipe pequena
                // folgue sempre no último dia da semana. Médias inteiras não mudam.
                let posicao = self.ordem_turno(t.id) as f64 + 1.0;
                let deslocamento = (posicao * 0.618_033_988_7
                    + dia.num_days_from_ce() as f64 * 0.754_877_666_2)
                    .fract();
                let cota = (media + deslocamento - 1e-9).floor().max(0.0) as u32;
                // Quem já está reservado no dia (cobertura de função) soma à cota.
                let reservados = self
                    .novas
                    .iter()
                    .chain(&self.entrada.alocacoes_travadas)
                    .filter(|a| a.data == dia && a.turno_id == t.id)
                    .count();
                let cota = cota + u32::try_from(reservados).unwrap_or(0);
                (t.id, cota.max(t.efetivo_minimo))
            })
            .collect();

        // 3. Ordem de prioridade: obrigatórios, maior pressão, (aos domingos) menos
        //    domingos trabalhados, menos horas no período, rodízio.
        let domingo = dia.weekday() == Weekday::Sun;
        candidatos.sort_by(|a, b| {
            b.obrigatorio
                .cmp(&a.obrigatorio)
                .then_with(|| comparar_pressao(b, a))
                .then_with(|| {
                    if !domingo {
                        return Ordering::Equal;
                    }
                    let domingos = |c: &Candidato| {
                        self.agenda.mesmos_dias_trabalhados(
                            self.aptos[c.indice].id(),
                            dia,
                            SEMANAS_HISTORICO_DOMINGO,
                        )
                    };
                    domingos(a).cmp(&domingos(b))
                })
                .then_with(|| {
                    self.minutos_periodo(a.indice)
                        .cmp(&self.minutos_periodo(b.indice))
                })
                .then_with(|| {
                    let rodizio =
                        |c: &Candidato| (self.aptos[c.indice].posicao + deslocamento) % total_aptos;
                    rodizio(a).cmp(&rodizio(b))
                })
                .then_with(|| self.aptos[a.indice].id().cmp(&self.aptos[b.indice].id()))
        });

        // Quem já está no dia (cobertura de função reservada no início da semana) conta
        // para a cota do turno.
        let mut contagem: HashMap<TurnoId, u32> = HashMap::new();
        for a in self
            .novas
            .iter()
            .chain(&self.entrada.alocacoes_travadas)
            .filter(|a| a.data == dia)
        {
            *contagem.entry(a.turno_id).or_default() += 1;
        }
        // Funções com mínimo: em cada turno do dia, os primeiros da fila de cada função
        // entram antes dos demais (só quem ainda tem horas a cumprir na semana).
        let do_dia: Vec<&Turno> = self
            .turnos
            .iter()
            .copied()
            .filter(|t| t.funciona_em(dia))
            .collect();
        let minimos: Vec<(String, u32)> = self
            .entrada
            .minimo_por_funcao
            .iter()
            .filter(|(_, m)| m.minimo > 0)
            .map(|(f, m)| (f.clone(), m.minimo))
            .collect();
        for turno in &do_dia {
            for (funcao, minimo) in &minimos {
                let mut presentes = self.da_funcao_no_turno(funcao, turno.id, dia);
                for c in &candidatos {
                    if presentes >= *minimo {
                        break;
                    }
                    if self.aptos[c.indice].func.funcao.as_deref() != Some(funcao.as_str()) {
                        continue;
                    }
                    let opcao = self
                        .opcoes_elegiveis(c.indice, dia, semana, false)
                        .into_iter()
                        .find(|o| o.turno_id == turno.id);
                    if let Some(opcao) = opcao {
                        self.alocar(c.indice, dia, opcao);
                        *contagem.entry(turno.id).or_default() += 1;
                        presentes += 1;
                    }
                }
            }
        }
        for c in &candidatos {
            let elegiveis = self.opcoes_elegiveis(c.indice, dia, semana, false);
            // Quem pode fazer mais de um horário fica no mesmo da última jornada (ou no
            // preferido) enquanto ele tiver vaga; senão vai para o horário mais desfalcado.
            let preferido = self.turno_preferido(c.indice, dia);
            let abaixo_da_cota = elegiveis
                .iter()
                .filter(|o| {
                    contagem.get(&o.turno_id).copied().unwrap_or(0)
                        < cotas.get(&o.turno_id).copied().unwrap_or(0)
                })
                .max_by_key(|o| {
                    let deficit = cotas.get(&o.turno_id).copied().unwrap_or(0)
                        - contagem.get(&o.turno_id).copied().unwrap_or(0);
                    (
                        Some(o.turno_id) == preferido,
                        deficit,
                        Reverse(self.ordem_turno(o.turno_id)),
                    )
                })
                .copied();
            let escolha = abaixo_da_cota.or_else(|| {
                if c.obrigatorio {
                    elegiveis
                        .iter()
                        .min_by_key(|o| {
                            (
                                Some(o.turno_id) != preferido,
                                contagem.get(&o.turno_id).copied().unwrap_or(0),
                                self.ordem_turno(o.turno_id),
                            )
                        })
                        .copied()
                } else {
                    None
                }
            });
            if let Some(opcao) = escolha {
                self.alocar(c.indice, dia, opcao);
                *contagem.entry(opcao.turno_id).or_default() += 1;
            }
        }

        // 4. Efetivo mínimo: completa com quem ainda tem saldo semanal (mesmo já no alvo).
        let turnos: Vec<&Turno> = self.turnos.clone();
        for turno in turnos {
            if !turno.funciona_em(dia) || self.turnos_sem_equipe.contains(&turno.id) {
                continue;
            }
            while contagem.get(&turno.id).copied().unwrap_or(0) < turno.efetivo_minimo {
                let reforco = self
                    .aptos
                    .iter()
                    .enumerate()
                    .filter_map(|(indice, apto)| {
                        self.opcoes_elegiveis(indice, dia, semana, true)
                            .into_iter()
                            .find(|o| o.turno_id == turno.id)
                            .map(|o| (indice, apto, o))
                    })
                    .min_by_key(|(indice, apto, _)| {
                        // Primeiro quem ainda não cumpriu as horas da semana.
                        let alvo = alvos.get(*indice).map_or(0, |a| a.0);
                        let passa = self.minutos_novos_na_semana(apto.id(), semana)
                            + apto.duracao_ref
                            > alvo;
                        (
                            passa,
                            self.turno_preferido(*indice, dia) != Some(turno.id),
                            self.agenda.minutos_na_semana(apto.id(), semana),
                            self.minutos_periodo(*indice),
                            (apto.posicao + deslocamento) % total_aptos,
                            apto.id(),
                        )
                    })
                    .map(|(indice, _, o)| (indice, o));
                match reforco {
                    Some((indice, opcao)) => {
                        self.alocar(indice, dia, opcao);
                        *contagem.entry(turno.id).or_default() += 1;
                    }
                    None => {
                        let escalados = contagem.get(&turno.id).copied().unwrap_or(0);
                        self.avisos.push(Aviso {
                            tipo: TipoAviso::CoberturaInsuficiente,
                            data: Some(dia),
                            turno_id: Some(turno.id),
                            funcionario_id: None,
                            mensagem: format!(
                                "{}: turno {} com {} de {} pessoa(s) mínimas (sem funcionários com saldo de horas ou descanso suficiente).",
                                dia.format("%d/%m/%Y"),
                                turno.nome,
                                escalados,
                                turno.efetivo_minimo
                            ),
                        });
                        break;
                    }
                }
            }
        }

        // 5. Funções ainda abaixo do mínimo: chama alguém da função com saldo semanal,
        //    mesmo de outra faixa. Sem ninguém, o dia entra no aviso da semana.
        for turno in &do_dia {
            for (funcao, minimo) in &minimos {
                let mut presentes = self.da_funcao_no_turno(funcao, turno.id, dia);
                while presentes < *minimo {
                    let reforco = self
                        .aptos
                        .iter()
                        .enumerate()
                        .filter(|(_, a)| a.func.funcao.as_deref() == Some(funcao.as_str()))
                        .filter_map(|(indice, apto)| {
                            self.opcoes_elegiveis(indice, dia, semana, true)
                                .into_iter()
                                .find(|o| o.turno_id == turno.id)
                                .map(|o| (indice, apto, o))
                        })
                        .min_by_key(|(indice, apto, _)| {
                            // Primeiro quem ainda não cumpriu as horas da semana (não
                            // quem está com a semana reduzida por férias, por exemplo).
                            let alvo = alvos.get(*indice).map_or(0, |a| a.0);
                            let passa = self.minutos_novos_na_semana(apto.id(), semana)
                                + apto.duracao_ref
                                > alvo;
                            (
                                passa,
                                self.turno_preferido(*indice, dia) != Some(turno.id),
                                self.agenda.minutos_na_semana(apto.id(), semana),
                                self.minutos_periodo(*indice),
                                apto.id(),
                            )
                        })
                        .map(|(indice, _, o)| (indice, o));
                    match reforco {
                        Some((indice, opcao)) => {
                            self.alocar(indice, dia, opcao);
                            presentes += 1;
                        }
                        None => {
                            self.funcoes_descobertas
                                .entry((funcao.clone(), turno.id))
                                .or_default()
                                .push(dia);
                            break;
                        }
                    }
                }
            }
        }
    }

    /// Antes dos dias da semana, reserva o mínimo de cada função nos turnos e dias
    /// apertados (no máximo uma pessoa da função disponível além do mínimo, como o
    /// domingo da folga dominical), começando pelos mais apertados. As folgas da semana
    /// se ajeitam em volta dessas jornadas: quem foi reservado para o domingo folga num
    /// dia útil. Nos dias folgados, a prioridade diária de `planejar_dia` basta, e
    /// reservar tudo de antemão tiraria flexibilidade (sobrecarregando o fim da semana).
    fn prealocar_funcoes(&mut self, semana: &Semana, dias: &[NaiveDate], alvos: &[(u32, usize)]) {
        let minimos: Vec<(String, u32)> = self
            .entrada
            .minimo_por_funcao
            .iter()
            .filter(|(_, m)| m.minimo > 0)
            .map(|(f, m)| (f.clone(), m.minimo))
            .collect();
        if minimos.is_empty() {
            return;
        }
        let da_funcao = |motor: &Self, i: usize, funcao: &str| {
            motor.aptos[i].func.funcao.as_deref() == Some(funcao)
        };
        // (pessoas disponíveis, dia, turno, função, mínimo)
        let mut pendencias = Vec::new();
        for &dia in dias {
            for turno in self.turnos.iter().filter(|t| t.funciona_em(dia)) {
                for (funcao, minimo) in &minimos {
                    let disponiveis = (0..self.aptos.len())
                        .filter(|i| {
                            da_funcao(self, *i, funcao)
                                && self.livre_em(*i, dia)
                                && self
                                    .opcoes_do_dia(*i, dia, false)
                                    .iter()
                                    .any(|o| o.turno_id == turno.id)
                        })
                        .count();
                    if disponiveis <= *minimo as usize + 1 {
                        pendencias.push((disponiveis, dia, turno.id, funcao.clone(), *minimo));
                    }
                }
            }
        }
        pendencias.sort_by_key(|(n, dia, turno, funcao, _)| {
            (*n, *dia, self.ordem_turno(*turno), funcao.clone())
        });
        for (_, dia, turno, funcao, minimo) in pendencias {
            let mut presentes = self.da_funcao_no_turno(&funcao, turno, dia);
            while presentes < minimo {
                let escolhido = (0..self.aptos.len())
                    .filter(|i| da_funcao(self, *i, &funcao) && self.livre_em(*i, dia))
                    .filter(|i| {
                        let apto = &self.aptos[*i];
                        let alvo = alvos.get(*i).map_or(0, |a| a.0);
                        self.minutos_novos_na_semana(apto.id(), semana) + apto.duracao_ref <= alvo
                    })
                    .filter_map(|i| {
                        self.opcoes_elegiveis(i, dia, semana, false)
                            .into_iter()
                            .find(|o| o.turno_id == turno)
                            .map(|o| (i, o))
                    })
                    .min_by_key(|(i, _)| {
                        let apto = &self.aptos[*i];
                        (
                            self.agenda.dias_na_semana(apto.id(), semana),
                            self.minutos_periodo(*i),
                            apto.id(),
                        )
                    });
                match escolhido {
                    Some((i, opcao)) => {
                        self.alocar(i, dia, opcao);
                        presentes += 1;
                    }
                    None => break,
                }
            }
        }
    }

    /// Avisos da semana: cada função que ficou abaixo do mínimo num turno, com os dias.
    fn avisar_funcoes_descobertas(&mut self) {
        let descobertas = std::mem::take(&mut self.funcoes_descobertas);
        for ((funcao, turno_id), dias) in descobertas {
            let turno = self
                .turnos
                .iter()
                .find(|t| t.id == turno_id)
                .map_or_else(|| "?".to_string(), |t| t.nome.clone());
            let (nome, minimo) = self
                .entrada
                .minimo_por_funcao
                .get(&funcao)
                .map_or((funcao.clone(), 1), |m| (m.nome.clone(), m.minimo));
            let datas: Vec<String> = dias.iter().map(|d| d.format("%d/%m").to_string()).collect();
            self.avisos.push(Aviso {
                tipo: TipoAviso::FuncaoDescoberta,
                data: dias.first().copied(),
                turno_id: Some(turno_id),
                funcionario_id: None,
                mensagem: format!(
                    "{nome}: turno {turno} sem o mínimo de {minimo} pessoa(s) da função em {} (faltam pessoas da função com horas ou descanso livres).",
                    datas.join(", ")
                ),
            });
        }
    }

    /// Horário em que o funcionário trabalhou por último (até 7 dias antes) ou,
    /// sem histórico recente, o primeiro da lista (o preferido, vindo do quadro).
    fn turno_preferido(&self, indice: usize, dia: NaiveDate) -> Option<TurnoId> {
        let apto = &self.aptos[indice];
        let recente = self
            .agenda
            .anterior(apto.id(), dia)
            .filter(|a| (dia - a.data).num_days() <= 7)
            .map(|a| a.turno_id)
            .filter(|t| apto.opcoes.iter().any(|o| o.turno_id == *t));
        recente.or_else(|| apto.opcoes.first().map(|o| o.turno_id))
    }

    fn minutos_periodo(&self, indice: usize) -> u32 {
        self.minutos_no_periodo
            .get(&self.aptos[indice].id())
            .copied()
            .unwrap_or(0)
    }

    fn ordem_turno(&self, turno: TurnoId) -> usize {
        self.turnos
            .iter()
            .position(|t| t.id == turno)
            .unwrap_or(usize::MAX)
    }

    /// Opções do funcionário que respeitam todas as restrições rígidas no dia.
    /// `todas`: considera todos os horários da pessoa, não só o do período (usado
    /// para completar o efetivo mínimo de um horário desfalcado).
    fn opcoes_elegiveis(
        &self,
        indice: usize,
        dia: NaiveDate,
        semana: &Semana,
        todas: bool,
    ) -> Vec<OpcaoTurno> {
        let apto = &self.aptos[indice];
        let id = apto.id();
        let regras = &self.entrada.regras;
        if !self.no_periodo(dia)
            || !apto.pode_trabalhar_em(dia)
            || self.agenda.em(id, dia).is_some()
        {
            return Vec::new();
        }
        let seguidos = self.agenda.dias_seguidos_antes(id, dia)
            + 1
            + self.agenda.dias_seguidos_depois(id, dia);
        if seguidos > regras.max_dias_consecutivos {
            return Vec::new();
        }
        let limites = self.limites(semana);
        if self.agenda.dias_na_semana(id, semana) + 1 > limites.dias_trabalho_max() {
            return Vec::new();
        }
        if regras.domingos_seguidos_max > 0 && dia.weekday() == Weekday::Sun {
            let (antes, depois) = self.agenda.mesmos_dias_seguidos(id, dia);
            if antes + 1 + depois > regras.domingos_seguidos_max {
                return Vec::new();
            }
        }
        let limite_semanal = limite_do_funcionario(apto.func, &limites);
        let usado = self.agenda.minutos_na_semana(id, semana);
        let descanso = i64::from(regras.descanso_entre_jornadas_min);
        let anterior = self.agenda.anterior(id, dia);
        let seguinte = self.agenda.seguinte(id, dia);

        self.opcoes_do_dia(indice, dia, todas)
            .into_iter()
            .filter(|o| {
                let candidata = Alocacao {
                    funcionario_id: id,
                    turno_id: o.turno_id,
                    data: dia,
                    horario: o.horario,
                };
                usado + candidata.minutos_trabalhados() <= limite_semanal
                    && candidata.minutos_trabalhados() <= regras.jornada_diaria_max_min
                    && anterior
                        .is_none_or(|a| candidata.inicio_absoluto() - a.fim_absoluto() >= descanso)
                    && seguinte
                        .is_none_or(|s| s.inicio_absoluto() - candidata.fim_absoluto() >= descanso)
            })
            .collect()
    }

    fn alocar(&mut self, indice: usize, dia: NaiveDate, opcao: OpcaoTurno) {
        let id = self.aptos[indice].id();
        let alocacao = Alocacao {
            funcionario_id: id,
            turno_id: opcao.turno_id,
            data: dia,
            horario: opcao.horario,
        };
        *self.minutos_no_periodo.entry(id).or_default() += alocacao.minutos_trabalhados();
        self.agenda.inserir(alocacao);
        self.novas.push(alocacao);
    }

    fn concluir(self) -> ResultadoPlanejamento {
        let ordem: HashMap<TurnoId, (i32, TurnoId)> = self
            .turnos
            .iter()
            .map(|t| (t.id, (t.ordem, t.id)))
            .collect();
        let mut alocacoes = self.novas;
        alocacoes.sort_by_key(|a| (a.data, ordem.get(&a.turno_id).copied(), a.funcionario_id));
        let mut avisos = self.avisos;
        // Avisos gerais (sem data) primeiro, depois em ordem cronológica.
        avisos.sort_by_key(|a| (a.data.is_some(), a.data, a.tipo));
        ResultadoPlanejamento { alocacoes, avisos }
    }
}

/// Vagas por faixa: `base` pessoas em cada uma e `extras` faixas com uma a mais.
struct Vagas {
    base: usize,
    extras: usize,
    ocupadas: Vec<usize>,
}

impl Vagas {
    fn novas(pessoas: usize, faixas: usize) -> Self {
        let faixas = faixas.max(1);
        Vagas {
            base: pessoas / faixas,
            extras: pessoas % faixas,
            ocupadas: vec![0; faixas],
        }
    }

    fn carga(&self, faixa: usize) -> usize {
        self.ocupadas.get(faixa).copied().unwrap_or(usize::MAX)
    }

    fn cabe(&self, faixa: usize) -> bool {
        let n = self.carga(faixa);
        n < self.base || (n == self.base && self.extras > 0)
    }

    fn ocupar(&mut self, faixa: usize) {
        if let Some(n) = self.ocupadas.get_mut(faixa) {
            if *n >= self.base {
                self.extras = self.extras.saturating_sub(1);
            }
            *n += 1;
        }
    }
}

/// Compara a pressão (turnos que faltam ÷ dias possíveis) sem ponto flutuante:
/// falta_a / (dur_a · dias_a)  vs  falta_b / (dur_b · dias_b).
fn comparar_pressao(a: &Candidato, b: &Candidato) -> Ordering {
    let esquerda =
        u128::from(a.falta_min) * u128::from(b.duracao_ref) * u128::from(b.dias_possiveis);
    let direita =
        u128::from(b.falta_min) * u128::from(a.duracao_ref) * u128::from(a.dias_possiveis);
    esquerda.cmp(&direita)
}

/// `valor * parte / todo`, arredondado para baixo, sem estouro.
fn proporcional(valor: u32, parte: usize, todo: usize) -> u32 {
    if todo == 0 {
        return 0;
    }
    let r = u128::from(valor) * parte as u128 / todo as u128;
    u32::try_from(r).unwrap_or(valor)
}
