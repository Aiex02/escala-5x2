//! Tipos de domínio usados pelo motor de escalas.

use std::collections::BTreeSet;

use chrono::{Datelike, NaiveDate, Weekday};
use thiserror::Error;

use crate::funcionamento::Periodo;
use crate::hora::{formatar_minutos, Horario, MINUTOS_DIA};

pub type FuncionarioId = i64;
pub type TurnoId = i64;

/// Dia em que começa a semana de apuração da carga horária.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default)]
pub enum InicioSemana {
    #[default]
    Segunda,
    Domingo,
}

impl InicioSemana {
    pub fn dia(self) -> Weekday {
        match self {
            InicioSemana::Segunda => Weekday::Mon,
            InicioSemana::Domingo => Weekday::Sun,
        }
    }

    pub fn como_texto(self) -> &'static str {
        match self {
            InicioSemana::Segunda => "segunda",
            InicioSemana::Domingo => "domingo",
        }
    }

    pub fn de_texto(texto: &str) -> Option<Self> {
        match texto.trim().to_lowercase().as_str() {
            "segunda" => Some(InicioSemana::Segunda),
            "domingo" => Some(InicioSemana::Domingo),
            _ => None,
        }
    }
}

/// Regras de carga horária de um cliente. Todas as durações em minutos.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RegrasCarga {
    /// Teto de minutos trabalhados por semana. Nunca é ultrapassado (sem hora extra).
    pub carga_semanal_max_min: u32,
    /// Teto de minutos trabalhados em uma jornada.
    pub jornada_diaria_max_min: u32,
    /// Descanso mínimo entre o fim de uma jornada e o início da seguinte.
    pub descanso_entre_jornadas_min: u32,
    /// Máximo de dias seguidos trabalhados.
    pub max_dias_consecutivos: u32,
    pub inicio_semana: InicioSemana,
    /// Folgas mínimas em cada semana de apuração (1 = até 6x1; 2 = até 5x2).
    pub folgas_semanais_min: u32,
    /// Máximo de domingos seguidos trabalhados (0 = sem limite). No comércio a
    /// Lei 10.101/2000 exige folga em ao menos um domingo a cada três semanas (= 2).
    pub domingos_seguidos_max: u32,
}

impl Default for RegrasCarga {
    /// Padrão alinhado à CLT para 5x2: 40h semanais, 8h diárias, 11h de interjornada,
    /// no máximo 6 dias seguidos (descanso semanal), semana de segunda a domingo.
    fn default() -> Self {
        RegrasCarga {
            carga_semanal_max_min: 40 * 60,
            jornada_diaria_max_min: 8 * 60,
            descanso_entre_jornadas_min: 11 * 60,
            max_dias_consecutivos: 6,
            inicio_semana: InicioSemana::Segunda,
            folgas_semanais_min: 1,
            domingos_seguidos_max: 0,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ErroRegras {
    #[error("a carga semanal máxima deve estar entre 1 minuto e 168 horas")]
    CargaSemanal,
    #[error("a jornada diária máxima deve estar entre 1 minuto e 24 horas")]
    JornadaDiaria,
    #[error(
        "a jornada diária máxima ({diaria}) não pode ser maior que a carga semanal ({semanal})"
    )]
    DiariaMaiorQueSemanal { diaria: String, semanal: String },
    #[error("o descanso entre jornadas deve ser de no máximo 48 horas")]
    Descanso,
    #[error("o máximo de dias consecutivos deve estar entre 1 e 31")]
    DiasConsecutivos,
    #[error("as folgas semanais devem ficar entre 0 e 6")]
    FolgasSemanais,
    #[error("o máximo de domingos seguidos deve ficar entre 0 (sem limite) e 52")]
    DomingosSeguidos,
}

impl RegrasCarga {
    pub fn validar(&self) -> Result<(), ErroRegras> {
        if self.carga_semanal_max_min == 0 || self.carga_semanal_max_min > 7 * MINUTOS_DIA {
            return Err(ErroRegras::CargaSemanal);
        }
        if self.jornada_diaria_max_min == 0 || self.jornada_diaria_max_min > MINUTOS_DIA {
            return Err(ErroRegras::JornadaDiaria);
        }
        if self.jornada_diaria_max_min > self.carga_semanal_max_min {
            return Err(ErroRegras::DiariaMaiorQueSemanal {
                diaria: formatar_minutos(self.jornada_diaria_max_min),
                semanal: formatar_minutos(self.carga_semanal_max_min),
            });
        }
        if self.descanso_entre_jornadas_min > 2 * MINUTOS_DIA {
            return Err(ErroRegras::Descanso);
        }
        if self.max_dias_consecutivos == 0 || self.max_dias_consecutivos > 31 {
            return Err(ErroRegras::DiasConsecutivos);
        }
        if self.folgas_semanais_min > 6 {
            return Err(ErroRegras::FolgasSemanais);
        }
        if self.domingos_seguidos_max > 52 {
            return Err(ErroRegras::DomingosSeguidos);
        }
        Ok(())
    }
}

/// Conjunto de dias da semana. Bit 0 = segunda ... bit 6 = domingo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct DiasSemana(u8);

impl DiasSemana {
    pub const TODOS: DiasSemana = DiasSemana(0b111_1111);
    pub const NENHUM: DiasSemana = DiasSemana(0);

