use escala_core::ErroPlanejamento;
use escala_db::ErroBanco;
use escala_excel::ErroImportacao;
use serde::{Serialize, Serializer};
use thiserror::Error;

/// Erro devolvido à interface. Serializa como a mensagem em português.
#[derive(Debug, Error)]
pub enum ErroApp {
    #[error("{0}")]
    Validacao(String),
    #[error(transparent)]
    Banco(#[from] ErroBanco),
    #[error(transparent)]
    Importacao(#[from] ErroImportacao),
    #[error("não foi possível gerar a escala: {0}")]
    Planejamento(#[from] ErroPlanejamento),
    #[error("erro interno: {0}")]
    Interno(String),
}

impl ErroApp {
    pub(crate) fn validacao(msg: impl Into<String>) -> Self {
        ErroApp::Validacao(msg.into())
    }
}

impl Serialize for ErroApp {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Resultado<T> = Result<T, ErroApp>;
