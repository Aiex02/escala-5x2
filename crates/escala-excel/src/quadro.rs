//! Leitura do "Quadro de Horário de Trabalho" (art. 74 da CLT): o documento que
//! as empresas já usam, geralmente exportado de PDF para Excel.
//!
//! CONTRATO (não alterar assinaturas sem combinar): ver tipos abaixo.

use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;

use calamine::{Data, Range, Reader, Xlsx};
use escala_core::{DiasSemana, HoraDoDia};

use crate::celula;
use crate::leitura::interpretar_dias;
use crate::texto::{chave, sem_acentos};
use crate::{ErroImportacao, LinhaRejeitada};

/// Formato reconhecido de uma planilha de funcionários.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FormatoPlanilha {
    /// Planilha modelo do app (aba Funcionarios com cabeçalho por coluna).
    Padrao,
    /// Quadro de Horário de Trabalho (Cód, Nome, Função, Seção, Número, Série, Ent., Intervalo, Saída, Des, Visto).
    QuadroHorario,
}

/// Uma linha de horário do quadro (a 1ª do funcionário é a principal; as demais
/// são linhas de continuação, normalmente o horário de sábado).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HorarioQuadro {
    /// Linha no Excel (1 = primeira linha da aba).
    pub linha: u32,
    pub entrada: HoraDoDia,
    pub saida: HoraDoDia,
    /// Início e fim do intervalo; `None` quando a célula está vazia ou é só o molde ": A :".
    pub intervalo: Option<(HoraDoDia, HoraDoDia)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FuncionarioQuadro {
    pub linha: u32,
    /// Coluna "Cód" (ordem no quadro).
    pub codigo: String,
    pub nome: String,
    pub funcao: Option<String>,
    pub secao: Option<String>,
    /// Número e série da CTPS, como aparecem no quadro (zeros à esquerda preservados).
    pub ctps_numero: Option<String>,
    pub ctps_serie: Option<String>,
    /// Ao menos um horário; o primeiro é o principal.
    pub horarios: Vec<HorarioQuadro>,
    /// Dias de descanso da coluna "Des" (ex.: "Dom", "Dom/Sáb"); `DiasSemana::NENHUM` se vazia.
    pub descanso: DiasSemana,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct QuadroHorario {
    /// Texto após "Empregador:" (sem o endereço).
    pub empregador: Option<String>,
    pub endereco: Option<String>,
    pub atividade: Option<String>,
    /// Linhas do bloco "Observação" (sem a palavra "Observação").
    pub observacoes: Vec<String>,
    pub funcionarios: Vec<FuncionarioQuadro>,
    pub rejeitadas: Vec<LinhaRejeitada>,
    pub avisos: Vec<String>,
    /// Linhas de funcionário encontradas (não conta continuações nem cabeçalhos).
    pub total_linhas: u32,
}

/// Linhas do topo examinadas para reconhecer um quadro.
const LINHAS_DETECCAO: usize = 10;
const MINUTOS_DIA: u32 = 24 * 60;
/// Tamanho máximo de um texto citado em mensagens de erro.
const LIMITE_RESUMO: usize = 40;

/// Colunas do quadro, na ordem fixa A..K do documento original.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum Col {
    Cod,
    Nome,
    Funcao,
    Secao,
    Numero,
    Serie,
    Entrada,
    Intervalo,
    Saida,
    Descanso,
    Visto,
}

const ORDEM_FIXA: [Col; 11] = [
    Col::Cod,
    Col::Nome,
    Col::Funcao,
    Col::Secao,
    Col::Numero,
    Col::Serie,
    Col::Entrada,
    Col::Intervalo,
    Col::Saida,
    Col::Descanso,
    Col::Visto,
];

