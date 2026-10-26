//! Leitura e validação das abas "Funcionarios" e "Ausencias".

use std::collections::HashMap;
use std::io::Cursor;

use calamine::{Data, Range, Reader, Xlsx};
use chrono::NaiveDate;
use escala_core::{formatar_minutos, DiasSemana, Periodo};

use crate::celula;
use crate::texto::{chave, sem_acentos};
use crate::{
    AusenciaImportada, ContextoImportacao, ErroImportacao, FuncionarioImportado, LinhaRejeitada,
    ResultadoLeitura,
};

pub const ABA_FUNCIONARIOS: &str = "Funcionarios";
pub const ABA_AUSENCIAS: &str = "Ausencias";

/// Papel de uma coluna reconhecida no cabeçalho.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Uso {
    Obrigatoria,
    Opcional,
    /// Coluna de horário: reconhecida só para o aviso único de que é ignorada
    /// (os horários vêm do funcionamento do cliente); o valor nunca é lido.
    Ignorada,
}

/// Colunas da aba de funcionários: (identificador, uso, nomes aceitos já normalizados).
const COLUNAS_FUNCIONARIOS: &[(Col, Uso, &[&str])] = &[
    (
        Col::Matricula,
        Uso::Obrigatoria,
        &["matricula", "registro", "codigo", "cracha"],
    ),
    (
        Col::Nome,
        Uso::Obrigatoria,
        &["nome", "funcionario", "colaborador", "nomecompleto"],
    ),
    (Col::Cargo, Uso::Opcional, &["cargo", "funcao"]),
    (
        Col::Preferencia,
        Uso::Opcional,
        &[
            "preferencia",
            "periodo",
            "periodopreferido",
            "preferenciadeperiodo",
        ],
    ),
    (
        Col::Carga,
        Uso::Opcional,
        &["cargasemanal", "carga", "horassemanais", "cargahoraria"],
    ),
    (Col::Turno, Uso::Ignorada, &["turno", "turnos"]),
    (
        Col::Entrada,
        Uso::Ignorada,
        &["entrada", "horaentrada", "horainicio"],
    ),
    (
        Col::Saida,
        Uso::Ignorada,
        &["saida", "horasaida", "horafim"],
    ),
    (
        Col::Intervalo,
        Uso::Ignorada,
        &["intervalomin", "intervalo", "intervalominutos", "pausa"],
    ),
    (
        Col::Dias,
        Uso::Ignorada,
        &[
            "diasdisponiveis",
            "dias",
            "disponibilidade",
            "diasdetrabalho",
        ],
    ),
];

const COLUNAS_AUSENCIAS: &[(Col, Uso, &[&str])] = &[
    (
        Col::Matricula,
        Uso::Obrigatoria,
        &["matricula", "registro", "codigo", "cracha"],
    ),
    (
        Col::Inicio,
        Uso::Obrigatoria,
        &["inicio", "datainicio", "de"],
    ),
    (Col::Fim, Uso::Opcional, &["fim", "datafim", "ate"]),
    (
        Col::Motivo,
        Uso::Opcional,
        &["motivo", "tipo", "observacao"],
    ),
    (
        Col::Justificada,
        Uso::Opcional,
        &[
            "justificada",
            "justificado",
            "abonada",
            "abonado",
            "ausenciajustificada",
        ],
    ),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Col {
    Matricula,
    Nome,
    Cargo,
    Preferencia,
    Turno,
    Entrada,
    Saida,
    Intervalo,
    Carga,
    Dias,
    Inicio,
    Fim,
    Motivo,
    Justificada,
}

impl Col {
    fn rotulo(self) -> &'static str {
        match self {
            Col::Matricula => "matricula",
            Col::Nome => "nome",
            Col::Cargo => "cargo",
            Col::Preferencia => "preferencia",
            Col::Turno => "turno",
            Col::Entrada => "entrada",
            Col::Saida => "saida",
            Col::Intervalo => "intervalo_min",
            Col::Carga => "carga_semanal",
            Col::Dias => "dias_disponiveis",
            Col::Inicio => "inicio",
            Col::Fim => "fim",
            Col::Motivo => "motivo",
            Col::Justificada => "justificada",
        }
    }
}

/// Aba já localizada: cabeçalho mapeado e linhas de dados com número da linha no Excel.
struct Aba {
    nome: String,
    colunas: HashMap<Col, usize>,
    /// Colunas de horário presentes (`Uso::Ignorada`), na ordem do cabeçalho.
    ignoradas: Vec<Col>,
    linhas: Vec<(u32, Vec<Data>)>,
}

