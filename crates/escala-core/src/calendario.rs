//! Semanas de apuração e limites de mês.
//!
//! A carga semanal é apurada em semanas completas de 7 dias (segunda–domingo ou
//! domingo–sábado). Um mês que começa ou termina no meio da semana compartilha
//! essa semana com o mês vizinho; o motor soma as horas dos dois lados.

use chrono::{Datelike, Days, NaiveDate};

use crate::modelo::InicioSemana;

/// Semana de apuração: 7 dias consecutivos a partir de `inicio`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Semana {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
}

impl Semana {
    /// Semana que contém `data`. `None` apenas nos extremos do calendário do chrono.
    pub fn contendo(data: NaiveDate, inicio_semana: InicioSemana) -> Option<Semana> {
        let recuo = match inicio_semana {
            InicioSemana::Segunda => data.weekday().num_days_from_monday(),
            InicioSemana::Domingo => data.weekday().num_days_from_sunday(),
        };
        let inicio = data.checked_sub_days(Days::new(u64::from(recuo)))?;
        let fim = inicio.checked_add_days(Days::new(6))?;
        Some(Semana { inicio, fim })
    }

    pub fn contem(&self, data: NaiveDate) -> bool {
        self.inicio <= data && data <= self.fim
    }

    pub fn dias(&self) -> impl Iterator<Item = NaiveDate> + '_ {
        self.inicio.iter_days().take_while(move |d| *d <= self.fim)
    }
}

/// Semanas completas que cobrem o intervalo `[inicio, fim]` (inclusive), em ordem.
pub fn semanas_cobrindo(
    inicio: NaiveDate,
    fim: NaiveDate,
    inicio_semana: InicioSemana,
) -> Option<Vec<Semana>> {
    let mut semanas = Vec::new();
    if fim < inicio {
        return Some(semanas);
    }
    let mut atual = Semana::contendo(inicio, inicio_semana)?;
    loop {
        semanas.push(atual);
        if atual.fim >= fim {
            break;
        }
        atual = Semana::contendo(atual.fim.succ_opt()?, inicio_semana)?;
    }
    Some(semanas)
}

/// Primeiro e último dia do mês (`mes` de 1 a 12).
pub fn limites_do_mes(ano: i32, mes: u32) -> Option<(NaiveDate, NaiveDate)> {
    let primeiro = NaiveDate::from_ymd_opt(ano, mes, 1)?;
    let proximo = if mes == 12 {
        NaiveDate::from_ymd_opt(ano.checked_add(1)?, 1, 1)?
    } else {
        NaiveDate::from_ymd_opt(ano, mes + 1, 1)?
    };
    Some((primeiro, proximo.pred_opt()?))
}

#[cfg(test)]
mod testes {
    use super::*;

    fn d(a: i32, m: u32, dia: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(a, m, dia).expect("data de teste válida")
    }

    #[test]
    fn semana_comeca_na_segunda_ou_no_domingo() {
        // 2025-10-01 é quarta-feira.
        let s = Semana::contendo(d(2025, 10, 1), InicioSemana::Segunda).expect("semana");
        assert_eq!((s.inicio, s.fim), (d(2025, 9, 29), d(2025, 10, 5)));
        let s = Semana::contendo(d(2025, 10, 1), InicioSemana::Domingo).expect("semana");
        assert_eq!((s.inicio, s.fim), (d(2025, 9, 28), d(2025, 10, 4)));
        // O próprio dia inicial pertence à semana que ele abre.
        let s = Semana::contendo(d(2025, 9, 29), InicioSemana::Segunda).expect("semana");
        assert_eq!(s.inicio, d(2025, 9, 29));
    }

    #[test]
    fn mes_que_comeca_e_termina_no_meio_da_semana() {
        let (ini, fim) = limites_do_mes(2025, 10).expect("mês");
        let semanas = semanas_cobrindo(ini, fim, InicioSemana::Segunda).expect("semanas");
        assert_eq!(semanas.len(), 5);
        assert_eq!(semanas[0].inicio, d(2025, 9, 29));
        assert_eq!(semanas[4].fim, d(2025, 11, 2));
        assert!(semanas.iter().all(|s| s.dias().count() == 7));
    }

    #[test]
    fn fevereiro_sem_semanas_parciais() {
        // Fevereiro de 2027 começa numa segunda e tem 28 dias: exatamente 4 semanas.
        let (ini, fim) = limites_do_mes(2027, 2).expect("mês");
        let semanas = semanas_cobrindo(ini, fim, InicioSemana::Segunda).expect("semanas");
        assert_eq!(semanas.len(), 4);
        assert_eq!(semanas[0].inicio, ini);
        assert_eq!(semanas[3].fim, fim);
    }

    #[test]
    fn limites_de_meses() {
        assert_eq!(
            limites_do_mes(2024, 2),
            Some((d(2024, 2, 1), d(2024, 2, 29)))
        );
        assert_eq!(
            limites_do_mes(2025, 12),
            Some((d(2025, 12, 1), d(2025, 12, 31)))
        );
        assert_eq!(limites_do_mes(2025, 13), None);
        assert_eq!(limites_do_mes(2025, 0), None);
    }
}