/// Títulos aceitos por coluna, já normalizados com `texto::chave`.
const COLUNAS: &[(Col, &[&str])] = &[
    (Col::Cod, &["cod", "codigo"]),
    (
        Col::Nome,
        &[
            "nomedofuncionario",
            "nomefuncionario",
            "nome",
            "funcionario",
        ],
    ),
    (
        Col::Funcao,
        &["funcao", "nomedofuncao", "nomedafuncao", "cargo"],
    ),
    (Col::Secao, &["secao", "setor"]),
    (
        Col::Numero,
        &[
            "numero",
            "num",
            "nctps",
            "ctps",
            "numeroctps",
            "numerodactps",
        ],
    ),
    (Col::Serie, &["serie", "seriectps"]),
    (Col::Entrada, &["ent", "entrada"]),
    (Col::Intervalo, &["intervalo"]),
    (Col::Saida, &["saida"]),
    (Col::Descanso, &["des", "descanso"]),
    (Col::Visto, &["visto"]),
];

/// Colunas sem as quais não dá para ler o quadro, com o nome mostrado ao usuário.
const OBRIGATORIAS: [(Col, &str); 3] = [
    (Col::Nome, "nome do funcionário"),
    (Col::Entrada, "entrada"),
    (Col::Saida, "saída"),
];

type Mapa = HashMap<Col, usize>;

/// Linha da aba com as células posicionadas pela coluna absoluta (A = 0).
struct Linha {
    /// Número da linha no Excel (1 = primeira).
    numero: u32,
    celulas: Vec<Data>,
}

/// Descobre se a planilha é um quadro de horário ou a planilha padrão do app.
pub fn detectar_formato(bytes: &[u8]) -> Result<FormatoPlanilha, ErroImportacao> {
    let mut pasta = abrir(bytes)?;
    for nome in pasta.sheet_names() {
        let intervalo = pasta
            .worksheet_range(&nome)
            .map_err(|e| ErroImportacao::Arquivo(e.to_string()))?;
        if parece_quadro(&intervalo) {
            return Ok(FormatoPlanilha::QuadroHorario);
        }
    }
    Ok(FormatoPlanilha::Padrao)
}

pub fn ler_quadro_bytes(bytes: Vec<u8>) -> Result<QuadroHorario, ErroImportacao> {
    let mut pasta = abrir(&bytes)?;
    let nomes = pasta.sheet_names();
    // Prefere a aba que parece um quadro; senão, a primeira com conteúdo.
    let mut primeira_com_conteudo = None;
    let mut escolhida = None;
    for nome in &nomes {
        let intervalo = pasta
            .worksheet_range(nome)
            .map_err(|e| ErroImportacao::Arquivo(e.to_string()))?;
        if parece_quadro(&intervalo) {
            escolhida = Some((nome.clone(), intervalo));
            break;
        }
        if primeira_com_conteudo.is_none() && !intervalo.is_empty() {
            primeira_com_conteudo = Some((nome.clone(), intervalo));
        }
    }
    match escolhida.or(primeira_com_conteudo) {
        Some((nome, intervalo)) => ler_aba(&nome, &intervalo),
        None => Err(nomes
            .first()
            .map_or(ErroImportacao::SemAbaDeFuncionarios, |n| {
                ErroImportacao::AbaVazia(n.clone())
            })),
    }
}

pub fn ler_quadro(caminho: &Path) -> Result<QuadroHorario, ErroImportacao> {
    let extensao = caminho
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase);
    if extensao.as_deref() != Some("xlsx") {
        return Err(ErroImportacao::Extensao(caminho.display().to_string()));
    }
    let bytes = std::fs::read(caminho).map_err(|e| ErroImportacao::Leitura {
        caminho: caminho.display().to_string(),
        motivo: e.to_string(),
    })?;
    ler_quadro_bytes(bytes)
}

fn abrir(bytes: &[u8]) -> Result<Xlsx<Cursor<&[u8]>>, ErroImportacao> {
    Xlsx::new(Cursor::new(bytes)).map_err(|e| ErroImportacao::Arquivo(e.to_string()))
}

/// Alguma das primeiras linhas traz o título do quadro ou o cabeçalho das colunas.
fn parece_quadro(intervalo: &Range<Data>) -> bool {
    intervalo
        .rows()
        .take(LINHAS_DETECCAO)
        .flat_map(|linha| linha.iter().filter_map(celula::texto))
        .any(|t| {
            let n = normal(&t);
            n.contains("horario de trabalho")
                || (n.contains("nome do funcionario") && n.contains("saida"))
        })
}

