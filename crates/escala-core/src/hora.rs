//! Horários do dia e faixas de horário (entrada, saída, intervalo).

use std::fmt;
use std::str::FromStr;

use thiserror::Error;

/// Minutos em um dia.
pub const MINUTOS_DIA: u32 = 24 * 60;

/// Horário do relógio, em minutos desde a meia-noite (0..1440).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct HoraDoDia(u16);

#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum ErroHora {
    #[error("horário vazio")]
    Vazio,
    #[error("horário \"{0}\" inválido; use o formato HH:MM (ex.: 07:30)")]
    Formato(String),
    #[error("horário \"{0}\" fora do intervalo 00:00–23:59")]
    ForaDoIntervalo(String),
    #[error("entrada e saída não podem ser iguais ({0})")]
    InicioIgualFim(HoraDoDia),
    #[error("intervalo de {intervalo} min não cabe em uma jornada de {duracao} min")]
    IntervaloMaiorQueJornada { intervalo: u32, duracao: u32 },
}

impl HoraDoDia {
    pub const MEIA_NOITE: HoraDoDia = HoraDoDia(0);

    pub fn de_minutos(minutos: u32) -> Option<Self> {
        u16::try_from(minutos)
            .ok()
            .filter(|m| u32::from(*m) < MINUTOS_DIA)
            .map(HoraDoDia)
    }

    pub fn de_hm(hora: u32, minuto: u32) -> Option<Self> {
        if hora > 23 || minuto > 59 {
            return None;
        }
        Self::de_minutos(hora * 60 + minuto)
    }

    pub fn minutos(self) -> u32 {
        u32::from(self.0)
    }

    pub fn hora(self) -> u32 {
        self.minutos() / 60
    }

    pub fn minuto(self) -> u32 {
        self.minutos() % 60
    }
}

impl fmt::Display for HoraDoDia {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:02}:{:02}", self.hora(), self.minuto())
    }
}

/// Aceita `HH:MM`, `H:MM`, `HH:MM:SS` (segundos ignorados se zero), `HHhMM` e `HHh`.
impl FromStr for HoraDoDia {
    type Err = ErroHora;

    fn from_str(texto: &str) -> Result<Self, Self::Err> {
        let t = texto.trim();
        if t.is_empty() {
            return Err(ErroHora::Vazio);
        }
        let erro_formato = || ErroHora::Formato(t.to_string());
        let normalizado = t.to_ascii_lowercase().replace('h', ":");
        let (hora, resto) = normalizado.split_once(':').ok_or_else(erro_formato)?;
        let mut partes = resto.split(':');
        let minuto = partes.next().filter(|m| !m.is_empty()).unwrap_or("00");
        let segundo = partes.next().unwrap_or("00");
        if partes.next().is_some() {
            return Err(erro_formato());
        }
        let so_digitos = |s: &str, max_len: usize| {
            !s.is_empty() && s.len() <= max_len && s.bytes().all(|b| b.is_ascii_digit())
        };
        if !so_digitos(hora, 2) || !so_digitos(minuto, 2) || !so_digitos(segundo, 2) {
            return Err(erro_formato());
        }
        let h: u32 = hora.parse().map_err(|_| erro_formato())?;
        let m: u32 = minuto.parse().map_err(|_| erro_formato())?;
        let s: u32 = segundo.parse().map_err(|_| erro_formato())?;
        if s != 0 {
            return Err(erro_formato());
        }
        HoraDoDia::de_hm(h, m).ok_or_else(|| ErroHora::ForaDoIntervalo(t.to_string()))
    }
}

/// Faixa de trabalho em um dia: entrada, saída e intervalo não remunerado.
/// Se `fim <= inicio` a jornada atravessa a meia-noite e termina no dia seguinte.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Horario {
    inicio: HoraDoDia,
    fim: HoraDoDia,
    intervalo_min: u32,
}

impl Horario {
    pub fn novo(inicio: HoraDoDia, fim: HoraDoDia, intervalo_min: u32) -> Result<Self, ErroHora> {
        if inicio == fim {
            return Err(ErroHora::InicioIgualFim(inicio));
        }
        let horario = Horario {
            inicio,
            fim,
            intervalo_min,
        };
        let duracao = horario.duracao_total_min();
        if intervalo_min >= duracao {
            return Err(ErroHora::IntervaloMaiorQueJornada {
                intervalo: intervalo_min,
                duracao,
            });
        }
        Ok(horario)
    }

    pub fn inicio(&self) -> HoraDoDia {
        self.inicio
    }

    pub fn fim(&self) -> HoraDoDia {
        self.fim
    }

    pub fn intervalo_min(&self) -> u32 {
        self.intervalo_min
    }

    pub fn atravessa_meia_noite(&self) -> bool {
        self.fim <= self.inicio
    }

    /// Da entrada à saída, incluindo o intervalo.
    pub fn duracao_total_min(&self) -> u32 {
        if self.atravessa_meia_noite() {
            MINUTOS_DIA - self.inicio.minutos() + self.fim.minutos()
        } else {
            self.fim.minutos() - self.inicio.minutos()
        }
    }

    /// Tempo efetivamente trabalhado (conta para carga diária e semanal).
    pub fn minutos_trabalhados(&self) -> u32 {
        self.duracao_total_min().saturating_sub(self.intervalo_min)
    }
}

impl fmt::Display for Horario {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}–{}", self.inicio, self.fim)
    }
}

/// Formata minutos como "8h" ou "7h30".
pub fn formatar_minutos(minutos: u32) -> String {
    let (h, m) = (minutos / 60, minutos % 60);
    if m == 0 {
        format!("{h}h")
    } else {
        format!("{h}h{m:02}")
    }
}

#[cfg(test)]
mod testes {
    use super::*;

    fn h(t: &str) -> HoraDoDia {
        t.parse().expect("horário de teste válido")
    }

    #[test]
    fn interpreta_formatos_aceitos() {
        assert_eq!(h("07:30").minutos(), 450);
        assert_eq!(h("7:30").minutos(), 450);
        assert_eq!(h("07:30:00").minutos(), 450);
        assert_eq!(h("07h30").minutos(), 450);
        assert_eq!(h("22h").minutos(), 22 * 60);
        assert_eq!(h(" 00:00 ").minutos(), 0);
        assert_eq!(h("23:59").to_string(), "23:59");
    }

    #[test]
    fn rejeita_formatos_invalidos() {
        for t in [
            "", "  ", "24:00", "12:60", "abc", "7", "07:3a", "1:2:3:4", "123:00", "07:30:15",
        ] {
            assert!(t.parse::<HoraDoDia>().is_err(), "deveria rejeitar {t:?}");
        }
    }

    #[test]
    fn duracao_de_turno_noturno() {
        let noite = Horario::novo(h("22:00"), h("06:00"), 60).expect("válido");
        assert!(noite.atravessa_meia_noite());
        assert_eq!(noite.duracao_total_min(), 480);
        assert_eq!(noite.minutos_trabalhados(), 420);
    }

    #[test]
    fn valida_horario() {
        assert!(matches!(
            Horario::novo(h("08:00"), h("08:00"), 0),
            Err(ErroHora::InicioIgualFim(_))
        ));
        assert!(matches!(
            Horario::novo(h("08:00"), h("09:00"), 60),
            Err(ErroHora::IntervaloMaiorQueJornada { .. })
        ));
    }

    #[test]
    fn formata_minutos() {
        assert_eq!(formatar_minutos(480), "8h");
        assert_eq!(formatar_minutos(450), "7h30");
        assert_eq!(formatar_minutos(5), "0h05");
    }
}
