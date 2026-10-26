//! Monta a escala do mês no formato da exportação para Excel.

use std::collections::HashMap;

use chrono::NaiveDate;
use escala_core::limites_do_mes;
use escala_db::FuncionarioRow;
use escala_excel::{
    CelulaEscala, EscalaParaExportar, HorasSemanaExportar, LinhaEscalaExportar, TurnoExportar,
};

use crate::dto::AgendaMesDto;
use crate::{ErroApp, Resultado};

const MESES: [&str; 12] = [
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
];

/// "2026-10-22 14:05:33" -> "22/10/2026 às 14:05"
fn gerado_em(texto: &str) -> String {
    let (data, hora) = texto.split_once(' ').unwrap_or((texto, ""));
    match NaiveDate::parse_from_str(data, "%Y-%m-%d") {
        Ok(d) if hora.get(..5).is_some() => format!(
            "{} às {}",
            d.format("%d/%m/%Y"),
            hora.get(..5).unwrap_or_default()
        ),
        Ok(d) => d.format("%d/%m/%Y").to_string(),
        Err(_) => texto.to_string(),
    }
}

pub(crate) fn montar(
    cliente: &str,
    agenda: &AgendaMesDto,
    funcionarios: &[FuncionarioRow],
) -> Resultado<EscalaParaExportar> {
    let (inicio, fim) =
        limites_do_mes(agenda.ano, agenda.mes).ok_or_else(|| ErroApp::validacao("mês inválido"))?;
    let dias: Vec<NaiveDate> = inicio.iter_days().take_while(|d| *d <= fim).collect();
    let turnos: HashMap<i64, &crate::dto::TurnoDto> =
        agenda.turnos.iter().map(|t| (t.id, t)).collect();
    let cadastro: HashMap<i64, &FuncionarioRow> = funcionarios.iter().map(|f| (f.id, f)).collect();

    let mut por_dia: HashMap<(i64, NaiveDate), &crate::dto::AlocacaoDto> = HashMap::new();
    for a in &agenda.alocacoes {
        por_dia.insert((a.funcionario_id, a.data), a);
    }

    let mut pessoas: Vec<_> = agenda.funcionarios.iter().collect();
    pessoas.sort_by(|a, b| a.nome.to_lowercase().cmp(&b.nome.to_lowercase()));

    let linhas = pessoas
        .into_iter()
        .map(|f| {
            let row = cadastro.get(&f.id);
            let celulas = dias
                .iter()
                .map(|d| match por_dia.get(&(f.id, *d)) {
                    Some(a) => {
                        let turno = turnos.get(&a.turno_id);
                        CelulaEscala::Trabalho {
                            turno: turno.map_or_else(String::new, |t| t.nome.clone()),
                            inicio: a.inicio.clone(),
                            fim: a.fim.clone(),
                            minutos: a.minutos_trabalhados,
                            cor: turno.map_or_else(|| "#64748B".to_string(), |t| t.cor.clone()),
                        }
                    }
                    None => match row
                        .and_then(|r| r.ausencias.iter().find(|x| x.inicio <= *d && *d <= x.fim))
                    {
                        Some(aus) => CelulaEscala::Ausencia {
                            motivo: aus
                                .motivo
                                .clone()
                                .or_else(|| (!aus.justificada).then(|| "Falta".to_string())),
                        },
                        None => CelulaEscala::Folga,
                    },
                })
                .collect();
            let semanas = agenda
                .semanas
                .iter()
                .map(|s| {
                    let h = s.funcionarios.iter().find(|h| h.funcionario_id == f.id);
                    HorasSemanaExportar {
                        rotulo: format!("{}–{}", s.inicio.format("%d/%m"), s.fim.format("%d/%m")),
                        minutos: h.map_or(0, |h| h.minutos),
                        limite_min: h.map_or(0, |h| h.limite_min),
                    }
                })
                .collect();
            LinhaEscalaExportar {
                matricula: f.matricula.clone(),
                nome: f.nome.clone(),
                funcao: row.and_then(|r| r.cargo.clone()),
                celulas,
                semanas,
                total_min: agenda
                    .alocacoes
                    .iter()
                    .filter(|a| a.funcionario_id == f.id)
                    .map(|a| a.minutos_trabalhados)
                    .sum(),
            }
        })
        .collect();

    let mes_nome = agenda
        .mes
        .checked_sub(1)
        .and_then(|i| MESES.get(i as usize))
        .copied()
        .unwrap_or("");
    Ok(EscalaParaExportar {
        empregador: cliente.to_string(),
        titulo: format!("Escala de {mes_nome} de {}", agenda.ano),
        regra: agenda.regra.clone(),
        dias,
        turnos: agenda
            .turnos
            .iter()
            .map(|t| TurnoExportar {
                nome: t.nome.clone(),
                inicio: t.inicio.clone(),
                fim: t.fim.clone(),
                cor: t.cor.clone(),
            })
            .collect(),
        funcionarios: linhas,
        rodape: agenda
            .gerado_em
            .as_deref()
            .map(|g| format!("Gerada em {}", gerado_em(g)))
            .unwrap_or_default(),
    })
}