fn carregar_linhas(intervalo: &Range<Data>) -> Vec<Linha> {
    let (linha_inicial, coluna_inicial) = intervalo.start().unwrap_or((0, 0));
    intervalo
        .rows()
        .enumerate()
        .map(|(i, celulas)| {
            // Preenche as colunas à esquerda do início da área usada.
            let mut todas = vec![Data::Empty; coluna_inicial as usize];
            todas.extend_from_slice(celulas);
            Linha {
                numero: linha_inicial + u32::try_from(i).unwrap_or(u32::MAX) + 1,
                celulas: todas,
            }
        })
        .collect()
}

fn ler_aba(nome: &str, intervalo: &Range<Data>) -> Result<QuadroHorario, ErroImportacao> {
    let mut leitor = Leitor::novo(nome);
    for linha in carregar_linhas(intervalo) {
        if linha.celulas.iter().all(celula::vazia) {
            continue;
        }
        if leitor.achou_cabecalho {
            leitor.processar(&linha);
        } else {
            leitor.procurar_cabecalho(&linha);
        }
    }
    leitor.concluir()
}

/// Cabeçalho incompleto mais parecido com o do quadro, para explicar o erro.
struct Candidato {
    reconhecidas: usize,
    faltando: Vec<String>,
    encontradas: Vec<String>,
}

/// Última linha de funcionário lida: as continuações pertencem a ela.
#[derive(Clone, Copy)]
enum Ultimo {
    /// Índice em `QuadroHorario::funcionarios`.
    Valido(usize),
    /// Linha do Excel do funcionário rejeitado.
    Rejeitado(u32),
}

struct Leitor<'a> {
    aba: &'a str,
    quadro: QuadroHorario,
    colunas: Mapa,
    achou_cabecalho: bool,
    candidato: Option<Candidato>,
    /// Textos da primeira linha com conteúdo, para o erro de cabeçalho ausente.
    primeira_linha: Vec<String>,
    ultimo: Option<Ultimo>,
    em_observacao: bool,
    codigos: HashMap<String, u32>,
    ctps: HashMap<(String, String), u32>,
}

impl<'a> Leitor<'a> {
    fn novo(aba: &'a str) -> Self {
        Self {
            aba,
            quadro: QuadroHorario::default(),
            colunas: Mapa::new(),
            achou_cabecalho: false,
            candidato: None,
            primeira_linha: Vec::new(),
            ultimo: None,
            em_observacao: false,
            codigos: HashMap::new(),
            ctps: HashMap::new(),
        }
    }

    fn concluir(self) -> Result<QuadroHorario, ErroImportacao> {
        if self.achou_cabecalho {
            return Ok(self.quadro);
        }
        Err(match self.candidato {
            Some(c) => ErroImportacao::ColunasAusentes {
                aba: self.aba.to_string(),
                faltando: c.faltando,
                encontradas: c.encontradas,
            },
            None => ErroImportacao::ColunasAusentes {
                aba: self.aba.to_string(),
                faltando: vec!["cabeçalho do quadro".to_string()],
                encontradas: self.primeira_linha,
            },
        })
    }

