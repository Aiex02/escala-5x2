//! Modelos de funcionamento prontos: horário do estabelecimento, jornada dos
//! funcionários e regras de jornada já alinhadas ao fim da escala 6x1 (EC 141/2026).
//!
//! Todos cabem na regra final da lei (40h e 2 folgas por semana): jornada × 5 dias
//! ≤ 40h, intervalo da CLT (até 4h sem intervalo; até 6h, 15 min; acima, 1h) e
//! nenhum turno mais curto que a jornada. As regras da empresa ficam no teto da CLT
//! (44h, 8h por dia, 11h entre jornadas, folga a cada 6 dias); o regime da EC 141
//! reduz para 42h e depois 40h, com 2 folgas, nas datas da lei.

use escala_core::{HoraDoDia, InicioSemana, JanelaDia, RegrasCarga};
use escala_db::Funcionamento;

use crate::erro::{ErroApp, Resultado};

/// Modelo de cliente novo.
pub const MODELO_PADRAO: &str = "shopping";

type Janela = (&'static str, &'static str);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Modelo {
    pub id: &'static str,
    pub nome: &'static str,
    /// Para quem serve, em uma frase.
    pub descricao: &'static str,
    /// Os 7 dias (0 = segunda): `Some((abre, fecha))` quando abre.
    pub dias: [Option<Janela>; 7],
    pub jornada_min: u32,
    pub intervalo_min: u32,
    /// Domingos seguidos de trabalho (0 = sem limite). No comércio, a Lei
    /// 10.101/2000 exige folga em ao menos um domingo a cada três semanas (= 2).
    pub domingos_seguidos_max: u32,
}

/// Os 7 dias com `padrao` nos `abertos` e `especiais` em dias isolados.
fn semana(abertos: &[usize], padrao: Janela, especiais: &[(usize, Janela)]) -> [Option<Janela>; 7] {
    let mut dias = [None; 7];
    for (i, dia) in dias.iter_mut().enumerate() {
        if abertos.contains(&i) {
            *dia = Some(
                especiais
                    .iter()
                    .find(|(d, _)| *d == i)
                    .map_or(padrao, |(_, j)| *j),
            );
        }
    }
    dias
}

const TODOS: &[usize] = &[0, 1, 2, 3, 4, 5, 6];
const SEG_SAB: &[usize] = &[0, 1, 2, 3, 4, 5];
const SEG_SEX: &[usize] = &[0, 1, 2, 3, 4];
const TER_DOM: &[usize] = &[1, 2, 3, 4, 5, 6];

pub fn modelos() -> Vec<Modelo> {
    vec![
        Modelo {
            id: MODELO_PADRAO,
            nome: "Shopping",
            descricao: "Lojas de shopping e galerias, abertas todos os dias.",
            dias: semana(TODOS, ("10:00", "22:00"), &[]),
            jornada_min: 6 * 60,
            intervalo_min: 15,
            domingos_seguidos_max: 2,
        },
        Modelo {
            id: "shopping-domingo-reduzido",
            nome: "Shopping com domingo reduzido",
            descricao: "Shopping que abre só à tarde aos domingos.",
            // Domingo até 20:15: o turno de 6h + 15 min só cabe inteiro em 6h15.
            dias: semana(TODOS, ("10:00", "22:00"), &[(6, ("14:00", "20:15"))]),
            jornada_min: 6 * 60,
            intervalo_min: 15,
            domingos_seguidos_max: 2,
        },
        Modelo {
            id: "comercio",
            nome: "Comércio / varejo",
            descricao: "Loja de rua, de segunda a sábado.",
            dias: semana(SEG_SAB, ("09:00", "19:00"), &[]),
            jornada_min: 8 * 60,
            intervalo_min: 60,
            domingos_seguidos_max: 0,
        },
        Modelo {
            id: "supermercado",
            nome: "Supermercado",
            descricao: "Supermercado e atacado, em horário estendido todos os dias.",
            dias: semana(TODOS, ("07:00", "22:00"), &[]),
            jornada_min: 8 * 60,
            intervalo_min: 60,
            domingos_seguidos_max: 2,
        },
        Modelo {
            id: "administrativo",
            nome: "Administrativo (CLT)",
            descricao: "Escritório em horário comercial, com 1h de almoço.",
            dias: semana(SEG_SEX, ("08:00", "17:00"), &[]),
            jornada_min: 8 * 60,
            intervalo_min: 60,
            domingos_seguidos_max: 0,
        },
        Modelo {
            id: "restaurante",
            nome: "Restaurante",
            descricao: "Restaurante com almoço e jantar; fecha às segundas.",
            dias: semana(TER_DOM, ("11:00", "23:00"), &[]),
            jornada_min: 8 * 60,
            intervalo_min: 60,
            domingos_seguidos_max: 2,
        },
        Modelo {
            id: "24-horas",
            nome: "24 horas",
            descricao: "Farmácia, posto ou hospital: abre sem parar, em três turnos de 8h.",
            dias: semana(TODOS, ("06:00", "06:00"), &[]),
            jornada_min: 8 * 60,
            intervalo_min: 60,
            // Escala de revezamento: folga em ao menos um domingo a cada 7 semanas.
            domingos_seguidos_max: 6,
        },
    ]
}

