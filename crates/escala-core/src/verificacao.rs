//! Verificação independente de uma escala contra as regras de carga.
//!
//! Implementada sem reaproveitar o código do motor (agrupa e ordena tudo do zero),
//! para servir de prova nos testes e para apontar, na agenda, alocações antigas
//! que passaram a violar regras alteradas depois da geração.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;

use chrono::{Datelike, NaiveDate, Weekday};

use crate::calendario::Semana;
use crate::hora::formatar_minutos;
use crate::modelo::{Alocacao, FuncionarioId, FuncionarioPlano, Turno, TurnoId};
use crate::motor::EntradaPlanejamento;
use crate::regime::{limite_do_funcionario, limites_da_semana};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Violacao {
    ForaDoPeriodo {
        funcionario: String,
        data: NaiveDate,
    },
    FuncionarioDesconhecido {
        funcionario_id: FuncionarioId,
        data: NaiveDate,
    },
    MaisDeUmaJornadaNoDia {
        funcionario: String,
        data: NaiveDate,
    },
    DiaIndisponivel {
        funcionario: String,
        data: NaiveDate,
    },
    JornadaDiaria {
        funcionario: String,
        data: NaiveDate,
        minutos: u32,
        limite: u32,
    },
    CargaSemanal {
        funcionario: String,
        semana: Semana,
        minutos: u32,
        limite: u32,
    },
    Descanso {
        funcionario: String,
        data: NaiveDate,
        minutos: i64,
        minimo: u32,
    },
    DiasConsecutivos {
        funcionario: String,
        ate: NaiveDate,
        dias: u32,
        maximo: u32,
    },
    /// Alocação num dia da semana em que o turno não funciona.
    TurnoInativoNoDia {
        funcionario: String,
        data: NaiveDate,
        turno: String,
    },
    /// Menos folgas na semana que o mínimo exigido (ex.: 6 dias com regra 5x2).
    FolgasSemanais {
        funcionario: String,
        semana: Semana,
        dias_trabalhados: u32,
        folgas_minimas: u32,
    },
    /// Mais domingos seguidos trabalhados que o permitido.
    DomingosSeguidos {
        funcionario: String,
        ate: NaiveDate,
        domingos: u32,
        maximo: u32,
    },
}

impl Violacao {
    /// Data à qual a violação se refere (para ordenação e exibição).
    pub fn data(&self) -> NaiveDate {
        match self {
            Violacao::ForaDoPeriodo { data, .. }
            | Violacao::FuncionarioDesconhecido { data, .. }
            | Violacao::MaisDeUmaJornadaNoDia { data, .. }
            | Violacao::DiaIndisponivel { data, .. }
            | Violacao::JornadaDiaria { data, .. }
            | Violacao::Descanso { data, .. }
            | Violacao::TurnoInativoNoDia { data, .. } => *data,
            Violacao::CargaSemanal { semana, .. } | Violacao::FolgasSemanais { semana, .. } => {
                semana.inicio
            }
            Violacao::DiasConsecutivos { ate, .. } | Violacao::DomingosSeguidos { ate, .. } => *ate,
        }
    }
}