    fn cel<'l>(&self, linha: &'l Linha, col: Col) -> &'l Data {
        static VAZIA: Data = Data::Empty;
        self.colunas
            .get(&col)
            .and_then(|i| linha.celulas.get(*i))
            .unwrap_or(&VAZIA)
    }

    /// Texto da célula com os espaços repetidos colapsados (nomes, funções).
    fn texto(&self, linha: &Linha, col: Col) -> Option<String> {
        celula::texto(self.cel(linha, col))
            .map(|t| colapsar(&t))
            .filter(|t| !t.is_empty())
    }

    /// Antes do cabeçalho das colunas: junta os dados do empregador e procura o cabeçalho.
    fn procurar_cabecalho(&mut self, linha: &Linha) {
        let textos = textos_da_linha(linha);
        if self.primeira_linha.is_empty() {
            self.primeira_linha = textos.iter().map(|t| resumir(t)).collect();
        }
        for t in &textos {
            extrair_empresa(t, &mut self.quadro);
        }
        if let Some(mapa) = tipo_cabecalho(linha) {
            self.colunas = mapa;
            self.achou_cabecalho = true;
            return;
        }
        let mapa = mapa_por_nome(linha);
        if mapa.len() >= 2
            && self
                .candidato
                .as_ref()
                .is_none_or(|c| mapa.len() > c.reconhecidas)
        {
            self.candidato = Some(Candidato {
                reconhecidas: mapa.len(),
                faltando: OBRIGATORIAS
                    .iter()
                    .filter(|(col, _)| !mapa.contains_key(col))
                    .map(|(_, rotulo)| (*rotulo).to_string())
                    .collect(),
                encontradas: textos.iter().map(|t| resumir(t)).collect(),
            });
        }
    }

    fn processar(&mut self, linha: &Linha) {
        let textos = textos_da_linha(linha);
        let tem_horas = !celula::vazia(self.cel(linha, Col::Entrada))
            || !celula::vazia(self.cel(linha, Col::Saida));

        // Cabeçalho de página repetido (título, empregador, colunas): começa outra página.
        if tipo_cabecalho(linha).is_some()
            || (!tem_horas && textos.iter().any(|t| eh_titulo_ou_empregador(t)))
        {
            self.em_observacao = false;
            return;
        }
        if self.em_observacao {
            self.acrescentar_observacoes(&textos);
            return;
        }
        if !tem_horas && textos.iter().any(|t| normal(t).starts_with("observacao")) {
            self.em_observacao = true;
            self.acrescentar_observacoes(&textos);
            return;
        }

        let nome = self.texto(linha, Col::Nome);
        let cod = self.texto(linha, Col::Cod);
        match (nome.is_some(), cod.is_some(), tem_horas) {
            (true, _, _) | (false, true, true) => self.funcionario(linha, nome, cod),
            (false, false, true) => self.continuacao(linha),
            _ => {
                // Só o molde do intervalo (": A :") não conta como conteúdo.
                let col_intervalo = self.colunas.get(&Col::Intervalo).copied();
                let conteudo = linha
                    .celulas
                    .iter()
                    .enumerate()
                    .any(|(i, c)| Some(i) != col_intervalo && !celula::vazia(c))
                    || !matches!(
                        interpretar_intervalo(self.cel(linha, Col::Intervalo)),
                        Ok(None)
                    );
                if conteudo {
                    self.quadro.avisos.push(format!(
                        "Linha {}: ignorada, não parece funcionário nem horário.",
                        linha.numero
                    ));
                }
            }
        }
    }

    fn acrescentar_observacoes(&mut self, textos: &[String]) {
        for texto in textos {
            for l in texto.split(['\n', '\r']) {
                let l = colapsar(l);
                let n = normal(&l);
                let rotulo = if n.starts_with("observacoes") {
                    11
                } else if n.starts_with("observacao") {
                    10
                } else {
                    0
                };
                let l: String = l.chars().skip(rotulo).collect();
                let l = l.trim_start_matches([':', '.', '-', ' ']);
                if !l.is_empty() && !self.quadro.observacoes.iter().any(|o| o == l) {
                    self.quadro.observacoes.push(l.to_string());
                }
            }
        }
    }

    fn funcionario(&mut self, linha: &Linha, nome: Option<String>, cod: Option<String>) {
        self.quadro.total_linhas += 1;
        let numero = linha.numero;
        let mut erros = Vec::new();
        if nome.is_none() {
            erros.push("nome do funcionário não informado".to_string());
        }
        let funcao = self.texto(linha, Col::Funcao);
        let secao = self.texto(linha, Col::Secao);
        // CTPS como texto: se o Excel guardou número, os zeros à esquerda já se perderam.
        let ctps_numero = celula::texto(self.cel(linha, Col::Numero));
        let ctps_serie = celula::texto(self.cel(linha, Col::Serie));
        let horario = match ler_horario(
            numero,
            self.cel(linha, Col::Entrada),
            self.cel(linha, Col::Intervalo),
            self.cel(linha, Col::Saida),
        ) {
            Ok(h) => Some(h),
            Err(e) => {
                erros.extend(e);
                None
            }
        };

        let rotulo = nome.clone().unwrap_or_else(|| "sem nome".to_string());
        self.avisar_identificacao(numero, &rotulo, cod.as_deref(), &ctps_numero, &ctps_serie);

        let descanso = match self.texto(linha, Col::Descanso) {
            None => DiasSemana::NENHUM,
            Some(t) => interpretar_dias(&t).unwrap_or_else(|_| {
                self.quadro.avisos.push(format!(
                    "Linha {numero} ({rotulo}): descanso \"{t}\" não reconhecido; use dias como Dom ou Dom/Sáb. Ignorado."
                ));
                DiasSemana::NENHUM
            }),
        };

        let matricula = ctps_numero.clone().or_else(|| cod.clone());
        match (erros.is_empty(), nome, horario) {
            (true, Some(nome), Some(h)) => {
                self.ultimo = Some(Ultimo::Valido(self.quadro.funcionarios.len()));
                self.quadro.funcionarios.push(FuncionarioQuadro {
                    linha: numero,
                    codigo: cod.unwrap_or_default(),
                    nome,
                    funcao,
                    secao,
                    ctps_numero,
                    ctps_serie,
                    horarios: vec![h],
                    descanso,
                });
            }
            _ => {
                self.ultimo = Some(Ultimo::Rejeitado(numero));
                self.quadro.rejeitadas.push(LinhaRejeitada {
                    aba: self.aba.to_string(),
                    linha: numero,
                    matricula,
                    erros,
                });
            }
        }
    }

    /// Avisos de código e CTPS ausentes ou repetidos.
    fn avisar_identificacao(
        &mut self,
        linha: u32,
        rotulo: &str,
        cod: Option<&str>,
        ctps_numero: &Option<String>,
        ctps_serie: &Option<String>,
    ) {
        match cod {
            None => self.quadro.avisos.push(format!(
                "Linha {linha} ({rotulo}): funcionário sem código (Cód)."
            )),
            Some(c) => match self.codigos.get(c) {
                Some(anterior) => self.quadro.avisos.push(format!(
                    "Linha {linha} ({rotulo}): código {c} repetido (já aparece na linha {anterior})."
                )),
                None => {
                    self.codigos.insert(c.to_string(), linha);
                }
            },
        }
        match ctps_numero {
            None => self.quadro.avisos.push(format!(
                "Linha {linha} ({rotulo}): funcionário sem número de CTPS."
            )),
            Some(n) => {
                let chave = (n.clone(), ctps_serie.clone().unwrap_or_default());
                match self.ctps.get(&chave) {
                    Some(anterior) => self.quadro.avisos.push(format!(
                        "Linha {linha} ({rotulo}): CTPS {n} repetida (já aparece na linha {anterior})."
                    )),
                    None => {
                        self.ctps.insert(chave, linha);
                    }
                }
            }
        }
    }

    /// Linha sem código e nome, só com horário: segundo horário do funcionário anterior.
    fn continuacao(&mut self, linha: &Linha) {
        let numero = linha.numero;
        let horario = ler_horario(
            numero,
            self.cel(linha, Col::Entrada),
            self.cel(linha, Col::Intervalo),
            self.cel(linha, Col::Saida),
        );
        match self.ultimo {
            None => {
                // Mesmo sem dono, a linha é reportada (com os erros de horário, se houver).
                let mut erros = vec![
                    "horário de continuação sem funcionário antes (linha sem código e nome)"
                        .to_string(),
                ];
                if let Err(e) = horario {
                    erros.extend(e);
                }
                self.quadro.rejeitadas.push(LinhaRejeitada {
                    aba: self.aba.to_string(),
                    linha: numero,
                    matricula: None,
                    erros,
                });
            }
            Some(Ultimo::Rejeitado(dono)) => self.quadro.avisos.push(format!(
                "Linha {numero}: horário adicional ignorado porque o funcionário da linha {dono} foi rejeitado."
            )),
            Some(Ultimo::Valido(i)) => {
                let Some(dono) = self.quadro.funcionarios.get_mut(i) else {
                    return;
                };
                match horario {
                    Ok(h) => dono.horarios.push(h),
                    Err(erros) => {
                        let origem = dono.linha;
                        let matricula = dono.ctps_numero.clone().or_else(|| {
                            (!dono.codigo.is_empty()).then(|| dono.codigo.clone())
                        });
                        self.quadro.rejeitadas.push(LinhaRejeitada {
                            aba: self.aba.to_string(),
                            linha: numero,
                            matricula,
                            erros: erros
                                .into_iter()
                                .map(|e| format!("continuação do funcionário da linha {origem}: {e}"))
                                .collect(),
                        });
                    }
                }
            }
        }
    }
}