    pub fn de_bits(bits: u8) -> Self {
        DiasSemana(bits & Self::TODOS.0)
    }

    /// Índices 0 = segunda ... 6 = domingo; valores fora da faixa são ignorados.
    pub fn de_indices<I: IntoIterator<Item = u8>>(indices: I) -> Self {
        DiasSemana(
            indices
                .into_iter()
                .filter(|i| *i < 7)
                .fold(0u8, |acc, i| acc | (1 << i)),
        )
    }

    pub fn bits(self) -> u8 {
        self.0
    }

    pub fn indices(self) -> Vec<u8> {
        (0u8..7).filter(|i| self.0 & (1 << i) != 0).collect()
    }

    pub fn com(self, dia: Weekday) -> Self {
        DiasSemana(self.0 | (1 << dia.num_days_from_monday()))
    }

    pub fn contem(self, dia: Weekday) -> bool {
        self.0 & (1 << dia.num_days_from_monday()) != 0
    }

    pub fn vazio(self) -> bool {
        self.0 == 0
    }

    /// Dias presentes em pelo menos um dos dois conjuntos.
    pub fn uniao(self, outro: Self) -> Self {
        DiasSemana(self.0 | outro.0)
    }
}

impl Default for DiasSemana {
    fn default() -> Self {
        DiasSemana::TODOS
    }
}

/// Turno de trabalho de um cliente (ex.: Manhã 06:00–14:00).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Turno {
    pub id: TurnoId,
    pub nome: String,
    pub horario: Horario,
    /// Pessoas mínimas por dia neste turno (0 = sem mínimo).
    pub efetivo_minimo: u32,
    pub ordem: i32,
    /// Dias da semana em que o turno funciona. Fora deles ninguém é escalado no
    /// turno, e o efetivo mínimo não se aplica.
    pub dias: DiasSemana,
}

impl Turno {
    pub fn funciona_em(&self, data: NaiveDate) -> bool {
        self.dias.contem(data.weekday())
    }
}

/// Turno em que um funcionário pode trabalhar, com o horário efetivo dele
/// (o do turno ou um horário próprio vindo da planilha).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpcaoTurno {
    pub turno_id: TurnoId,
    pub horario: Horario,
}

