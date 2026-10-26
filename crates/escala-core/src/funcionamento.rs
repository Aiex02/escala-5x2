//! Horário de funcionamento do estabelecimento e os turnos que saem dele.
//!
//! O estabelecimento informa, por dia da semana, a abertura e o fechamento, e a
//! jornada dos funcionários (ex.: 6h com 15 min de intervalo). Abertura igual ao
//! fechamento é funcionamento de 24h. Os turnos são
//! intercalados para cobrir todo o horário aberto: o primeiro começa na
//! abertura, o último termina no fechamento e os do meio ficam espaçados por
//! igual, em múltiplos de 15 minutos.

use std::collections::BTreeMap;

use thiserror::Error;

use crate::hora::{formatar_minutos, HoraDoDia, Horario, MINUTOS_DIA};
use crate::modelo::DiasSemana;

/// Período do dia usado nas preferências dos funcionários.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Periodo {
    Manha,
    Tarde,
    Noite,
}

impl Periodo {
    /// Pela hora de início: de 5h a 12h manhã, até 18h tarde, depois (e de
    /// madrugada) noite.
    pub fn de_inicio(h: HoraDoDia) -> Periodo {
        match h.minutos() {
            m if m < 5 * 60 => Periodo::Noite,
            m if m < 12 * 60 => Periodo::Manha,
            m if m < 18 * 60 => Periodo::Tarde,
            _ => Periodo::Noite,
        }
    }

    pub fn codigo(self) -> &'static str {
        match self {
            Periodo::Manha => "manha",
            Periodo::Tarde => "tarde",
            Periodo::Noite => "noite",
        }
    }

    pub fn nome(self) -> &'static str {
        match self {
            Periodo::Manha => "Manhã",
            Periodo::Tarde => "Tarde",
            Periodo::Noite => "Noite",
        }
    }

    /// Aceita "manha", "manhã", "Tarde", "NOITE".
    pub fn de_texto(texto: &str) -> Option<Periodo> {
        let t: String = texto
            .trim()
            .to_lowercase()
            .chars()
            .map(|c| if c == 'ã' || c == 'á' { 'a' } else { c })
            .filter(|c| c.is_alphanumeric())
            .collect();
        match t.as_str() {
            "manha" | "m" => Some(Periodo::Manha),
            "tarde" | "t" => Some(Periodo::Tarde),
            "noite" | "n" => Some(Periodo::Noite),
            _ => None,
        }
    }

    /// Distância entre períodos (manhã–tarde = 1, manhã–noite = 2).
    pub fn distancia(self, outro: Periodo) -> u8 {
        (self as u8).abs_diff(outro as u8)
    }
}

/// Abertura e fechamento num dia da semana (0 = segunda ... 6 = domingo).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JanelaDia {
    pub dia: u8,
    pub abre: HoraDoDia,
    pub fecha: HoraDoDia,
}

/// Turno calculado a partir do funcionamento.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnoGerado {
    pub nome: String,
    pub horario: Horario,
    pub dias: DiasSemana,
    pub periodo: Periodo,
}

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ErroFuncionamento {
    #[error("marque ao menos um dia de funcionamento")]
    SemDias,
    #[error("dia {0} inválido (use 0 = segunda ... 6 = domingo)")]
    DiaInvalido(u8),
    #[error("a jornada deve ficar entre 1h e 12h")]
    Jornada,
    #[error("o intervalo deve ficar entre 0 e 2h")]
    Intervalo,
}

/// Minutos abertos; fechamento igual à abertura = 24h.
fn duracao(abre: HoraDoDia, fecha: HoraDoDia) -> u32 {
    if fecha > abre {
        fecha.minutos() - abre.minutos()
    } else {
        MINUTOS_DIA - abre.minutos() + fecha.minutos()
    }
}

fn somar(h: HoraDoDia, minutos: u32) -> Option<HoraDoDia> {
    HoraDoDia::de_minutos((h.minutos() + minutos) % MINUTOS_DIA)
}