/// Cabeçalho das colunas: célula única com o texto inteiro (documento exportado de
/// PDF, ordem fixa A..K) ou células separadas, mapeadas pelo título.
fn tipo_cabecalho(linha: &Linha) -> Option<Mapa> {
    let unico = linha.celulas.iter().filter_map(celula::texto).any(|t| {
        let n = normal(&t);
        n.contains("nome do funcionario") && n.contains("saida")
    });
    if unico {
        return Some(
            ORDEM_FIXA
                .iter()
                .enumerate()
                .map(|(i, c)| (*c, i))
                .collect(),
        );
    }
    let mapa = mapa_por_nome(linha);
    OBRIGATORIAS
        .iter()
        .all(|(col, _)| mapa.contains_key(col))
        .then_some(mapa)
}

/// Colunas reconhecidas pelo título de cada célula (a primeira ocorrência vale).
fn mapa_por_nome(linha: &Linha) -> Mapa {
    let mut mapa = Mapa::new();
    for (i, c) in linha.celulas.iter().enumerate() {
        let Some(titulo) = celula::texto(c) else {
            continue;
        };
        let k = chave(&titulo);
        if let Some((col, _)) = COLUNAS
            .iter()
            .find(|(_, apelidos)| apelidos.contains(&k.as_str()))
        {
            mapa.entry(*col).or_insert(i);
        }
    }
    mapa
}

