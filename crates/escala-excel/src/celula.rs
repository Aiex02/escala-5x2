//! Conversão de células do Excel para valores do domínio.
//!
//! O Excel guarda horas e datas de várias formas: texto digitado ("07:00"),
//! fração do dia formatada como hora (0,2917), número serial de data (46082)
//! ou data/hora ISO. Todas são aceitas aqui.

use calamine::Data;
use chrono::{Days, NaiveDate};
use escala_core::HoraDoDia;

use crate::texto::sem_acentos;

/// Texto da célula, sem espaços nas pontas; `None` se vazia.
/// Números inteiros saem sem casas decimais (matrícula 1001, não "1001.0").
pub(crate) fn texto(celula: &Data) -> Option<String> {
    let t = match celula {
        Data::Empty | Data::Error(_) => return None,
        Data::String(s) | Data::DateTimeIso(s) | Data::DurationIso(s) => s.trim().to_string(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) if f.fract() == 0.0 && f.abs() < 1e15 => format!("{f:.0}"),
        Data::Float(f) => f.to_string(),
        Data::Bool(b) => if *b { "sim" } else { "não" }.to_string(),
        Data::DateTime(dt) => dt.as_f64().to_string(),
    };
    (!t.is_empty()).then_some(t)
}

pub(crate) fn vazia(celula: &Data) -> bool {
    texto(celula).is_none() && !matches!(celula, Data::Error(_))
}

/// Erro de fórmula na célula (#N/D, #VALOR!...), se houver.
pub(crate) fn erro_excel(celula: &Data) -> Option<String> {
    match celula {
        Data::Error(e) => Some(format!("célula com erro do Excel ({e})")),
        _ => None,
    }
}

fn minutos_de_fracao(fracao: f64) -> Option<HoraDoDia> {
    if !(0.0..1.0).contains(&fracao) {
        return None;
    }
    // Arredonda para o minuto mais próximo; 23:59:59,9 vira 00:00.
    let minutos = (fracao * 1440.0).round() as u32 % 1440;
    HoraDoDia::de_minutos(minutos)
}

/// Horário do dia. `Ok(None)` para célula vazia.
pub(crate) fn hora(celula: &Data) -> Result<Option<HoraDoDia>, String> {
    if let Some(e) = erro_excel(celula) {
        return Err(e);
    }
    let invalido = |v: &str| format!("horário \"{v}\" inválido; use HH:MM (ex.: 07:30)");
    match celula {
        Data::Empty => Ok(None),
        Data::String(s) if s.trim().is_empty() => Ok(None),
        Data::String(s) => s.parse::<HoraDoDia>().map(Some).map_err(|e| e.to_string()),
        Data::DateTime(dt) => {
            let fracao = dt.as_f64().rem_euclid(1.0);
            minutos_de_fracao(fracao)
                .map(Some)
                .ok_or_else(|| invalido(&dt.as_f64().to_string()))
        }
        Data::Float(f) => minutos_de_fracao(*f)
            .map(Some)
            .ok_or_else(|| invalido(&f.to_string())),
        Data::DateTimeIso(s) => {
            // "07:30:00" ou "1899-12-31T07:30:00".
            let parte = s.rsplit('T').next().unwrap_or(s);
            let hm: String = parte.chars().take(5).collect();
            hm.parse::<HoraDoDia>().map(Some).map_err(|_| invalido(s))
        }
        outro => Err(invalido(&texto(outro).unwrap_or_default())),
    }
}

/// Número decimal (aceita vírgula e sufixo "h", ex.: "37,5h"). `Ok(None)` se vazia.
pub(crate) fn numero(celula: &Data) -> Result<Option<f64>, String> {
    if let Some(e) = erro_excel(celula) {
        return Err(e);
    }
    match celula {
        Data::Empty => Ok(None),
        Data::Int(i) => Ok(Some(*i as f64)),
        Data::Float(f) => Ok(Some(*f)),
        Data::String(s) => {
            let t = s.trim().to_lowercase();
            if t.is_empty() {
                return Ok(None);
            }
            let t = t.trim_end_matches(['h', ' ']).replace(',', ".");
            t.parse::<f64>()
                .ok()
                .filter(|v| v.is_finite())
                .map(Some)
                .ok_or_else(|| format!("\"{}\" não é um número", s.trim()))
        }
        outro => Err(format!(
            "\"{}\" não é um número",
            texto(outro).unwrap_or_default()
        )),
    }
}

/// Sim/não: "sim", "s", "x", "true", "verdadeiro", "1" ou "não", "n", "false",
/// "falso", "0" (sem diferenciar maiúsculas e acentos); célula booleana do Excel
/// também vale. `Ok(None)` se vazia.
pub(crate) fn sim_nao(celula: &Data) -> Result<Option<bool>, String> {
    if let Some(e) = erro_excel(celula) {
        return Err(e);
    }
    let Some(t) = texto(celula) else {
        return Ok(None);
    };
    match sem_acentos(&t).as_str() {
        "sim" | "s" | "x" | "true" | "verdadeiro" | "1" => Ok(Some(true)),
        "nao" | "n" | "false" | "falso" | "0" => Ok(Some(false)),
        _ => Err(format!("\"{t}\" inválida; use Sim ou Não (ou deixe vazia)")),
    }
}

