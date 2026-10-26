//! Regime legal de jornada com vigência por data.
//!
//! As regras do cliente ([`RegrasCarga`]) são a política da empresa. O regime
//! legal acrescenta tetos que mudam com o tempo — caso da EC 141/2026, que acaba
//! com a escala 6x1 em duas etapas. Em cada semana de apuração vale o mais
//! restritivo entre a empresa e a lei: a menor carga semanal e o maior número de
//! folgas exigidos em qualquer dia daquela semana.

use chrono::{Months, NaiveDate};

use crate::calendario::Semana;
use crate::modelo::{FuncionarioPlano, RegrasCarga};

/// Limites legais a partir de uma data (até a próxima etapa).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EtapaRegime {
    pub vigencia: NaiveDate,
    pub carga_semanal_max_min: u32,
    pub folgas_semanais_min: u32,
}

/// Limites efetivos de uma semana de apuração.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LimitesSemana {
    pub carga_max_min: u32,
    pub folgas_min: u32,
}

impl LimitesSemana {
    /// Dias de trabalho permitidos na semana.
    pub fn dias_trabalho_max(&self) -> u32 {
        7u32.saturating_sub(self.folgas_min)
    }
}

/// Etapa vigente em `data` (a de maior vigência que já começou).
pub fn etapa_em(etapas: &[EtapaRegime], data: NaiveDate) -> Option<&EtapaRegime> {
    etapas
        .iter()
        .filter(|e| e.vigencia <= data)
        .max_by_key(|e| e.vigencia)
}

/// Limites da semana: o mais restritivo entre a empresa e a lei em qualquer dia dela.
pub fn limites_da_semana(
    regras: &RegrasCarga,
    etapas: &[EtapaRegime],
    semana: &Semana,
) -> LimitesSemana {
    let mut limites = LimitesSemana {
        carga_max_min: regras.carga_semanal_max_min,
        folgas_min: regras.folgas_semanais_min,
    };
    for dia in semana.dias() {
        if let Some(etapa) = etapa_em(etapas, dia) {
            limites.carga_max_min = limites.carga_max_min.min(etapa.carga_semanal_max_min);
            limites.folgas_min = limites.folgas_min.max(etapa.folgas_semanais_min);
        }
    }
    limites
}

/// Teto semanal do funcionário: contrato individual limitado pela semana.
pub fn limite_do_funcionario(funcionario: &FuncionarioPlano, limites: &LimitesSemana) -> u32 {
    funcionario
        .carga_semanal_min
        .map_or(limites.carga_max_min, |c| c.min(limites.carga_max_min))
}

/// Data de publicação da EC 141/2026 (promulgada em 16/10/2026). Editável no app,
/// pois a contagem dos prazos parte da publicação.
pub fn publicacao_ec141_padrao() -> Option<NaiveDate> {
    NaiveDate::from_ymd_opt(2026, 10, 16)
}

/// Etapas da EC 141/2026 (fim da escala 6x1), contadas da publicação:
/// - até 2 meses depois: regra anterior da CLT (44h e 1 folga semanal);
/// - 2 meses depois: 42h semanais e 2 folgas por semana;
/// - 14 meses depois: 40h semanais e 2 folgas por semana.
pub fn etapas_ec141(publicacao: NaiveDate) -> Vec<EtapaRegime> {
    let mut etapas = Vec::with_capacity(3);
    if let Some(inicio) = NaiveDate::from_ymd_opt(1900, 1, 1) {
        etapas.push(EtapaRegime {
            vigencia: inicio,
            carga_semanal_max_min: 44 * 60,
            folgas_semanais_min: 1,
        });
    }
    if let Some(primeira) = publicacao.checked_add_months(Months::new(2)) {
        etapas.push(EtapaRegime {
            vigencia: primeira,
            carga_semanal_max_min: 42 * 60,
            folgas_semanais_min: 2,
        });
        if let Some(final_) = primeira.checked_add_months(Months::new(12)) {
            etapas.push(EtapaRegime {
                vigencia: final_,
                carga_semanal_max_min: 40 * 60,
                folgas_semanais_min: 2,
            });
        }
    }
    etapas
}

/// Regime legal escolhido para o cliente.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegimeLegal {
    /// Só as regras da empresa.
    Livre,
    /// Fim da escala 6x1 (EC 141/2026), com prazos contados da publicação.
    Ec141 { publicacao: NaiveDate },
}

impl RegimeLegal {
    pub fn etapas(&self) -> Vec<EtapaRegime> {
        match self {
            RegimeLegal::Livre => Vec::new(),
            RegimeLegal::Ec141 { publicacao } => etapas_ec141(*publicacao),
        }
    }

    pub fn codigo(&self) -> &'static str {
        match self {
            RegimeLegal::Livre => "livre",
            RegimeLegal::Ec141 { .. } => "ec141",
        }
    }

    /// `publicacao` é usada só no regime da EC 141 (padrão: 16/10/2026).
    pub fn de_codigo(codigo: &str, publicacao: Option<NaiveDate>) -> Option<Self> {
        match codigo {
            "livre" => Some(RegimeLegal::Livre),
            "ec141" => publicacao
                .or_else(publicacao_ec141_padrao)
                .map(|publicacao| RegimeLegal::Ec141 { publicacao }),
            _ => None,
        }
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use crate::modelo::InicioSemana;

    fn d(a: i32, m: u32, dia: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(a, m, dia).expect("data")
    }

    #[test]
    fn etapas_da_ec141() {
        let etapas = etapas_ec141(d(2026, 10, 16));
        assert_eq!(etapas.len(), 3);
        assert_eq!(etapas[1].vigencia, d(2026, 12, 16));
        assert_eq!(etapas[2].vigencia, d(2027, 12, 16));
        assert_eq!(
            etapa_em(&etapas, d(2026, 11, 1)).map(|e| e.carga_semanal_max_min),
            Some(44 * 60)
        );
        assert_eq!(
            etapa_em(&etapas, d(2026, 12, 16)).map(|e| e.folgas_semanais_min),
            Some(2)
        );
        assert_eq!(
            etapa_em(&etapas, d(2028, 1, 1)).map(|e| e.carga_semanal_max_min),
            Some(40 * 60)
        );
    }

    #[test]
    fn semana_da_virada_usa_o_mais_restritivo() {
        let regras = RegrasCarga {
            carga_semanal_max_min: 44 * 60,
            ..RegrasCarga::default()
        };
        let etapas = etapas_ec141(d(2026, 10, 16));
        // 14/12/2026 (seg) a 20/12/2026: a etapa de 42h começa na quarta, 16/12.
        let semana = Semana::contendo(d(2026, 12, 16), InicioSemana::Segunda).expect("semana");
        assert_eq!(
            limites_da_semana(&regras, &etapas, &semana),
            LimitesSemana {
                carga_max_min: 42 * 60,
                folgas_min: 2
            }
        );
        // Antes da transição vale a CLT anterior, limitada pela empresa.
        let antes = Semana::contendo(d(2026, 11, 4), InicioSemana::Segunda).expect("semana");
        let empresa_40 = RegrasCarga {
            carga_semanal_max_min: 40 * 60,
            ..RegrasCarga::default()
        };
        assert_eq!(
            limites_da_semana(&empresa_40, &etapas, &antes),
            LimitesSemana {
                carga_max_min: 40 * 60,
                folgas_min: 1
            }
        );
        // Sem regime legal, só a empresa.
        assert_eq!(
            limites_da_semana(&regras, &[], &semana),
            LimitesSemana {
                carga_max_min: 44 * 60,
                folgas_min: 1
            }
        );
    }
}