/// Turnos intercalados que cobrem cada janela de funcionamento. Janelas iguais
/// em dias diferentes viram um só turno com vários dias.
pub fn gerar_turnos(
    janelas: &[JanelaDia],
    jornada_min: u32,
    intervalo_min: u32,
) -> Result<Vec<TurnoGerado>, ErroFuncionamento> {
    if janelas.is_empty() {
        return Err(ErroFuncionamento::SemDias);
    }
    if !(60..=12 * 60).contains(&jornada_min) {
        return Err(ErroFuncionamento::Jornada);
    }
    if intervalo_min > 120 {
        return Err(ErroFuncionamento::Intervalo);
    }
    let permanencia = jornada_min + intervalo_min;

    // (início, fim, intervalo) -> dias
    let mut turnos: BTreeMap<(HoraDoDia, HoraDoDia, u32), DiasSemana> = BTreeMap::new();
    for j in janelas {
        if j.dia > 6 {
            return Err(ErroFuncionamento::DiaInvalido(j.dia));
        }
        let aberto = duracao(j.abre, j.fecha);
        let dia = DiasSemana::de_indices([j.dia]);
        if aberto <= permanencia {
            // A janela cabe numa jornada só: um turno do abre ao fecha.
            let intervalo = if aberto > intervalo_min {
                intervalo_min
            } else {
                0
            };
            let chave = (j.abre, j.fecha, intervalo);
            let atual = turnos.entry(chave).or_insert(DiasSemana::NENHUM);
            *atual = atual.uniao(dia);
            continue;
        }
        let quantidade = aberto.div_ceil(permanencia);
        let folga = aberto - permanencia;
        for i in 0..quantidade {
            let deslocamento = if i + 1 == quantidade {
                folga
            } else {
                // Espaçamento igual, arredondado para 15 minutos.
                (folga * i / (quantidade - 1) + 7) / 15 * 15
            };
            let (Some(inicio), Some(fim)) = (
                somar(j.abre, deslocamento),
                somar(j.abre, deslocamento + permanencia),
            ) else {
                continue;
            };
            let atual = turnos
                .entry((inicio, fim, intervalo_min))
                .or_insert(DiasSemana::NENHUM);
            *atual = atual.uniao(dia);
        }
    }

    let mut gerados: Vec<TurnoGerado> = Vec::new();
    for ((inicio, fim, intervalo), dias) in turnos {
        let Ok(horario) = Horario::novo(inicio, fim, intervalo) else {
            continue;
        };
        let periodo = Periodo::de_inicio(inicio);
        gerados.push(TurnoGerado {
            nome: periodo.nome().to_string(),
            horario,
            dias,
            periodo,
        });
    }
    gerados.sort_by_key(|t| (t.horario.inicio(), t.horario.fim()));

    // Nomes repetidos ganham o início ("Manhã 10:00", "Manhã 11:30") e, se ainda
    // repetirem (mesmo início, fins diferentes), o horário inteiro.
    desempatar(&mut gerados, |t| {
        format!("{} {}", t.nome, t.horario.inicio())
    });
    desempatar(&mut gerados, |t| format!("{}–{}", t.nome, t.horario.fim()));
    Ok(gerados)
}

fn desempatar(turnos: &mut [TurnoGerado], novo_nome: impl Fn(&TurnoGerado) -> String) {
    let mut contagem: BTreeMap<String, usize> = BTreeMap::new();
    for t in turnos.iter() {
        *contagem.entry(t.nome.clone()).or_default() += 1;
    }
    for t in turnos.iter_mut() {
        if contagem.get(&t.nome).copied().unwrap_or(0) > 1 {
            t.nome = novo_nome(t);
        }
    }
}

/// Intervalo padrão da CLT (art. 71) para a jornada: até 4h nenhum, até 6h 15 min, acima 1h.
pub fn intervalo_padrao(jornada_min: u32) -> u32 {
    match jornada_min {
        m if m <= 4 * 60 => 0,
        m if m <= 6 * 60 => 15,
        _ => 60,
    }
}