/// Funcionário como o motor o enxerga.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FuncionarioPlano {
    pub id: FuncionarioId,
    pub nome: String,
    pub opcoes: Vec<OpcaoTurno>,
    /// Carga contratual individual; o teto efetivo é o menor entre ela e a regra do cliente.
    pub carga_semanal_min: Option<u32>,
    pub dias_disponiveis: DiasSemana,
    /// Ausências justificadas (férias, atestados, afastamentos): não trabalha e as
    /// horas do dia são abonadas (saem das horas previstas da semana).
    pub indisponivel: BTreeSet<NaiveDate>,
    /// Faltas (ausências não justificadas): não trabalha, mas as horas do dia
    /// continuam previstas, então a pessoa fica devendo.
    pub faltas: BTreeSet<NaiveDate>,
    /// Período preferido; atendido quando houver vaga nele.
    pub preferencia: Option<Periodo>,
    /// Saldo de horas de antes do período, em minutos (positivo = horas a mais,
    /// negativo = devendo). O motor compensa o que as regras permitirem.
    pub saldo_anterior_min: i64,
    /// Função (cargo) normalizada por `chave_funcao`; usada na cobertura por função.
    pub funcao: Option<String>,
}

/// Mínimo de pessoas de uma função em cada turno de cada dia.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FuncaoMinima {
    /// Nome para os avisos (ex.: "Cozinheiro").
    pub nome: String,
    pub minimo: u32,
}

/// Chave de uma função para agrupar cargos escritos de jeitos diferentes:
/// "Farmacêutica (o)" e "farmaceutica" viram "farmaceutica".
pub fn chave_funcao(cargo: &str) -> String {
    let sem_genero = cargo
        .to_lowercase()
        .replace("(as)", "")
        .replace("(os)", "")
        .replace("(a)", "")
        .replace("(o)", "");
    sem_genero
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            outro => outro,
        })
        .filter(|c| c.is_alphanumeric())
        .collect()
}

impl FuncionarioPlano {
    pub fn limite_semanal_min(&self, regras: &RegrasCarga) -> u32 {
        self.carga_semanal_min
            .map_or(regras.carga_semanal_max_min, |c| {
                c.min(regras.carga_semanal_max_min)
            })
    }

    /// Pode ser escalado no dia (dia da semana disponível, sem ausência nem falta).
    pub fn disponivel_em(&self, data: NaiveDate) -> bool {
        self.dias_disponiveis.contem(data.weekday())
            && !self.indisponivel.contains(&data)
            && !self.faltas.contains(&data)
    }
}

/// Um funcionário escalado em um turno em uma data.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Alocacao {
    pub funcionario_id: FuncionarioId,
    pub turno_id: TurnoId,
    pub data: NaiveDate,
    pub horario: Horario,
}

impl Alocacao {
    pub fn minutos_trabalhados(&self) -> u32 {
        self.horario.minutos_trabalhados()
    }

    /// Minuto absoluto (contado desde o início da era) em que a jornada começa.
    pub fn inicio_absoluto(&self) -> i64 {
        minuto_absoluto(self.data) + i64::from(self.horario.inicio().minutos())
    }

    pub fn fim_absoluto(&self) -> i64 {
        self.inicio_absoluto() + i64::from(self.horario.duracao_total_min())
    }
}