/// Converte um número serial de data do Excel (sistema 1900) em data.
fn data_de_serial(serial: f64) -> Option<NaiveDate> {
    // Faixa plausível: 1900 a ~2173. O dia 0 do Excel é 30/12/1899
    // (o bug do 29/02/1900 é compensado por esse deslocamento para seriais > 60).
    if !(1.0..=100_000.0).contains(&serial) {
        return None;
    }
    let base = NaiveDate::from_ymd_opt(1899, 12, 30)?;
    base.checked_add_days(Days::new(serial.floor() as u64))
}

/// Data. Aceita célula de data, serial numérico, "dd/mm/aaaa", "dd-mm-aaaa" e "aaaa-mm-dd".
pub(crate) fn data(celula: &Data) -> Result<Option<NaiveDate>, String> {
    if let Some(e) = erro_excel(celula) {
        return Err(e);
    }
    let invalida = |v: &str| format!("data \"{v}\" inválida; use dd/mm/aaaa");
    match celula {
        Data::Empty => Ok(None),
        Data::DateTime(dt) => {
            let (a, m, d, ..) = dt.to_ymd_hms_milli();
            NaiveDate::from_ymd_opt(i32::from(a), u32::from(m), u32::from(d))
                .map(Some)
                .ok_or_else(|| invalida(&dt.as_f64().to_string()))
        }
        Data::Float(f) => data_de_serial(*f)
            .map(Some)
            .ok_or_else(|| invalida(&f.to_string())),
        Data::Int(i) => data_de_serial(*i as f64)
            .map(Some)
            .ok_or_else(|| invalida(&i.to_string())),
        Data::DateTimeIso(s) => {
            let dia: String = s.chars().take(10).collect();
            NaiveDate::parse_from_str(&dia, "%Y-%m-%d")
                .map(Some)
                .map_err(|_| invalida(s))
        }
        Data::String(s) => {
            let t = s.trim();
            if t.is_empty() {
                return Ok(None);
            }
            ["%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d", "%d.%m.%Y"]
                .iter()
                .find_map(|f| NaiveDate::parse_from_str(t, f).ok())
                .map(Some)
                .ok_or_else(|| invalida(t))
        }
        outro => Err(invalida(&texto(outro).unwrap_or_default())),
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use calamine::{ExcelDateTime, ExcelDateTimeType};

    fn dt(v: f64) -> Data {
        Data::DateTime(ExcelDateTime::new(v, ExcelDateTimeType::DateTime, false))
    }

    #[test]
    fn hora_em_varios_formatos() {
        let h = |c: Data| hora(&c).expect("ok").map(|h| h.to_string());
        assert_eq!(h(Data::String("07:30".into())), Some("07:30".into()));
        assert_eq!(h(dt(0.3125)), Some("07:30".into()));
        assert_eq!(h(dt(45000.75)), Some("18:00".into()));
        assert_eq!(h(Data::Float(0.5)), Some("12:00".into()));
        assert_eq!(
            h(Data::DateTimeIso("1899-12-31T22:00:00".into())),
            Some("22:00".into())
        );
        assert_eq!(h(Data::Empty), None);
        assert!(hora(&Data::String("7h3x".into())).is_err());
        assert!(hora(&Data::Int(7)).is_err());
        assert!(hora(&Data::Float(1.5)).is_err());
    }

    #[test]
    fn numeros_e_textos() {
        assert_eq!(numero(&Data::String("37,5h".into())), Ok(Some(37.5)));
        assert_eq!(numero(&Data::Int(40)), Ok(Some(40.0)));
        assert!(numero(&Data::String("quarenta".into())).is_err());
        assert_eq!(texto(&Data::Float(1001.0)), Some("1001".into()));
        assert_eq!(texto(&Data::String("  ".into())), None);
    }

    #[test]
    fn sim_e_nao_em_varios_formatos() {
        let s = |t: &str| sim_nao(&Data::String(t.into()));
        for sim in ["Sim", " SIM ", "s", "X", "true", "Verdadeiro", "1"] {
            assert_eq!(s(sim), Ok(Some(true)), "{sim}");
        }
        for nao in ["não", "Nao", "NÃO", "n", "False", "falso", "0"] {
            assert_eq!(s(nao), Ok(Some(false)), "{nao}");
        }
        assert_eq!(sim_nao(&Data::Bool(true)), Ok(Some(true)));
        assert_eq!(sim_nao(&Data::Bool(false)), Ok(Some(false)));
        assert_eq!(sim_nao(&Data::Float(1.0)), Ok(Some(true)));
        assert_eq!(sim_nao(&Data::Int(0)), Ok(Some(false)));
        assert_eq!(sim_nao(&Data::Empty), Ok(None));
        assert_eq!(s("  "), Ok(None));
        assert!(s("talvez").unwrap_err().contains("\"talvez\" inválida"));
        assert!(sim_nao(&Data::Float(2.0)).is_err());
        assert!(sim_nao(&Data::Float(0.5)).is_err());
    }

    #[test]
    fn datas_em_varios_formatos() {
        let esperado = NaiveDate::from_ymd_opt(2026, 3, 10);
        assert_eq!(data(&Data::String("10/03/2026".into())), Ok(esperado));
        assert_eq!(data(&Data::String("2026-03-10".into())), Ok(esperado));
        assert_eq!(data(&Data::Float(46091.0)), Ok(esperado));
        assert_eq!(data(&dt(46091.0)), Ok(esperado));
        assert!(data(&Data::String("31/02/2026".into())).is_err());
    }
}