impl Aba {
    fn celula(&self, linha: &[Data], col: Col) -> Data {
        self.colunas
            .get(&col)
            .and_then(|i| linha.get(*i))
            .cloned()
            .unwrap_or(Data::Empty)
    }
}

pub(crate) fn ler(
    bytes: Vec<u8>,
    ctx: &ContextoImportacao<'_>,
) -> Result<ResultadoLeitura, ErroImportacao> {
    let mut pasta: Xlsx<_> =
        Xlsx::new(Cursor::new(bytes)).map_err(|e| ErroImportacao::Arquivo(e.to_string()))?;
    let nomes = pasta.sheet_names();
    let nome_funcionarios = nomes
        .iter()
        .find(|n| chave(n) == chave(ABA_FUNCIONARIOS))
        .or_else(|| {
            nomes
                .iter()
                .find(|n| !matches!(chave(n).as_str(), "ausencias" | "instrucoes"))
        })
        .cloned()
        .ok_or(ErroImportacao::SemAbaDeFuncionarios)?;
    let nome_ausencias = nomes
        .iter()
        .find(|n| chave(n) == chave(ABA_AUSENCIAS))
        .cloned();

    let mut resultado = ResultadoLeitura::default();

    let intervalo = pasta
        .worksheet_range(&nome_funcionarios)
        .map_err(|e| ErroImportacao::Arquivo(e.to_string()))?;
    let aba = preparar_aba(
        &nome_funcionarios,
        &intervalo,
        COLUNAS_FUNCIONARIOS,
        &mut resultado.avisos,
    )?;
    ler_funcionarios(&aba, ctx, &mut resultado);

    if let Some(nome) = nome_ausencias {
        let intervalo = pasta
            .worksheet_range(&nome)
            .map_err(|e| ErroImportacao::Arquivo(e.to_string()))?;
        // Aba de ausências vazia (só o modelo) é ignorada sem erro.
        if intervalo
            .rows()
            .any(|l| l.iter().any(|c| !celula::vazia(c)))
        {
            let aba = preparar_aba(&nome, &intervalo, COLUNAS_AUSENCIAS, &mut resultado.avisos)?;
            ler_ausencias(&aba, &mut resultado);
        }
    }
    Ok(resultado)
}

fn preparar_aba(
    nome: &str,
    intervalo: &Range<Data>,
    esperadas: &[(Col, Uso, &[&str])],
    avisos: &mut Vec<String>,
) -> Result<Aba, ErroImportacao> {
    let linha_inicial = intervalo.start().map_or(0, |(l, _)| l);
    let mut linhas = intervalo
        .rows()
        .enumerate()
        .map(|(i, l)| {
            (
                linha_inicial + u32::try_from(i).unwrap_or(u32::MAX) + 1,
                l.to_vec(),
            )
        })
        .filter(|(_, l)| l.iter().any(|c| !celula::vazia(c)));
    let (_, cabecalho) = linhas
        .next()
        .ok_or_else(|| ErroImportacao::AbaVazia(nome.to_string()))?;

    let mut colunas = HashMap::new();
    let mut ignoradas = Vec::new();
    let mut encontradas = Vec::new();
    for (i, c) in cabecalho.iter().enumerate() {
        let Some(titulo) = celula::texto(c) else {
            continue;
        };
        encontradas.push(titulo.clone());
        let k = chave(&titulo);
        match esperadas
            .iter()
            .find(|(_, _, aliases)| aliases.contains(&k.as_str()))
        {
            // Coluna de horário: só registrada para o aviso único; repetida não avisa de novo.
            Some((col, Uso::Ignorada, _)) => {
                if !ignoradas.contains(col) {
                    ignoradas.push(*col);
                }
            }
            Some((col, _, _)) if !colunas.contains_key(col) => {
                colunas.insert(*col, i);
            }
            Some((col, _, _)) => avisos.push(format!(
                "Aba {nome}: coluna \"{titulo}\" repetida para {}; usada a primeira.",
                col.rotulo()
            )),
            None => avisos.push(format!(
                "Aba {nome}: coluna \"{titulo}\" não reconhecida e ignorada."
            )),
        }
    }
    let faltando: Vec<String> = esperadas
        .iter()
        .filter(|(col, uso, _)| *uso == Uso::Obrigatoria && !colunas.contains_key(col))
        .map(|(col, _, _)| col.rotulo().to_string())
        .collect();
    if !faltando.is_empty() {
        return Err(ErroImportacao::ColunasAusentes {
            aba: nome.to_string(),
            faltando,
            encontradas,
        });
    }
    Ok(Aba {
        nome: nome.to_string(),
        colunas,
        ignoradas,
        linhas: linhas.collect(),
    })
}