fn eh_titulo_ou_empregador(texto: &str) -> bool {
    let n = normal(texto);
    n.starts_with("horario de trabalho")
        || n.starts_with("quadro de horario")
        || n.starts_with("empregador")
}

/// Horário de uma linha (principal ou continuação) com todos os erros encontrados.
fn ler_horario(
    linha: u32,
    entrada: &Data,
    intervalo: &Data,
    saida: &Data,
) -> Result<HorarioQuadro, Vec<String>> {
    let mut erros = Vec::new();
    let entrada = hora_ou_erro(entrada, "entrada", &mut erros);
    let saida = hora_ou_erro(saida, "saída", &mut erros);
    let intervalo = interpretar_intervalo(intervalo).unwrap_or_else(|e| {
        erros.push(e);
        None
    });
    if let (Some(e), Some(s)) = (entrada, saida) {
        if e == s {
            erros.push(format!("entrada e saída não podem ser iguais ({e})"));
        } else if let Some((i, f)) = intervalo {
            if i == f {
                erros.push(format!("intervalo: início e fim iguais ({i})"));
            } else if !intervalo_cabe(e, s, i, f) {
                erros.push(format!("intervalo {i}–{f} fora da jornada {e}–{s}"));
            }
        }
    }
    match (entrada, saida) {
        (Some(entrada), Some(saida)) if erros.is_empty() => Ok(HorarioQuadro {
            linha,
            entrada,
            saida,
            intervalo,
        }),
        _ => Err(erros),
    }
}

fn hora_ou_erro(c: &Data, campo: &str, erros: &mut Vec<String>) -> Option<HoraDoDia> {
    // "09 : 00" vindo de PDF vira "09:00".
    let limpo;
    let c = if let Data::String(s) = c {
        limpo = Data::String(s.split_whitespace().collect());
        &limpo
    } else {
        c
    };
    match celula::hora(c) {
        Ok(Some(h)) => Some(h),
        Ok(None) => {
            erros.push(format!("{campo} não informada"));
            None
        }
        Err(e) => {
            erros.push(format!("{campo}: {e}"));
            None
        }
    }
}