impl fmt::Display for Violacao {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let dm = |d: &NaiveDate| d.format("%d/%m/%Y").to_string();
        match self {
            Violacao::ForaDoPeriodo { funcionario, data } => {
                write!(f, "{funcionario}: alocação em {} fora do período", dm(data))
            }
            Violacao::FuncionarioDesconhecido {
                funcionario_id,
                data,
            } => {
                write!(
                    f,
                    "alocação em {} de funcionário desconhecido ({funcionario_id})",
                    dm(data)
                )
            }
            Violacao::MaisDeUmaJornadaNoDia { funcionario, data } => {
                write!(f, "{funcionario}: mais de uma jornada em {}", dm(data))
            }
            Violacao::DiaIndisponivel { funcionario, data } => {
                write!(
                    f,
                    "{funcionario}: escalado em {}, dia indisponível",
                    dm(data)
                )
            }
            Violacao::JornadaDiaria {
                funcionario,
                data,
                minutos,
                limite,
            } => write!(
                f,
                "{funcionario}: jornada de {} em {} excede o máximo diário de {}",
                formatar_minutos(*minutos),
                dm(data),
                formatar_minutos(*limite)
            ),
            Violacao::CargaSemanal {
                funcionario,
                semana,
                minutos,
                limite,
            } => write!(
                f,
                "{funcionario}: {} na semana de {} a {} excede o limite de {} (hora extra)",
                formatar_minutos(*minutos),
                semana.inicio.format("%d/%m"),
                semana.fim.format("%d/%m"),
                formatar_minutos(*limite)
            ),
            Violacao::Descanso {
                funcionario,
                data,
                minutos,
                minimo,
            } => write!(
                f,
                "{funcionario}: descanso de {} antes da jornada de {} (mínimo {})",
                formatar_minutos(u32::try_from((*minutos).max(0)).unwrap_or(0)),
                dm(data),
                formatar_minutos(*minimo)
            ),
            Violacao::DiasConsecutivos {
                funcionario,
                ate,
                dias,
                maximo,
            } => write!(
                f,
                "{funcionario}: {dias} dias seguidos de trabalho até {} (máximo {maximo})",
                dm(ate)
            ),
            Violacao::TurnoInativoNoDia {
                funcionario,
                data,
                turno,
            } => write!(
                f,
                "{funcionario}: escalada em {} no turno {turno}, que não funciona nesse dia",
                dm(data)
            ),
            Violacao::FolgasSemanais {
                funcionario,
                semana,
                dias_trabalhados,
                folgas_minimas,
            } => write!(
                f,
                "{funcionario}: {dias_trabalhados} dias de trabalho na semana de {} a {}; a regra exige {folgas_minimas} folga(s) por semana",
                semana.inicio.format("%d/%m"),
                semana.fim.format("%d/%m"),
            ),
            Violacao::DomingosSeguidos {
                funcionario,
                ate,
                domingos,
                maximo,
            } => write!(
                f,
                "{funcionario}: {domingos} domingos seguidos de trabalho até {} (máximo {maximo})",
                dm(ate)
            ),
        }
    }
}

