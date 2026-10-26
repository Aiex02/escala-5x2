//! Horas previstas por semana e jornada de referência de cada funcionário.
//!
//! O "previsto" é o que a pessoa deve cumprir numa semana completa: jornadas
//! inteiras dentro do limite semanal e das folgas obrigatórias, nos dias em que
//! o estabelecimento abre para ela. Cada ausência justificada nesses dias abona
//! uma jornada; falta não abona. O saldo (horas feitas − previstas) é o que o
//! motor compensa nos meses seguintes.

use std::collections::HashMap;

use chrono::{Datelike, NaiveDate};

use crate::calendario::Semana;
use crate::modelo::{DiasSemana, FuncionarioPlano, Turno, TurnoId};
use crate::regime::{limite_do_funcionario, LimitesSemana};

/// Jornada normal do funcionário: a do turno (entre as opções que cabem na
/// jornada diária máxima) que funciona mais dias na semana; no empate, a mais
/// longa. Um turno curto de um dia só não muda a referência.
pub fn jornada_de_referencia(
    funcionario: &FuncionarioPlano,
    turnos: &[Turno],
    jornada_diaria_max_min: u32,
) -> Option<u32> {
    let dias: HashMap<TurnoId, DiasSemana> = turnos.iter().map(|t| (t.id, t.dias)).collect();
    funcionario
        .opcoes
        .iter()
        .filter(|o| {
            let m = o.horario.minutos_trabalhados();
            m > 0 && m <= jornada_diaria_max_min
        })
        .max_by_key(|o| {
            let n = dias.get(&o.turno_id).map_or(0, |d| d.indices().len());
            (n, o.horario.minutos_trabalhados())
        })
        .map(|o| o.horario.minutos_trabalhados())
}

/// Horas previstas da semana completa para o funcionário, em minutos.
pub fn previsto_da_semana(
    funcionario: &FuncionarioPlano,
    turnos: &[Turno],
    limites: &LimitesSemana,
    semana: &Semana,
    jornada_min: u32,
) -> u32 {
    if jornada_min == 0 {
        return 0;
    }
    let dias: HashMap<TurnoId, DiasSemana> = turnos.iter().map(|t| (t.id, t.dias)).collect();
    let abre = |d: NaiveDate| {
        funcionario.dias_disponiveis.contem(d.weekday())
            && funcionario
                .opcoes
                .iter()
                .any(|o| dias.get(&o.turno_id).is_some_and(|x| x.contem(d.weekday())))
    };
    let abertos: Vec<NaiveDate> = semana.dias().filter(|d| abre(*d)).collect();
    let abonados = abertos
        .iter()
        .filter(|d| funcionario.indisponivel.contains(d))
        .count();
    let jornadas = (limite_do_funcionario(funcionario, limites) / jornada_min)
        .min(limites.dias_trabalho_max())
        .min(u32::try_from(abertos.len()).unwrap_or(7))
        .saturating_sub(u32::try_from(abonados).unwrap_or(7));
    jornadas * jornada_min
}