/// Intervalo "12:00 A 14:00" (separadores "A", "às", "-", "–"...). Célula vazia ou só o
/// molde ": A :" é `Ok(None)`.
fn interpretar_intervalo(c: &Data) -> Result<Option<(HoraDoDia, HoraDoDia)>, String> {
    if let Some(e) = celula::erro_excel(c) {
        return Err(format!("intervalo: {e}"));
    }
    let Some(t) = celula::texto(c) else {
        return Ok(None);
    };
    let invalido = || {
        format!(
            "intervalo: \"{}\" inválido; use HH:MM A HH:MM (ex.: 12:00 A 13:00)",
            resumir(&t)
        )
    };
    if !t.chars().any(|ch| ch.is_ascii_digit()) {
        return match chave(&t).as_str() {
            "" | "a" | "as" | "semintervalo" => Ok(None),
            _ => Err(invalido()),
        };
    }
    let partes: Vec<&str> = t
        .split(|ch: char| !(ch.is_ascii_digit() || matches!(ch, ':' | 'h' | 'H')))
        .filter(|p| !p.is_empty())
        .collect();
    match partes.as_slice() {
        [ini, fim] => match (ini.parse::<HoraDoDia>(), fim.parse::<HoraDoDia>()) {
            (Ok(i), Ok(f)) => Ok(Some((i, f))),
            _ => Err(invalido()),
        },
        _ => Err(invalido()),
    }
}

/// O intervalo começa e termina dentro da jornada (inclusive se ela passa da meia-noite).
fn intervalo_cabe(entrada: HoraDoDia, saida: HoraDoDia, inicio: HoraDoDia, fim: HoraDoDia) -> bool {
    let apos_entrada = |h: HoraDoDia| (h.minutos() + MINUTOS_DIA - entrada.minutos()) % MINUTOS_DIA;
    let (i, f, s) = (apos_entrada(inicio), apos_entrada(fim), apos_entrada(saida));
    i < f && f <= s
}

/// Preenche empregador, endereço e atividade a partir de um texto como
/// "Empregador: X\nEndereço.: Y   Atividade.: Z". Só preenche o que ainda está vazio.
fn extrair_empresa(texto: &str, quadro: &mut QuadroHorario) {
    const ROTULOS: [&str; 3] = ["empregador", "endereco", "atividade"];
    let originais: Vec<char> = texto.chars().collect();
    let normais: Vec<char> = originais.iter().map(|c| normalizar_char(*c)).collect();

    // (início do rótulo, início do valor, índice em ROTULOS)
    let mut achados: Vec<(usize, usize, usize)> = ROTULOS
        .iter()
        .enumerate()
        .filter_map(|(k, rotulo)| {
            let r: Vec<char> = rotulo.chars().collect();
            (0..normais.len()).find_map(|i| fim_do_rotulo(&normais, i, &r).map(|v| (i, v, k)))
        })
        .collect();
    achados.sort_unstable();

    for (n, (_, valor, k)) in achados.iter().enumerate() {
        let fim = achados.get(n + 1).map_or(originais.len(), |(i, _, _)| *i);
        let valor: String = originais
            .get(*valor..fim.max(*valor))
            .map(|c| c.iter().collect())
            .unwrap_or_default();
        let valor = colapsar(&valor);
        if valor.is_empty() {
            continue;
        }
        let destino = match k {
            0 => &mut quadro.empregador,
            1 => &mut quadro.endereco,
            _ => &mut quadro.atividade,
        };
        destino.get_or_insert(valor);
    }
}

/// Se há `rotulo` + (".", espaços) + ":" a partir de `i`, devolve onde começa o valor.
fn fim_do_rotulo(normais: &[char], i: usize, rotulo: &[char]) -> Option<usize> {
    if !normais.get(i..)?.starts_with(rotulo) {
        return None;
    }
    let depois = i + rotulo.len();
    let resto = normais.get(depois..)?;
    let pulo = resto
        .iter()
        .take_while(|c| matches!(**c, '.' | ' ' | '\t'))
        .count();
    (resto.get(pulo) == Some(&':')).then_some(depois + pulo + 1)
}