/// Verifica `alocacoes` (do período) somadas às alocações fixas da entrada.
/// Só reporta problemas que envolvem ao menos um dia do período.
pub fn verificar(entrada: &EntradaPlanejamento, alocacoes: &[Alocacao]) -> Vec<Violacao> {
    let regras = &entrada.regras;
    let no_periodo = |d: NaiveDate| entrada.inicio <= d && d <= entrada.fim;
    let funcionarios: HashMap<FuncionarioId, &FuncionarioPlano> =
        entrada.funcionarios.iter().map(|f| (f.id, f)).collect();
    let turnos: HashMap<TurnoId, &Turno> = entrada.turnos.iter().map(|t| (t.id, t)).collect();
    let mut violacoes = Vec::new();

    // Checagens individuais das alocações do período.
    let mut vistos: BTreeSet<(FuncionarioId, NaiveDate)> = BTreeSet::new();
    for a in alocacoes {
        let Some(func) = funcionarios.get(&a.funcionario_id) else {
            violacoes.push(Violacao::FuncionarioDesconhecido {
                funcionario_id: a.funcionario_id,
                data: a.data,
            });
            continue;
        };
        let nome = func.nome.clone();
        if !no_periodo(a.data) {
            violacoes.push(Violacao::ForaDoPeriodo {
                funcionario: nome.clone(),
                data: a.data,
            });
        }
        if !vistos.insert((a.funcionario_id, a.data)) {
            violacoes.push(Violacao::MaisDeUmaJornadaNoDia {
                funcionario: nome.clone(),
                data: a.data,
            });
        }
        if !func.disponivel_em(a.data) {
            violacoes.push(Violacao::DiaIndisponivel {
                funcionario: nome.clone(),
                data: a.data,
            });
        }
        if let Some(turno) = turnos.get(&a.turno_id) {
            if !turno.funciona_em(a.data) {
                violacoes.push(Violacao::TurnoInativoNoDia {
                    funcionario: nome.clone(),
                    data: a.data,
                    turno: turno.nome.clone(),
                });
            }
        }
        if a.minutos_trabalhados() > regras.jornada_diaria_max_min {
            violacoes.push(Violacao::JornadaDiaria {
                funcionario: nome,
                data: a.data,
                minutos: a.minutos_trabalhados(),
                limite: regras.jornada_diaria_max_min,
            });
        }
    }

    // Checagens que dependem da sequência: une período + fixas, por funcionário.
    let mut por_funcionario: BTreeMap<FuncionarioId, Vec<&Alocacao>> = BTreeMap::new();
    for a in alocacoes.iter().chain(&entrada.alocacoes_fixas) {
        por_funcionario.entry(a.funcionario_id).or_default().push(a);
    }

    for (id, mut lista) in por_funcionario {
        let Some(func) = funcionarios.get(&id) else {
            continue;
        };
        lista.sort_by_key(|a| (a.inicio_absoluto(), a.data));

        // Carga semanal e folgas (semana completa de apuração, com o regime vigente).
        let mut semanas: BTreeMap<Semana, (u32, BTreeSet<NaiveDate>, bool)> = BTreeMap::new();
        for a in &lista {
            if let Some(semana) = Semana::contendo(a.data, regras.inicio_semana) {
                let item = semanas.entry(semana).or_insert((0, BTreeSet::new(), false));
                item.0 += a.minutos_trabalhados();
                item.1.insert(a.data);
                item.2 |= no_periodo(a.data);
            }
        }
        for (semana, (minutos, dias, toca_periodo)) in semanas {
            if !toca_periodo {
                continue;
            }
            let limites = limites_da_semana(regras, &entrada.regime, &semana);
            let limite = limite_do_funcionario(func, &limites);
            if minutos > limite {
                violacoes.push(Violacao::CargaSemanal {
                    funcionario: func.nome.clone(),
                    semana,
                    minutos,
                    limite,
                });
            }
            let dias_trabalhados = u32::try_from(dias.len()).unwrap_or(u32::MAX);
            if dias_trabalhados > limites.dias_trabalho_max() {
                violacoes.push(Violacao::FolgasSemanais {
                    funcionario: func.nome.clone(),
                    semana,
                    dias_trabalhados,
                    folgas_minimas: limites.folgas_min,
                });
            }
        }

        // Domingos seguidos.
        if regras.domingos_seguidos_max > 0 {
            let domingos: BTreeSet<NaiveDate> = lista
                .iter()
                .map(|a| a.data)
                .filter(|d| d.weekday() == Weekday::Sun)
                .collect();
            let mut sequencia: Vec<NaiveDate> = Vec::new();
            let mut fechar = |seq: &[NaiveDate]| {
                let total = u32::try_from(seq.len()).unwrap_or(u32::MAX);
                if total > regras.domingos_seguidos_max && seq.iter().any(|d| no_periodo(*d)) {
                    if let Some(ate) = seq.last() {
                        violacoes.push(Violacao::DomingosSeguidos {
                            funcionario: func.nome.clone(),
                            ate: *ate,
                            domingos: total,
                            maximo: regras.domingos_seguidos_max,
                        });
                    }
                }
            };
            for d in domingos {
                let continua = sequencia
                    .last()
                    .and_then(|u| u.checked_add_days(chrono::Days::new(7)))
                    == Some(d);
                if !continua && !sequencia.is_empty() {
                    fechar(&sequencia);
                    sequencia.clear();
                }
                sequencia.push(d);
            }
            fechar(&sequencia);
        }

        // Descanso entre jornadas consecutivas.
        for par in lista.windows(2) {
            let (anterior, seguinte) = (par[0], par[1]);
            let descanso = seguinte.inicio_absoluto() - anterior.fim_absoluto();
            if descanso < i64::from(regras.descanso_entre_jornadas_min)
                && (no_periodo(anterior.data) || no_periodo(seguinte.data))
            {
                violacoes.push(Violacao::Descanso {
                    funcionario: func.nome.clone(),
                    data: seguinte.data,
                    minutos: descanso,
                    minimo: regras.descanso_entre_jornadas_min,
                });
            }
        }

        // Dias consecutivos.
        let datas: BTreeSet<NaiveDate> = lista.iter().map(|a| a.data).collect();
        let mut sequencia: Vec<NaiveDate> = Vec::new();
        let fechar = |seq: &[NaiveDate], violacoes: &mut Vec<Violacao>| {
            let dias = u32::try_from(seq.len()).unwrap_or(u32::MAX);
            if dias > regras.max_dias_consecutivos && seq.iter().any(|d| no_periodo(*d)) {
                if let Some(ate) = seq.last() {
                    violacoes.push(Violacao::DiasConsecutivos {
                        funcionario: func.nome.clone(),
                        ate: *ate,
                        dias,
                        maximo: regras.max_dias_consecutivos,
                    });
                }
            }
        };
        for d in datas {
            if sequencia.last().and_then(|u| u.succ_opt()) != Some(d) && !sequencia.is_empty() {
                fechar(&sequencia, &mut violacoes);
                sequencia.clear();
            }
            sequencia.push(d);
        }
        fechar(&sequencia, &mut violacoes);
    }

    violacoes.sort_by_key(Violacao::data);
    violacoes
}