fn ler_funcionarios(aba: &Aba, ctx: &ContextoImportacao<'_>, resultado: &mut ResultadoLeitura) {
    if !aba.ignoradas.is_empty() {
        let lista: Vec<&str> = aba.ignoradas.iter().map(|c| c.rotulo()).collect();
        resultado.avisos.push(format!(
            "colunas de horário ignoradas ({}): os horários vêm do funcionamento do cliente",
            lista.join(", ")
        ));
    }
    let mut primeira_linha: HashMap<String, u32> = HashMap::new();
    for (linha, celulas) in &aba.linhas {
        resultado.total_linhas += 1;
        let mut erros = Vec::new();
        let matricula = obrigatorio(aba, celulas, Col::Matricula, &mut erros);
        let nome = obrigatorio(aba, celulas, Col::Nome, &mut erros);
        let cargo = celula::texto(&aba.celula(celulas, Col::Cargo));

        if let Some(m) = &matricula {
            if let Some(anterior) = primeira_linha.get(m) {
                erros.push(format!(
                    "matrícula {m} repetida (já aparece na linha {anterior})"
                ));
            }
        }

        let preferencia = preferencia_da_linha(aba, celulas, &mut erros);

        let carga = coletar(
            celula::numero(&aba.celula(celulas, Col::Carga)),
            "carga_semanal",
            &mut erros,
        )
        .and_then(|horas| {
            if horas <= 0.0 || horas > 168.0 {
                erros.push(format!(
                    "carga_semanal {horas} fora do intervalo (0 a 168 horas)"
                ));
                None
            } else {
                Some((horas * 60.0).round() as u32)
            }
        });

        if let (true, Some(m), Some(n)) = (erros.is_empty(), matricula.clone(), nome) {
            if let Some(c) = carga.filter(|c| *c > ctx.regras.carga_semanal_max_min) {
                resultado.avisos.push(format!(
                    "Linha {linha} ({m}): carga de {} acima do limite do cliente ({}); será aplicado o limite.",
                    formatar_minutos(c),
                    formatar_minutos(ctx.regras.carga_semanal_max_min)
                ));
            }
            primeira_linha.insert(m.clone(), *linha);
            resultado.funcionarios.push(FuncionarioImportado {
                linha: *linha,
                matricula: m,
                nome: n,
                cargo,
                carga_semanal_min: carga,
                preferencia,
            });
        } else {
            if let Some(m) = &matricula {
                primeira_linha.entry(m.clone()).or_insert(*linha);
            }
            resultado.rejeitadas.push(LinhaRejeitada {
                aba: aba.nome.clone(),
                linha: *linha,
                matricula,
                erros,
            });
        }
    }
}

/// Preferência de período da linha: vazia = sem preferência; valor inválido rejeita a linha.
fn preferencia_da_linha(aba: &Aba, celulas: &[Data], erros: &mut Vec<String>) -> Option<Periodo> {
    let c = aba.celula(celulas, Col::Preferencia);
    if let Some(e) = celula::erro_excel(&c) {
        erros.push(format!("preferencia: {e}"));
        return None;
    }
    let t = celula::texto(&c)?;
    let periodo = Periodo::de_texto(&t);
    if periodo.is_none() {
        erros.push(format!(
            "preferencia: \"{t}\" inválida; use Manhã, Tarde ou Noite (ou deixe vazia)"
        ));
    }
    periodo
}

fn ler_ausencias(aba: &Aba, resultado: &mut ResultadoLeitura) {
    for (linha, celulas) in &aba.linhas {
        let mut erros = Vec::new();
        let matricula = obrigatorio(aba, celulas, Col::Matricula, &mut erros);
        let inicio = coletar(
            celula::data(&aba.celula(celulas, Col::Inicio)),
            "inicio",
            &mut erros,
        );
        let fim = coletar(
            celula::data(&aba.celula(celulas, Col::Fim)),
            "fim",
            &mut erros,
        );
        let motivo = celula::texto(&aba.celula(celulas, Col::Motivo));
        // Vazia = justificada (férias, atestados); a falta precisa ser marcada.
        let justificada = coletar(
            celula::sim_nao(&aba.celula(celulas, Col::Justificada)),
            "justificada",
            &mut erros,
        )
        .unwrap_or(true);
        if inicio.is_none() && !erros.iter().any(|e| e.starts_with("inicio")) {
            erros.push("inicio não informado".to_string());
        }
        let fim = fim.or(inicio);
        if let (Some(i), Some(f)) = (inicio, fim) {
            if f < i {
                erros.push(format!("fim ({}) anterior ao início ({})", br(f), br(i)));
            } else if (f - i).num_days() > 366 {
                erros.push("ausência maior que 366 dias".to_string());
            }
        }
        match (erros.is_empty(), matricula.clone(), inicio, fim) {
            (true, Some(m), Some(i), Some(f)) => resultado.ausencias.push(AusenciaImportada {
                aba: aba.nome.clone(),
                linha: *linha,
                matricula: m,
                inicio: i,
                fim: f,
                motivo,
                justificada,
            }),
            _ => resultado.rejeitadas.push(LinhaRejeitada {
                aba: aba.nome.clone(),
                linha: *linha,
                matricula,
                erros,
            }),
        }
    }
}