fn normalizar_char(c: char) -> char {
    let mut buf = [0u8; 4];
    sem_acentos(c.encode_utf8(&mut buf))
        .chars()
        .next()
        .unwrap_or(c)
}

fn textos_da_linha(linha: &Linha) -> Vec<String> {
    linha.celulas.iter().filter_map(celula::texto).collect()
}

/// Espaços (inclusive quebras de linha) repetidos viram um só; sem espaços nas pontas.
fn colapsar(texto: &str) -> String {
    texto.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Minúsculas, sem acentos e com espaços colapsados, para procurar rótulos no texto.
fn normal(texto: &str) -> String {
    sem_acentos(&colapsar(texto))
}

/// Texto curto para citar em mensagens.
fn resumir(texto: &str) -> String {
    let t = colapsar(texto);
    if t.chars().count() <= LIMITE_RESUMO {
        return t;
    }
    let corte: String = t.chars().take(LIMITE_RESUMO).collect();
    format!("{corte}…")
}

#[cfg(test)]
mod testes {
    use super::*;

    fn empresa(texto: &str) -> QuadroHorario {
        let mut q = QuadroHorario::default();
        extrair_empresa(texto, &mut q);
        q
    }

    #[test]
    fn rotulos_da_empresa_em_varios_formatos() {
        let q = empresa(
            "EMPREGADOR :  Loja   Fictícia \n ENDEREÇO.: Rua A, 1\nAtividade.:   Serviços ",
        );
        assert_eq!(q.empregador.as_deref(), Some("Loja Fictícia"));
        assert_eq!(q.endereco.as_deref(), Some("Rua A, 1"));
        assert_eq!(q.atividade.as_deref(), Some("Serviços"));

        // Só alguns rótulos, ou rótulo sem valor.
        let q = empresa("Empregador: Loja\nAtividade.:");
        assert_eq!(q.empregador.as_deref(), Some("Loja"));
        assert_eq!(q.endereco, None);
        assert_eq!(q.atividade, None);

        // Texto sem rótulos não preenche nada; o primeiro valor achado é mantido.
        let mut q = empresa("Horário de Trabalho");
        assert_eq!(q, QuadroHorario::default());
        extrair_empresa("Empregador: Primeira", &mut q);
        extrair_empresa("Empregador: Segunda", &mut q);
        assert_eq!(q.empregador.as_deref(), Some("Primeira"));
    }

    #[test]
    fn intervalo_dentro_da_jornada() {
        let h = |h, m| HoraDoDia::de_hm(h, m).expect("hora");
        assert!(intervalo_cabe(h(9, 0), h(19, 0), h(12, 0), h(14, 0)));
        assert!(intervalo_cabe(h(9, 0), h(19, 0), h(9, 0), h(19, 0)));
        assert!(!intervalo_cabe(h(9, 0), h(19, 0), h(8, 0), h(10, 0)));
        assert!(!intervalo_cabe(h(9, 0), h(19, 0), h(18, 0), h(20, 0)));
        assert!(!intervalo_cabe(h(9, 0), h(19, 0), h(14, 0), h(12, 0)));
        // Jornada noturna.
        assert!(intervalo_cabe(h(22, 0), h(6, 0), h(23, 30), h(0, 30)));
        assert!(!intervalo_cabe(h(22, 0), h(6, 0), h(7, 0), h(8, 0)));
    }

    #[test]
    fn interpreta_intervalo() {
        let s = |t: &str| interpretar_intervalo(&Data::String(t.to_string()));
        assert_eq!(s(""), Ok(None));
        assert_eq!(s(":    A      :"), Ok(None));
        assert_eq!(s(" - "), Ok(None));
        assert_eq!(
            s("12:00 A 14:00").map(|r| r.map(|(i, f)| (i.minutos(), f.minutos()))),
            Ok(Some((720, 840)))
        );
        assert!(s("12:00 A :").is_err());
        assert!(s("12:00").is_err());
        assert!(s("12:00 A 14:00 A 15:00").is_err());
        assert!(s("almoço").is_err());
        assert!(s("25:00 A 26:00").is_err());
    }
}