/// "6h com 15 min de intervalo"
pub fn descrever_jornada(jornada_min: u32, intervalo_min: u32) -> String {
    if intervalo_min == 0 {
        formatar_minutos(jornada_min)
    } else {
        format!(
            "{} com {} min de intervalo",
            formatar_minutos(jornada_min),
            intervalo_min
        )
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn h(t: &str) -> HoraDoDia {
        t.parse().expect("hora")
    }

    fn todos(abre: &str, fecha: &str) -> Vec<JanelaDia> {
        (0..7)
            .map(|dia| JanelaDia {
                dia,
                abre: h(abre),
                fecha: h(fecha),
            })
            .collect()
    }

    #[test]
    fn loja_de_shopping_com_jornada_de_6h() {
        // 10:00–22:00 todos os dias, 6h + 15 min: abertura e fechamento intercalados.
        let t = gerar_turnos(&todos("10:00", "22:00"), 6 * 60, 15).expect("turnos");
        assert_eq!(t.len(), 2);
        assert_eq!(
            (t[0].horario.inicio(), t[0].horario.fim()),
            (h("10:00"), h("16:15"))
        );
        assert_eq!(
            (t[1].horario.inicio(), t[1].horario.fim()),
            (h("15:45"), h("22:00"))
        );
        assert_eq!(t[0].horario.minutos_trabalhados(), 360);
        assert_eq!((t[0].nome.as_str(), t[1].nome.as_str()), ("Manhã", "Tarde"));
        assert!(t.iter().all(|x| x.dias == DiasSemana::TODOS));
    }

    #[test]
    fn janela_longa_ganha_turno_intermediario() {
        // 09:00–22:00 (13h) com 6h15 de permanência: 3 turnos.
        let t = gerar_turnos(&todos("09:00", "22:00"), 6 * 60, 15).expect("turnos");
        let inicios: Vec<String> = t.iter().map(|x| x.horario.inicio().to_string()).collect();
        assert_eq!(inicios, vec!["09:00", "12:15", "15:45"]);
        assert!(t.iter().all(|x| x.horario.fim() <= h("22:00")));
        assert_eq!(t[2].horario.fim(), h("22:00"));
    }

    #[test]
    fn domingo_com_horario_menor_tem_turnos_proprios() {
        let mut j: Vec<JanelaDia> = (0..6)
            .map(|dia| JanelaDia {
                dia,
                abre: h("10:00"),
                fecha: h("22:00"),
            })
            .collect();
        j.push(JanelaDia {
            dia: 6,
            abre: h("14:00"),
            fecha: h("20:00"),
        });
        let t = gerar_turnos(&j, 6 * 60, 15).expect("turnos");
        let domingo: Vec<&TurnoGerado> = t
            .iter()
            .filter(|x| x.dias.contem(chrono::Weekday::Sun))
            .collect();
        assert_eq!(domingo.len(), 1);
        // Janela de 6h: turno do abre ao fecha, com o intervalo (5h45 trabalhadas).
        assert_eq!(
            (domingo[0].horario.inicio(), domingo[0].horario.fim()),
            (h("14:00"), h("20:00"))
        );
        assert_eq!(domingo[0].horario.minutos_trabalhados(), 345);
        // "Tarde" aparece duas vezes (15:45 e 14:00): ganham o horário no nome.
        assert!(
            t.iter().any(|x| x.nome == "Tarde 14:00") && t.iter().any(|x| x.nome == "Tarde 15:45")
        );
    }

    #[test]
    fn mesmo_inicio_com_fins_diferentes_tem_nomes_distintos() {
        // Seg–sex 10–22 e sábado 10–16: dois turnos começam às 10:00.
        let mut j: Vec<JanelaDia> = (0..5)
            .map(|dia| JanelaDia {
                dia,
                abre: h("10:00"),
                fecha: h("22:00"),
            })
            .collect();
        j.push(JanelaDia {
            dia: 5,
            abre: h("10:00"),
            fecha: h("16:00"),
        });
        let t = gerar_turnos(&j, 6 * 60, 15).expect("turnos");
        let nomes: std::collections::BTreeSet<&str> = t.iter().map(|x| x.nome.as_str()).collect();
        assert_eq!(nomes.len(), t.len(), "{nomes:?}");
        assert!(nomes.contains("Manhã 10:00–16:15") && nomes.contains("Manhã 10:00–16:00"));
    }

    #[test]
    fn periodos_e_validacoes() {
        assert_eq!(Periodo::de_inicio(h("11:59")), Periodo::Manha);
        assert_eq!(Periodo::de_inicio(h("12:00")), Periodo::Tarde);
        assert_eq!(Periodo::de_inicio(h("18:00")), Periodo::Noite);
        assert_eq!(Periodo::de_inicio(h("01:00")), Periodo::Noite);
        assert_eq!(Periodo::de_inicio(h("05:00")), Periodo::Manha);
        assert_eq!(Periodo::de_texto("Manhã"), Some(Periodo::Manha));
        assert_eq!(Periodo::Manha.distancia(Periodo::Noite), 2);
        assert!(gerar_turnos(&[], 360, 15).is_err());
        // Abertura igual ao fechamento: 24h, cobertas por 4 turnos de 6h15.
        let dia_todo = gerar_turnos(&todos("06:00", "06:00"), 360, 15).expect("24h");
        assert_eq!(dia_todo.len(), 4);
        assert_eq!(dia_todo[0].horario.inicio(), h("06:00"));
        assert_eq!(dia_todo[3].horario.fim(), h("06:00"));
        assert!(gerar_turnos(&todos("10:00", "22:00"), 30, 15).is_err());
        assert_eq!(intervalo_padrao(6 * 60), 15);
        assert_eq!(intervalo_padrao(8 * 60), 60);
    }
}