fn br(d: NaiveDate) -> String {
    d.format("%d/%m/%Y").to_string()
}

fn obrigatorio(aba: &Aba, celulas: &[Data], col: Col, erros: &mut Vec<String>) -> Option<String> {
    let c = aba.celula(celulas, col);
    if let Some(e) = celula::erro_excel(&c) {
        erros.push(format!("{}: {e}", col.rotulo()));
        return None;
    }
    let valor = celula::texto(&c);
    if valor.is_none() {
        erros.push(format!("{} não informado(a)", col.rotulo()));
    }
    valor
}

fn coletar<T>(valor: Result<Option<T>, String>, campo: &str, erros: &mut Vec<String>) -> Option<T> {
    valor.unwrap_or_else(|e| {
        erros.push(format!("{campo}: {e}"));
        None
    })
}

/// Dias como "seg,ter,qua", "seg-sex", "seg a sex", "segunda-feira", "todos".
pub(crate) fn interpretar_dias(texto: &str) -> Result<DiasSemana, String> {
    let normal = sem_acentos(texto)
        .replace("-feira", "")
        .replace("feira", "");
    if matches!(chave(&normal).as_str(), "todos" | "todososdias" | "") || normal.trim() == "*" {
        return Ok(DiasSemana::TODOS);
    }
    let dia = |t: &str| -> Option<u8> {
        let k = chave(t);
        let prefixo: String = k.chars().take(3).collect();
        ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]
            .iter()
            .position(|d| *d == prefixo && (k.len() == 3 || full_name_ok(&k)))
            .and_then(|p| u8::try_from(p).ok())
    };
    let mut indices = Vec::new();
    for parte in normal
        .split([',', ';', '/', ' '])
        .map(str::trim)
        .filter(|p| !p.is_empty() && *p != "a" && *p != "e")
    {
        if let Some((a, b)) = parte.split_once('-') {
            let (Some(i), Some(f)) = (dia(a), dia(b)) else {
                return Err(format!(
                    "dias_disponiveis: faixa \"{parte}\" inválida (ex.: seg-sex)"
                ));
            };
            let mut x = i;
            loop {
                indices.push(x);
                if x == f {
                    break;
                }
                x = (x + 1) % 7;
            }
        } else {
            indices.push(dia(parte).ok_or_else(|| {
                format!("dias_disponiveis: \"{parte}\" não é um dia (use seg, ter, qua, qui, sex, sab, dom)")
            })?);
        }
    }
    // Suporte a "seg a sex" (faixa escrita por extenso).
    let palavras: Vec<&str> = normal.split_whitespace().collect();
    if let [a, "a", b] = palavras.as_slice() {
        if let (Some(i), Some(f)) = (dia(a), dia(b)) {
            indices.clear();
            let mut x = i;
            loop {
                indices.push(x);
                if x == f {
                    break;
                }
                x = (x + 1) % 7;
            }
        }
    }
    let dias = DiasSemana::de_indices(indices);
    if dias.vazio() {
        return Err("dias_disponiveis: nenhum dia válido informado".to_string());
    }
    Ok(dias)
}

fn full_name_ok(k: &str) -> bool {
    matches!(
        k,
        "segunda" | "terca" | "quarta" | "quinta" | "sexta" | "sabado" | "domingo"
    )
}

#[cfg(test)]
mod testes {
    use super::*;

    #[test]
    fn dias_em_varios_formatos() {
        let idx = |t: &str| interpretar_dias(t).expect(t).indices();
        assert_eq!(idx("seg-sex"), vec![0, 1, 2, 3, 4]);
        assert_eq!(idx("seg a sex"), vec![0, 1, 2, 3, 4]);
        assert_eq!(idx("Segunda-feira, Quarta-feira"), vec![0, 2]);
        assert_eq!(idx("sáb,dom"), vec![5, 6]);
        assert_eq!(idx("sex-seg"), vec![0, 4, 5, 6]);
        assert_eq!(idx("todos"), vec![0, 1, 2, 3, 4, 5, 6]);
        assert!(interpretar_dias("seg,feriado").is_err());
        assert!(interpretar_dias("segx").is_err());
    }
}
