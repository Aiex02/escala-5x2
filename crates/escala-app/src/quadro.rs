//! Pessoas do "Quadro de Horário de Trabalho" (art. 74 da CLT): só os dados de
//! cadastro (nome, função, seção e CTPS). Os horários do quadro não são
//! importados: os turnos saem do funcionamento do cliente.

use std::collections::HashSet;

use escala_excel::QuadroHorario;

use crate::dto::LinhaRejeitadaDto;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PessoaQuadro {
    pub linha: u32,
    /// Número da CTPS (ou o Cód. do quadro, sem CTPS).
    pub matricula: String,
    pub nome: String,
    pub funcao: Option<String>,
    pub secao: Option<String>,
    /// "número/série"
    pub ctps: Option<String>,
}

/// Pessoas do quadro com matrícula única; as sem identificação ou repetidas são rejeitadas.
pub(crate) fn pessoas(quadro: &QuadroHorario) -> (Vec<PessoaQuadro>, Vec<LinhaRejeitadaDto>) {
    let mut pessoas = Vec::new();
    let mut rejeitados = Vec::new();
    let mut vistas: HashSet<String> = HashSet::new();
    for f in &quadro.funcionarios {
        let matricula = f
            .ctps_numero
            .as_deref()
            .map(str::trim)
            .filter(|n| !n.is_empty())
            .unwrap_or(f.codigo.trim())
            .to_string();
        let erro = if matricula.is_empty() {
            Some("sem número da CTPS e sem Cód.: não há como identificar o funcionário".to_string())
        } else if !vistas.insert(matricula.clone()) {
            Some(format!("CTPS/matrícula {matricula} repetida no quadro"))
        } else {
            None
        };
        if let Some(erro) = erro {
            rejeitados.push(LinhaRejeitadaDto {
                planilha: "Quadro".into(),
                linha: f.linha,
                matricula: Some(matricula).filter(|m| !m.is_empty()),
                erros: vec![erro],
            });
            continue;
        }
        pessoas.push(PessoaQuadro {
            linha: f.linha,
            matricula,
            nome: f.nome.clone(),
            funcao: f.funcao.clone(),
            secao: f.secao.clone(),
            ctps: f.ctps_numero.as_ref().map(|n| match &f.ctps_serie {
                Some(serie) if !serie.trim().is_empty() => {
                    format!("{}/{}", n.trim(), serie.trim())
                }
                _ => n.trim().to_string(),
            }),
        });
    }
    (pessoas, rejeitados)
}