pub fn modelo(id: &str) -> Resultado<Modelo> {
    modelos()
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| ErroApp::validacao(format!("modelo de funcionamento \"{id}\" desconhecido")))
}

impl Modelo {
    /// Regras da empresa do modelo; o regime da EC 141 aplica os limites da lei.
    pub fn regras(&self) -> RegrasCarga {
        RegrasCarga {
            carga_semanal_max_min: 44 * 60,
            jornada_diaria_max_min: 8 * 60,
            descanso_entre_jornadas_min: 11 * 60,
            max_dias_consecutivos: 6,
            inicio_semana: InicioSemana::Segunda,
            folgas_semanais_min: 1,
            domingos_seguidos_max: self.domingos_seguidos_max,
        }
    }

    pub fn funcionamento(&self) -> Resultado<Funcionamento> {
        let hora = |t: &str| {
            t.parse::<HoraDoDia>()
                .map_err(|e| ErroApp::Interno(format!("modelo {}: {e}", self.id)))
        };
        let mut janelas = Vec::new();
        for (dia, janela) in self.dias.iter().enumerate() {
            if let Some((abre, fecha)) = janela {
                janelas.push(JanelaDia {
                    dia: u8::try_from(dia).unwrap_or(0),
                    abre: hora(abre)?,
                    fecha: hora(fecha)?,
                });
            }
        }
        Ok(Funcionamento {
            janelas,
            jornada_min: self.jornada_min,
            intervalo_min: self.intervalo_min,
        })
    }
}

#[cfg(test)]
mod testes {
    use super::*;
    use escala_core::gerar_turnos;

    #[test]
    fn modelos_cabem_na_regra_final_e_nao_tem_turno_curto() {
        let mut ids = std::collections::HashSet::new();
        for m in modelos() {
            assert!(ids.insert(m.id), "id repetido: {}", m.id);
            // 5 dias (2 folgas) de jornada inteira cabem nas 40h.
            assert!(m.jornada_min * 5 <= 40 * 60, "{}", m.id);
            assert!(
                m.jornada_min <= m.regras().jornada_diaria_max_min,
                "{}",
                m.id
            );
            assert_eq!(
                m.intervalo_min,
                escala_core::intervalo_padrao(m.jornada_min),
                "{}",
                m.id
            );
            let f = m.funcionamento().expect("funcionamento");
            let turnos = gerar_turnos(&f.janelas, f.jornada_min, f.intervalo_min).expect("turnos");
            assert!(!turnos.is_empty(), "{}", m.id);
            assert!(
                turnos
                    .iter()
                    .all(|t| t.horario.minutos_trabalhados() == m.jornada_min),
                "{}: turno mais curto que a jornada",
                m.id
            );
        }
        assert!(modelo(MODELO_PADRAO).is_ok());
        assert!(modelo("nao-existe").is_err());
    }
}
