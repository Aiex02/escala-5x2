//! Núcleo de domínio do organizador de escalas.
//!
//! Lógica pura, sem IO, banco ou interface: tipos de domínio ([`modelo`]),
//! horários ([`hora`]), semanas de apuração ([`calendario`]), o motor de
//! distribuição ([`motor`]) e um verificador independente ([`verificacao`]).
#![forbid(unsafe_code)]
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

mod agenda;
pub mod calendario;
pub mod funcionamento;
pub mod hora;
pub mod modelo;
pub mod motor;
pub mod regime;
pub mod saldo;
pub mod verificacao;

pub use calendario::{limites_do_mes, semanas_cobrindo, Semana};
pub use funcionamento::{
    descrever_jornada, gerar_turnos, intervalo_padrao, ErroFuncionamento, JanelaDia, Periodo,
    TurnoGerado,
};
pub use hora::{formatar_minutos, ErroHora, HoraDoDia, Horario};
pub use modelo::{
    chave_funcao, Alocacao, Aviso, DiasSemana, ErroRegras, FuncaoMinima, FuncionarioId,
    FuncionarioPlano, InicioSemana, OpcaoTurno, RegrasCarga, TipoAviso, Turno, TurnoId,
};
pub use motor::{gerar_escala, EntradaPlanejamento, ErroPlanejamento, ResultadoPlanejamento};
pub use regime::{
    etapa_em, etapas_ec141, limite_do_funcionario, limites_da_semana, publicacao_ec141_padrao,
    EtapaRegime, LimitesSemana, RegimeLegal,
};
pub use saldo::{jornada_de_referencia, previsto_da_semana};
pub use verificacao::{verificar, Violacao};
