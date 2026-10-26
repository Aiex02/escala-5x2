//! Índice de alocações por funcionário e data, usado pelo motor para checar
//! restrições de forma incremental.

use std::collections::{BTreeMap, HashMap};
use std::ops::Bound;

use chrono::NaiveDate;

use crate::calendario::Semana;
use crate::modelo::{Alocacao, FuncionarioId};

#[derive(Debug, Default)]
pub(crate) struct Agenda {
    por_funcionario: HashMap<FuncionarioId, BTreeMap<NaiveDate, Alocacao>>,
}

impl Agenda {
    pub(crate) fn inserir(&mut self, alocacao: Alocacao) {
        self.por_funcionario
            .entry(alocacao.funcionario_id)
            .or_default()
            .insert(alocacao.data, alocacao);
    }

    fn de(&self, funcionario: FuncionarioId) -> Option<&BTreeMap<NaiveDate, Alocacao>> {
        self.por_funcionario.get(&funcionario)
    }

    pub(crate) fn em(&self, funcionario: FuncionarioId, data: NaiveDate) -> Option<&Alocacao> {
        self.de(funcionario).and_then(|m| m.get(&data))
    }

    pub(crate) fn minutos_na_semana(&self, funcionario: FuncionarioId, semana: &Semana) -> u32 {
        self.de(funcionario).map_or(0, |m| {
            m.range(semana.inicio..=semana.fim)
                .map(|(_, a)| a.minutos_trabalhados())
                .sum()
        })
    }

    /// Dias com jornada na semana (fixas e novas).
    pub(crate) fn dias_na_semana(&self, funcionario: FuncionarioId, semana: &Semana) -> u32 {
        self.de(funcionario).map_or(0, |m| {
            u32::try_from(m.range(semana.inicio..=semana.fim).count()).unwrap_or(u32::MAX)
        })
    }

    /// Domingos (ou qualquer dia da semana de `data`) trabalhados seguidos antes e
    /// depois de `data`, andando de 7 em 7 dias.
    pub(crate) fn mesmos_dias_seguidos(
        &self,
        funcionario: FuncionarioId,
        data: NaiveDate,
    ) -> (u32, u32) {
        let contar = |passo: i64| {
            let mut total = 0;
            let mut dia = data.checked_add_signed(chrono::Duration::days(passo));
            while let Some(d) = dia {
                if self.em(funcionario, d).is_none() {
                    break;
                }
                total += 1;
                dia = d.checked_add_signed(chrono::Duration::days(passo));
            }
            total
        };
        (contar(-7), contar(7))
    }

    /// Quantos dias iguais ao de `data` (ex.: domingos) o funcionário trabalhou nas
    /// `semanas` anteriores.
    pub(crate) fn mesmos_dias_trabalhados(
        &self,
        funcionario: FuncionarioId,
        data: NaiveDate,
        semanas: i64,
    ) -> u32 {
        (1..=semanas)
            .filter_map(|k| data.checked_sub_signed(chrono::Duration::days(7 * k)))
            .filter(|d| self.em(funcionario, *d).is_some())
            .count() as u32
    }

    /// Última alocação antes de `data`.
    pub(crate) fn anterior(
        &self,
        funcionario: FuncionarioId,
        data: NaiveDate,
    ) -> Option<&Alocacao> {
        self.de(funcionario)
            .and_then(|m| m.range(..data).next_back().map(|(_, a)| a))
    }

    /// Primeira alocação depois de `data`.
    pub(crate) fn seguinte(
        &self,
        funcionario: FuncionarioId,
        data: NaiveDate,
    ) -> Option<&Alocacao> {
        self.de(funcionario).and_then(|m| {
            m.range((Bound::Excluded(data), Bound::Unbounded))
                .next()
                .map(|(_, a)| a)
        })
    }

    /// Dias trabalhados imediatamente antes de `data`, sem interrupção.
    pub(crate) fn dias_seguidos_antes(&self, funcionario: FuncionarioId, data: NaiveDate) -> u32 {
        let mut total = 0;
        let mut dia = data.pred_opt();
        while let Some(d) = dia {
            if self.em(funcionario, d).is_none() {
                break;
            }
            total += 1;
            dia = d.pred_opt();
        }
        total
    }

    /// Dias trabalhados imediatamente depois de `data`, sem interrupção.
    pub(crate) fn dias_seguidos_depois(&self, funcionario: FuncionarioId, data: NaiveDate) -> u32 {
        let mut total = 0;
        let mut dia = data.succ_opt();
        while let Some(d) = dia {
            if self.em(funcionario, d).is_none() {
                break;
            }
            total += 1;
            dia = d.succ_opt();
        }
        total
    }
}