pub(crate) fn minuto_absoluto(data: NaiveDate) -> i64 {
    i64::from(data.num_days_from_ce()) * i64::from(MINUTOS_DIA)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum TipoAviso {
    /// Turno ficou abaixo do efetivo mínimo em um dia.
    CoberturaInsuficiente,
    /// Horário do funcionário excede a jornada diária máxima; o turno é ignorado.
    TurnoExcedeJornada,
    /// Funcionário sem nenhum turno; não é escalado.
    FuncionarioSemTurno,
    /// Funcionário ficou pelo menos um turno abaixo da carga-alvo da semana.
    CargaAbaixoDoAlvo,
    /// Alocação existente viola as regras atuais.
    ViolacaoRegra,
    /// Turno ficou sem o mínimo de pessoas de uma função em algum dia.
    FuncaoDescoberta,
}

impl TipoAviso {
    pub const TODOS: [TipoAviso; 6] = [
        TipoAviso::CoberturaInsuficiente,
        TipoAviso::TurnoExcedeJornada,
        TipoAviso::FuncionarioSemTurno,
        TipoAviso::CargaAbaixoDoAlvo,
        TipoAviso::ViolacaoRegra,
        TipoAviso::FuncaoDescoberta,
    ];

    /// Código estável usado na persistência e na interface.
    pub fn codigo(self) -> &'static str {
        match self {
            TipoAviso::CoberturaInsuficiente => "coberturaInsuficiente",
            TipoAviso::TurnoExcedeJornada => "turnoExcedeJornada",
            TipoAviso::FuncionarioSemTurno => "funcionarioSemTurno",
            TipoAviso::CargaAbaixoDoAlvo => "cargaAbaixoDoAlvo",
            TipoAviso::ViolacaoRegra => "violacaoRegra",
            TipoAviso::FuncaoDescoberta => "funcaoDescoberta",
        }
    }

    pub fn de_codigo(codigo: &str) -> Option<Self> {
        Self::TODOS.into_iter().find(|t| t.codigo() == codigo)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Aviso {
    pub tipo: TipoAviso,
    pub data: Option<NaiveDate>,
    pub turno_id: Option<TurnoId>,
    pub funcionario_id: Option<FuncionarioId>,
    pub mensagem: String,
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn dias_semana_por_indice() {
        let d = DiasSemana::de_indices([0, 2, 6, 9]);
        assert_eq!(d.indices(), vec![0, 2, 6]);
        assert!(d.contem(Weekday::Mon));
        assert!(!d.contem(Weekday::Tue));
        assert!(d.contem(Weekday::Sun));
    }

    #[test]
    fn uniao_e_funcionamento_do_turno() {
        let seg_qua = DiasSemana::de_indices([0, 2]);
        let ter = DiasSemana::de_indices([1]);
        assert_eq!(seg_qua.uniao(ter).indices(), vec![0, 1, 2]);
        assert_eq!(DiasSemana::NENHUM.uniao(ter), ter);

        let turno = Turno {
            id: 1,
            nome: "Comercial".into(),
            horario: Horario::novo(
                "08:00".parse().expect("hora"),
                "16:00".parse().expect("hora"),
                0,
            )
            .expect("horário"),
            efetivo_minimo: 0,
            ordem: 0,
            dias: seg_qua,
        };
        let segunda = NaiveDate::from_ymd_opt(2026, 3, 2).expect("data");
        assert!(turno.funciona_em(segunda));
        assert!(!turno.funciona_em(segunda + chrono::Days::new(1)));
    }

    #[test]
    fn regras_padrao_sao_validas() {
        assert_eq!(RegrasCarga::default().validar(), Ok(()));
    }

    #[test]
    fn regras_invalidas() {
        let base = RegrasCarga::default();
        let casos = [
            RegrasCarga {
                carga_semanal_max_min: 0,
                ..base
            },
            RegrasCarga {
                jornada_diaria_max_min: 0,
                ..base
            },
            RegrasCarga {
                jornada_diaria_max_min: 10 * 60,
                carga_semanal_max_min: 6 * 60,
                ..base
            },
            RegrasCarga {
                max_dias_consecutivos: 0,
                ..base
            },
            RegrasCarga {
                descanso_entre_jornadas_min: 3 * MINUTOS_DIA,
                ..base
            },
        ];
        for regras in casos {
            assert!(regras.validar().is_err(), "{regras:?}");
        }
    }

    #[test]
    fn limite_individual_nunca_supera_regra() {
        let regras = RegrasCarga::default();
        let mut f = FuncionarioPlano {
            id: 1,
            nome: "A".into(),
            opcoes: vec![],
            carga_semanal_min: Some(44 * 60),
            dias_disponiveis: DiasSemana::TODOS,
            indisponivel: BTreeSet::new(),
            faltas: BTreeSet::new(),
            preferencia: None,
            saldo_anterior_min: 0,
            funcao: None,
        };
        assert_eq!(f.limite_semanal_min(&regras), 40 * 60);
        f.carga_semanal_min = Some(30 * 60);
        assert_eq!(f.limite_semanal_min(&regras), 30 * 60);
    }
}
