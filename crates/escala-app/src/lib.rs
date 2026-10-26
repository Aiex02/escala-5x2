//! Casos de uso do organizador de escalas.
//!
//! Orquestra as camadas sem misturá-las: lê/grava com [`escala_db`], valida
//! planilhas com [`escala_excel`] e calcula escalas com [`escala_core`]. Os
//! comandos Tauri apenas chamam [`Servico`] e devolvem os DTOs de [`dto`].
#![forbid(unsafe_code)]
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

pub mod dto;
mod erro;
mod exportar;
pub mod modelos;
mod quadro;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use chrono::Datelike;
use chrono::{Days, NaiveDate};
use escala_core::{
    chave_funcao, formatar_minutos, gerar_escala, gerar_turnos, jornada_de_referencia,
    limite_do_funcionario, limites_da_semana, limites_do_mes, previsto_da_semana,
    publicacao_ec141_padrao, semanas_cobrindo, verificar, Alocacao, Aviso, DiasSemana,
    EntradaPlanejamento, EtapaRegime, FuncaoMinima, FuncionarioPlano, HoraDoDia, Horario,
    InicioSemana, JanelaDia, LimitesSemana, OpcaoTurno, Periodo, RegimeLegal, RegrasCarga, Semana,
    TipoAviso, Turno,
};
use escala_db::{
    AcaoImportacao, Banco, ClienteId, DadosAusencia, DadosFuncionario, DadosTurno, DiaMarcado,
    Funcionamento, FuncionarioRow, TurnoRow,
};
use escala_excel::{ContextoImportacao, FormatoPlanilha, LinhaRejeitada};

pub use erro::{ErroApp, Resultado};

use dto::*;

/// Dias antes e depois do mês considerados como vizinhança (alocações fixas).
/// Cobre a semana parcial, o descanso entre jornadas e sequências de até 31 dias.
const JANELA_VIZINHOS_DIAS: u64 = 35;

/// Funcionamento de um cliente novo: o do modelo padrão (shopping, todos os dias
/// das 10h às 22h, jornada de 6h com 15 min de intervalo).
pub fn funcionamento_padrao() -> Funcionamento {
    modelos::modelo(modelos::MODELO_PADRAO)
        .and_then(|m| m.funcionamento())
        .unwrap_or(Funcionamento {
            janelas: Vec::new(),
            jornada_min: 6 * 60,
            intervalo_min: 15,
        })
}

/// Valida o funcionamento enviado pela interface contra a jornada diária máxima.
fn funcionamento_valido(
    dto: &FuncionamentoEntradaDto,
    regras: &RegrasCarga,
) -> Resultado<Funcionamento> {
    let mut janelas: Vec<JanelaDia> = Vec::new();
    for d in &dto.dias {
        if d.dia > 6 {
            return Err(ErroApp::validacao(format!(
                "dia {} inválido: use de 0 (segunda) a 6 (domingo)",
                d.dia
            )));
        }
        if janelas.iter().any(|j| j.dia == d.dia) || !d.aberto {
            continue;
        }
        janelas.push(JanelaDia {
            dia: d.dia,
            abre: hora_valida(&d.abre, "abertura")?,
            fecha: hora_valida(&d.fecha, "fechamento")?,
        });
    }
    let jornada_min = horas_para_minutos(dto.jornada_horas, "jornada")?;
    if jornada_min > regras.jornada_diaria_max_min {
        return Err(ErroApp::validacao(format!(
            "a jornada de {} passa da jornada diária máxima de {} definida nas regras",
            formatar_minutos(jornada_min),
            formatar_minutos(regras.jornada_diaria_max_min)
        )));
    }
    Ok(Funcionamento {
        janelas,
        jornada_min,
        intervalo_min: dto.intervalo_min,
    })
}

/// Valida as regras e o regime enviados pela interface.
fn regras_validas(dto: &RegrasDto) -> Resultado<(RegrasCarga, RegimeLegal)> {
    let inicio_semana = InicioSemana::de_texto(&dto.inicio_semana).ok_or_else(|| {
        ErroApp::validacao("início da semana deve ser \"segunda\" ou \"domingo\"")
    })?;
    let regras = RegrasCarga {
        carga_semanal_max_min: horas_para_minutos(dto.carga_semanal_max_horas, "carga semanal")?,
        jornada_diaria_max_min: horas_para_minutos(dto.jornada_diaria_max_horas, "jornada diária")?,
        descanso_entre_jornadas_min: horas_para_minutos(
            dto.descanso_entre_jornadas_horas,
            "descanso entre jornadas",
        )?,
        max_dias_consecutivos: dto.max_dias_consecutivos,
        inicio_semana,
        folgas_semanais_min: dto.folgas_semanais_min,
        domingos_seguidos_max: dto.domingos_seguidos_max,
    };
    regras
        .validar()
        .map_err(|e| ErroApp::validacao(e.to_string()))?;
    let regime = match dto.regime.as_str() {
        "livre" => RegimeLegal::Livre,
        "ec141" => RegimeLegal::Ec141 {
            publicacao: dto
                .ec141_publicacao
                .or_else(publicacao_ec141_padrao)
                .ok_or_else(|| ErroApp::validacao("informe a data de publicação da EC 141"))?,
        },
        outro => {
            return Err(ErroApp::validacao(format!(
                "regime \"{outro}\" desconhecido; use \"livre\" ou \"ec141\""
            )))
        }
    };
    if let RegimeLegal::Ec141 { publicacao } = regime {
        if !(2020..=2100).contains(&publicacao.year()) {
            return Err(ErroApp::validacao(
                "data de publicação da EC 141 fora do intervalo 2020–2100",
            ));
        }
    }
    Ok((regras, regime))
}

/// Regime do modelo: EC 141, mantendo a data de publicação já informada.
fn regime_do_modelo(atual: Option<&RegimeLegal>) -> RegimeLegal {
    match atual {
        Some(RegimeLegal::Ec141 { publicacao }) => RegimeLegal::Ec141 {
            publicacao: *publicacao,
        },
        _ => publicacao_ec141_padrao().map_or(RegimeLegal::Livre, |publicacao| {
            RegimeLegal::Ec141 { publicacao }
        }),
    }
}

fn modelo_dto(m: &modelos::Modelo) -> ModeloDto {
    let regime = regime_do_modelo(None);
    let funcionamento = m.funcionamento().unwrap_or(Funcionamento {
        janelas: Vec::new(),
        jornada_min: m.jornada_min,
        intervalo_min: m.intervalo_min,
    });
    let padrao = m
        .dias
        .iter()
        .flatten()
        .next()
        .copied()
        .unwrap_or(("10:00", "22:00"));
    ModeloDto {
        id: m.id.to_string(),
        nome: m.nome.to_string(),
        descricao: m.descricao.to_string(),
        dias: (0..7u8)
            .map(|dia| {
                let janela = m.dias.get(usize::from(dia)).copied().flatten();
                let (abre, fecha) = janela.unwrap_or(padrao);
                DiaFuncionamentoDto {
                    dia,
                    aberto: janela.is_some(),
                    abre: abre.to_string(),
                    fecha: fecha.to_string(),
                }
            })
            .collect(),
        jornada_horas: f64::from(m.jornada_min) / 60.0,
        intervalo_min: m.intervalo_min,
        regras: regras_dto(&m.regras(), &regime, &funcionamento),
    }
}

pub struct Servico {
    banco: Banco,
}

// ---------------------------------------------------------------------- conversões

fn hhmm(h: HoraDoDia) -> String {
    h.to_string()
}

fn turno_dto(t: &TurnoRow) -> TurnoDto {
    TurnoDto {
        id: t.turno.id,
        nome: t.turno.nome.clone(),
        inicio: hhmm(t.turno.horario.inicio()),
        fim: hhmm(t.turno.horario.fim()),
        intervalo_min: t.turno.horario.intervalo_min(),
        efetivo_minimo: t.turno.efetivo_minimo,
        ordem: t.turno.ordem,
        cor: t.cor.clone(),
        minutos_trabalhados: t.turno.horario.minutos_trabalhados(),
        dias_semana: t.turno.dias.indices(),
        periodo: Periodo::de_inicio(t.turno.horario.inicio())
            .codigo()
            .to_string(),
        arquivado: t.arquivado,
    }
}

/// Valida os dias de funcionamento enviados pela interface (0 = segunda ... 6 = domingo).
fn dias_turno_validos(indices: &[u8]) -> Resultado<DiasSemana> {
    if indices.is_empty() {
        return Err(ErroApp::validacao(
            "selecione ao menos um dia de funcionamento do turno",
        ));
    }
    if let Some(invalido) = indices.iter().find(|i| **i > 6) {
        return Err(ErroApp::validacao(format!(
            "dia de funcionamento inválido ({invalido}): use de 0 (segunda) a 6 (domingo)"
        )));
    }
    Ok(DiasSemana::de_indices(indices.iter().copied()))
}

/// "até 42h e 2 folgas por semana"
fn descrever_limites(l: &LimitesSemana) -> String {
    format!(
        "até {} e {} {} por semana",
        formatar_minutos(l.carga_max_min),
        l.folgas_min,
        if l.folgas_min == 1 { "folga" } else { "folgas" }
    )
}

fn primeira_maiuscula(texto: &str) -> String {
    let mut c = texto.chars();
    c.next()
        .map_or_else(String::new, |p| p.to_uppercase().chain(c).collect())
}

/// Fases do regime legal já combinadas com as regras da empresa.
fn fases_dto(r: &RegrasCarga, regime: &RegimeLegal) -> Vec<FaseRegimeDto> {
    let etapas = regime.etapas();
    let mut fases = Vec::with_capacity(etapas.len());
    for (i, e) in etapas.iter().enumerate() {
        let limites = LimitesSemana {
            carga_max_min: r.carga_semanal_max_min.min(e.carga_semanal_max_min),
            folgas_min: r.folgas_semanais_min.max(e.folgas_semanais_min),
        };
        fases.push(FaseRegimeDto {
            desde: (i > 0).then_some(e.vigencia),
            ate: etapas.get(i + 1).and_then(|p| p.vigencia.pred_opt()),
            carga_semanal_max_horas: f64::from(limites.carga_max_min) / 60.0,
            folgas_semanais_min: limites.folgas_min,
            descricao: primeira_maiuscula(&descrever_limites(&limites)),
        });
    }
    fases
}

fn regras_dto(r: &RegrasCarga, regime: &RegimeLegal, f: &Funcionamento) -> RegrasDto {
    RegrasDto {
        carga_semanal_max_horas: f64::from(r.carga_semanal_max_min) / 60.0,
        jornada_diaria_max_horas: f64::from(r.jornada_diaria_max_min) / 60.0,
        descanso_entre_jornadas_horas: f64::from(r.descanso_entre_jornadas_min) / 60.0,
        max_dias_consecutivos: r.max_dias_consecutivos,
        inicio_semana: r.inicio_semana.como_texto().to_string(),
        folgas_semanais_min: r.folgas_semanais_min,
        domingos_seguidos_max: r.domingos_seguidos_max,
        regime: regime.codigo().to_string(),
        ec141_publicacao: match regime {
            RegimeLegal::Ec141 { publicacao } => Some(*publicacao),
            RegimeLegal::Livre => None,
        },
        fases: fases_dto(r, regime),
        jornada_padrao_horas: f64::from(f.jornada_min) / 60.0,
        intervalo_padrao_min: f.intervalo_min,
    }
}

/// Os 7 dias para a interface. Sem funcionamento gravado (clientes antigos), o
/// horário de cada dia vem dos turnos em uso: do primeiro início ao último fim.
fn funcionamento_dto(f: &Funcionamento, turnos: &[TurnoRow]) -> Vec<DiaFuncionamentoDto> {
    (0..7u8)
        .map(|dia| {
            let janela = if f.janelas.is_empty() {
                janela_dos_turnos(dia, turnos)
            } else {
                f.janelas
                    .iter()
                    .find(|j| j.dia == dia)
                    .map(|j| (j.abre, j.fecha))
            };
            DiaFuncionamentoDto {
                dia,
                aberto: janela.is_some(),
                abre: janela.map_or_else(|| "10:00".into(), |(a, _)| hhmm(a)),
                fecha: janela.map_or_else(|| "22:00".into(), |(_, b)| hhmm(b)),
            }
        })
        .collect()
}

fn janela_dos_turnos(dia: u8, turnos: &[TurnoRow]) -> Option<(HoraDoDia, HoraDoDia)> {
    let mut janela: Option<(u32, u32)> = None;
    for t in turnos
        .iter()
        .filter(|t| !t.arquivado && t.turno.dias.indices().contains(&dia))
    {
        let inicio = t.turno.horario.inicio().minutos();
        let fim = inicio + t.turno.horario.duracao_total_min();
        janela = Some(janela.map_or((inicio, fim), |(a, b)| (a.min(inicio), b.max(fim))));
    }
    let (a, b) = janela?;
    Some((
        HoraDoDia::de_minutos(a % 1440)?,
        HoraDoDia::de_minutos(b % 1440)?,
    ))
}

/// Cor ainda não usada pelos turnos mantidos (ou a da posição, se acabarem).
fn cor_livre(usadas: &HashSet<String>, posicao: usize) -> String {
    PALETA_TURNOS
        .iter()
        .find(|c| !usadas.contains(**c))
        .copied()
        .unwrap_or(PALETA_TURNOS[posicao % PALETA_TURNOS.len()])
        .to_string()
}

/// Turnos que saem do funcionamento, reaproveitando os atuais de mesmo horário
/// (mantêm id, cor e efetivo mínimo).
fn turnos_do_funcionamento(f: &Funcionamento, atuais: &[TurnoRow]) -> Resultado<Vec<DadosTurno>> {
    let gerados = gerar_turnos(&f.janelas, f.jornada_min, f.intervalo_min)
        .map_err(|e| ErroApp::validacao(e.to_string()))?;
    let mut usados: HashSet<i64> = HashSet::new();
    let mut dados = Vec::with_capacity(gerados.len());
    for g in &gerados {
        let atual = atuais.iter().find(|t| {
            !t.arquivado && t.turno.horario == g.horario && !usados.contains(&t.turno.id)
        });
        if let Some(t) = atual {
            usados.insert(t.turno.id);
        }
        dados.push((g, atual));
    }
    let mut cores: HashSet<String> = dados
        .iter()
        .filter_map(|(_, t)| t.map(|t| t.cor.to_ascii_uppercase()))
        .collect();
    let mut turnos = Vec::with_capacity(dados.len());
    for (ordem, (g, atual)) in dados.into_iter().enumerate() {
        let cor = match atual {
            Some(t) => t.cor.clone(),
            None => {
                let c = cor_livre(&cores, ordem);
                cores.insert(c.clone());
                c
            }
        };
        turnos.push(DadosTurno {
            id: atual.map(|t| t.turno.id),
            nome: g.nome.clone(),
            horario: g.horario,
            efetivo_minimo: atual.map_or(1, |t| t.turno.efetivo_minimo),
            ordem: i32::try_from(ordem).unwrap_or(i32::MAX),
            cor,
            dias: g.dias,
        });
    }
    Ok(turnos)
}

fn periodo_dto(p: Option<Periodo>) -> Option<String> {
    p.map(|p| p.codigo().to_string())
}

fn periodo_valido(texto: Option<&str>) -> Resultado<Option<Periodo>> {
    match texto.map(str::trim).filter(|t| !t.is_empty()) {
        None => Ok(None),
        Some(t) => Periodo::de_texto(t).map(Some).ok_or_else(|| {
            ErroApp::validacao(format!(
                "preferência \"{t}\" inválida; use manha, tarde ou noite"
            ))
        }),
    }
}

/// Texto dos limites que valem nas semanas do mês (agrupando semanas iguais).
fn descrever_regra_do_mes(
    regras: &RegrasCarga,
    etapas: &[escala_core::EtapaRegime],
    semanas: &[Semana],
) -> String {
    let mut partes: Vec<(NaiveDate, LimitesSemana)> = Vec::new();
    for s in semanas {
        let l = limites_da_semana(regras, etapas, s);
        if partes.last().is_none_or(|(_, ultimo)| *ultimo != l) {
            partes.push((s.inicio, l));
        }
    }
    let textos: Vec<String> = partes
        .iter()
        .enumerate()
        .map(|(i, (inicio, l))| {
            if i == 0 {
                primeira_maiuscula(&descrever_limites(l))
            } else {
                format!(
                    "a partir da semana de {}, {}",
                    inicio.format("%d/%m"),
                    descrever_limites(l)
                )
            }
        })
        .collect();
    textos.join("; ")
}

fn horas_para_minutos(horas: f64, campo: &str) -> Resultado<u32> {
    if !horas.is_finite() || !(0.0..=10_000.0).contains(&horas) {
        return Err(ErroApp::validacao(format!(
            "{campo}: valor inválido ({horas})"
        )));
    }
    Ok((horas * 60.0).round() as u32)
}

fn aviso_dto(a: &Aviso) -> AvisoDto {
    AvisoDto {
        tipo: a.tipo.codigo().to_string(),
        data: a.data,
        turno_id: a.turno_id,
        funcionario_id: a.funcionario_id,
        mensagem: a.mensagem.clone(),
    }
}

fn mes_dto(m: &escala_db::MesRow) -> MesGeradoDto {
    MesGeradoDto {
        ano: m.ano,
        mes: m.mes,
        gerado_em: m.gerado_em.clone(),
    }
}

fn rejeitada_dto(l: LinhaRejeitada) -> LinhaRejeitadaDto {
    LinhaRejeitadaDto {
        planilha: l.aba,
        linha: l.linha,
        matricula: l.matricula,
        erros: l.erros,
    }
}

fn limites(ano: i32, mes: u32) -> Resultado<(NaiveDate, NaiveDate)> {
    if !(2000..=2100).contains(&ano) {
        return Err(ErroApp::validacao(format!(
            "ano {ano} fora do intervalo 2000–2100"
        )));
    }
    limites_do_mes(ano, mes).ok_or_else(|| ErroApp::validacao(format!("mês {mes} inválido")))
}

fn deslocar(data: NaiveDate, dias: u64, para_frente: bool) -> Resultado<NaiveDate> {
    let r = if para_frente {
        data.checked_add_days(Days::new(dias))
    } else {
        data.checked_sub_days(Days::new(dias))
    };
    r.ok_or_else(|| ErroApp::Interno(format!("data fora do calendário a partir de {data}")))
}

fn nome_valido(nome: &str, o_que: &str, max: usize) -> Resultado<String> {
    let nome = nome.trim();
    if nome.is_empty() {
        return Err(ErroApp::validacao(format!("informe o nome do {o_que}")));
    }
    if nome.chars().count() > max {
        return Err(ErroApp::validacao(format!(
            "o nome do {o_que} deve ter até {max} caracteres"
        )));
    }
    Ok(nome.to_string())
}

fn cor_valida(cor: &str) -> Resultado<String> {
    let c = cor.trim();
    let ok = c.len() == 7 && c.starts_with('#') && c[1..].bytes().all(|b| b.is_ascii_hexdigit());
    if !ok {
        return Err(ErroApp::validacao(format!(
            "cor \"{c}\" inválida; use o formato #RRGGBB"
        )));
    }
    Ok(c.to_ascii_uppercase())
}

fn hora_valida(texto: &str, campo: &str) -> Resultado<HoraDoDia> {
    texto
        .parse()
        .map_err(|e| ErroApp::validacao(format!("{campo}: {e}")))
}

/// Todos os turnos em uso, do período preferido para o mais distante.
fn opcoes(f: &FuncionarioRow, turnos: &[&Turno]) -> Vec<OpcaoTurno> {
    let mut ordenados: Vec<&Turno> = turnos.to_vec();
    ordenados.sort_by_key(|t| {
        let distancia = f
            .preferencia
            .map_or(0, |p| p.distancia(Periodo::de_inicio(t.horario.inicio())));
        (distancia, t.ordem, t.id)
    });
    ordenados
        .into_iter()
        .map(|t| OpcaoTurno {
            turno_id: t.id,
            horario: t.horario,
        })
        .collect()
}

fn plano(
    f: &FuncionarioRow,
    turnos: &[&Turno],
    janela: (NaiveDate, NaiveDate),
    saldo_anterior_min: i64,
) -> FuncionarioPlano {
    let dias = |justificada: bool| -> BTreeSet<NaiveDate> {
        f.ausencias
            .iter()
            .filter(|a| a.justificada == justificada)
            .flat_map(|a| {
                let ini = a.inicio.max(janela.0);
                let fim = a.fim.min(janela.1);
                ini.iter_days().take_while(move |d| *d <= fim)
            })
            .collect()
    };
    FuncionarioPlano {
        id: f.id,
        nome: f.nome.clone(),
        opcoes: opcoes(f, turnos),
        carga_semanal_min: f.carga_semanal_min,
        // Os dias de trabalho saem da escala; só ausências e faltas bloqueiam.
        dias_disponiveis: DiasSemana::TODOS,
        indisponivel: dias(true),
        faltas: dias(false),
        preferencia: f.preferencia,
        saldo_anterior_min,
        funcao: funcao_de(f),
    }
}

/// Chave da função do funcionário (cargo normalizado); sem cargo, nenhuma.
fn funcao_de(f: &FuncionarioRow) -> Option<String> {
    f.cargo
        .as_deref()
        .map(chave_funcao)
        .filter(|c| !c.is_empty())
}

/// Funções dos funcionários ativos, com o mínimo gravado (padrão 1) e quantas
/// pessoas cobrem esse mínimo em todos os turnos abertos da semana.
fn funcoes_dto(
    funcionarios: &[FuncionarioRow],
    gravados: &HashMap<String, u32>,
    turnos: &[TurnoRow],
    dias_de_trabalho: u32,
) -> Vec<FuncaoDto> {
    let mut grupos: BTreeMap<String, (u32, HashMap<String, u32>)> = BTreeMap::new();
    for f in funcionarios.iter().filter(|f| f.ativo) {
        let (Some(chave), Some(cargo)) = (funcao_de(f), f.cargo.as_deref()) else {
            continue;
        };
        let g = grupos.entry(chave).or_default();
        g.0 += 1;
        *g.1.entry(cargo.trim().to_string()).or_default() += 1;
    }
    // Turnos abertos na semana: soma, por dia, dos turnos que funcionam nele.
    let turnos_semana: u32 = (0..7u8)
        .map(|dia| {
            let n = turnos
                .iter()
                .filter(|t| !t.arquivado && t.turno.dias.indices().contains(&dia))
                .count();
            u32::try_from(n).unwrap_or(0)
        })
        .sum();
    grupos
        .into_iter()
        .map(|(chave, (pessoas, nomes))| {
            let nome = nomes
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
                .map_or_else(|| chave.clone(), |(n, _)| n);
            let minimo = gravados.get(&chave).copied().unwrap_or(1);
            FuncaoDto {
                pessoas_necessarias: (turnos_semana * minimo).div_ceil(dias_de_trabalho.max(1)),
                chave,
                nome,
                pessoas,
                minimo,
            }
        })
        .collect()
}

/// Dias de trabalho por semana na regra final (com a EC 141, 2 folgas).
fn dias_de_trabalho_final(regras: &RegrasCarga, regime: &RegimeLegal) -> u32 {
    let folgas = regime
        .etapas()
        .last()
        .map_or(regras.folgas_semanais_min, |e| {
            e.folgas_semanais_min.max(regras.folgas_semanais_min)
        });
    7u32.saturating_sub(folgas).max(1)
}

/// Jornada da semana pelas jornadas que a pessoa fez: a duração normal (do turno,
/// sem compensação) mais frequente; no empate, a mais longa.
fn jornada_da_semana(alocacoes: &[&Alocacao], turnos: &HashMap<i64, &Turno>) -> Option<u32> {
    let mut contagem: HashMap<u32, usize> = HashMap::new();
    for a in alocacoes {
        let minutos = turnos
            .get(&a.turno_id)
            .map_or(a.minutos_trabalhados(), |t| t.horario.minutos_trabalhados());
        *contagem.entry(minutos).or_default() += 1;
    }
    contagem
        .into_iter()
        .max_by_key(|(minutos, n)| (*n, *minutos))
        .map(|(minutos, _)| minutos)
}

/// Horas previstas da pessoa na semana, com a jornada que ela fez na semana (ou,
/// sem jornadas, a jornada de referência dos turnos atuais).
fn previsto_na_semana(
    plano: &FuncionarioPlano,
    turnos: &[Turno],
    turnos_por_id: &HashMap<i64, &Turno>,
    regras: &RegrasCarga,
    limites: &LimitesSemana,
    semana: &Semana,
    da_semana: &[&Alocacao],
) -> u32 {
    let jornada = jornada_da_semana(da_semana, turnos_por_id)
        .or_else(|| jornada_de_referencia(plano, turnos, regras.jornada_diaria_max_min))
        .unwrap_or(0);
    previsto_da_semana(plano, turnos, limites, semana, jornada)
}

impl Servico {
    pub fn novo(banco: Banco) -> Self {
        Servico { banco }
    }

    // ------------------------------------------------------------------ clientes

    pub fn listar_clientes(&self) -> Resultado<Vec<ClienteDto>> {
        Ok(self
            .banco
            .listar_clientes()?
            .into_iter()
            .map(|c| ClienteDto {
                id: c.id,
                nome: c.nome,
            })
            .collect())
    }

    /// Cria o cliente com o modelo padrão (shopping).
    pub fn criar_cliente(&mut self, nome: &str) -> Resultado<ClienteDto> {
        self.criar_cliente_com_modelo(nome, modelos::MODELO_PADRAO)
    }

    /// Cria o cliente já no regime do fim da escala 6x1 (EC 141/2026), com o
    /// horário, a jornada e as regras do modelo e os turnos gerados dele.
    pub fn criar_cliente_com_modelo(&mut self, nome: &str, modelo: &str) -> Resultado<ClienteDto> {
        let nome = nome_valido(nome, "cliente", 100)?;
        let m = modelos::modelo(modelo)?;
        let funcionamento = m.funcionamento()?;
        let turnos = turnos_do_funcionamento(&funcionamento, &[])?;
        let c = self.banco.criar_cliente(
            &nome,
            &m.regras(),
            &regime_do_modelo(None),
            &funcionamento,
            &turnos,
        )?;
        self.banco.salvar_modelo(c.id, Some(m.id))?;
        Ok(ClienteDto {
            id: c.id,
            nome: c.nome,
        })
    }

    pub fn listar_modelos(&self) -> Vec<ModeloDto> {
        modelos::modelos().iter().map(modelo_dto).collect()
    }

    pub fn renomear_cliente(&self, cliente: ClienteId, nome: &str) -> Resultado<ClienteDto> {
        let nome = nome_valido(nome, "cliente", 100)?;
        let c = self.banco.renomear_cliente(cliente, &nome)?;
        Ok(ClienteDto {
            id: c.id,
            nome: c.nome,
        })
    }

    pub fn excluir_cliente(&self, cliente: ClienteId) -> Resultado<()> {
        Ok(self.banco.excluir_cliente(cliente)?)
    }

    // ------------------------------------------------------------------ configuração

    pub fn obter_configuracao(&self, cliente: ClienteId) -> Resultado<ConfiguracaoDto> {
        let regras = self.banco.regras(cliente)?;
        let regime = self.banco.regime(cliente)?;
        let funcionamento = self.banco.funcionamento(cliente)?;
        let turnos = self.banco.turnos(cliente)?;
        let funcoes = funcoes_dto(
            &self.banco.funcionarios(cliente)?,
            &self.banco.minimos_funcao(cliente)?,
            &turnos,
            dias_de_trabalho_final(&regras, &regime),
        );
        Ok(ConfiguracaoDto {
            regras: regras_dto(&regras, &regime, &funcionamento),
            turnos: turnos
                .iter()
                .filter(|t| !t.arquivado)
                .map(turno_dto)
                .collect(),
            funcionamento: funcionamento_dto(&funcionamento, &turnos),
            modelo: self.banco.modelo(cliente)?,
            funcoes,
        })
    }

    /// Grava o mínimo de pessoas por turno de cada função.
    pub fn salvar_funcoes(
        &mut self,
        cliente: ClienteId,
        funcoes: &[FuncaoMinimoDto],
    ) -> Resultado<Vec<FuncaoDto>> {
        let mut minimos = Vec::with_capacity(funcoes.len());
        for f in funcoes {
            let chave = chave_funcao(&f.chave);
            if chave.is_empty() {
                return Err(ErroApp::validacao("função sem nome"));
            }
            if f.minimo > 20 {
                return Err(ErroApp::validacao(format!(
                    "mínimo de {} pessoas por turno: use de 0 a 20",
                    f.minimo
                )));
            }
            minimos.push((chave, f.minimo));
        }
        self.banco.salvar_minimos_funcao(cliente, &minimos)?;
        Ok(self.obter_configuracao(cliente)?.funcoes)
    }

    /// Salva a configuração inteira: com um modelo, horário, jornada e regras vêm
    /// dele (regime da EC 141, mantendo a data de publicação); personalizada, vêm
    /// do que a interface enviou. Os turnos são refeitos pelo funcionamento.
    pub fn salvar_configuracao(
        &mut self,
        cliente: ClienteId,
        dto: &ConfiguracaoEntradaDto,
    ) -> Resultado<ConfiguracaoDto> {
        let (regras, regime, funcionamento, modelo) = match dto.modelo.as_deref() {
            Some(id) => {
                let m = modelos::modelo(id)?;
                let regime = regime_do_modelo(Some(&self.banco.regime(cliente)?));
                (m.regras(), regime, m.funcionamento()?, Some(m.id))
            }
            None => {
                let regras_dto = dto.regras.as_ref().ok_or_else(|| {
                    ErroApp::validacao("informe as regras da configuração personalizada")
                })?;
                let funcionamento_dto = dto.funcionamento.as_ref().ok_or_else(|| {
                    ErroApp::validacao("informe o funcionamento da configuração personalizada")
                })?;
                let (regras, regime) = regras_validas(regras_dto)?;
                let funcionamento = funcionamento_valido(funcionamento_dto, &regras)?;
                (regras, regime, funcionamento, None)
            }
        };
        // Tudo validado antes de gravar.
        let atuais = self.banco.turnos(cliente)?;
        let turnos = turnos_do_funcionamento(&funcionamento, &atuais)?;
        self.banco.salvar_regras(cliente, &regras)?;
        self.banco.salvar_regime(cliente, &regime)?;
        self.banco
            .aplicar_funcionamento(cliente, &funcionamento, &turnos)?;
        self.banco.salvar_modelo(cliente, modelo)?;
        self.obter_configuracao(cliente)
    }

    /// Grava o horário de funcionamento e a jornada e refaz os turnos: os de mesmo
    /// horário continuam (com cor e efetivo mínimo), os novos são criados e os que
    /// saíram são arquivados (se usados em escalas) ou excluídos.
    pub fn salvar_funcionamento(
        &mut self,
        cliente: ClienteId,
        dto: &FuncionamentoEntradaDto,
    ) -> Resultado<ConfiguracaoDto> {
        let funcionamento = funcionamento_valido(dto, &self.banco.regras(cliente)?)?;
        let atuais = self.banco.turnos(cliente)?;
        let turnos = turnos_do_funcionamento(&funcionamento, &atuais)?;
        self.banco
            .aplicar_funcionamento(cliente, &funcionamento, &turnos)?;
        // Mexer no funcionamento à mão sai do modelo.
        self.banco.salvar_modelo(cliente, None)?;
        self.obter_configuracao(cliente)
    }

    pub fn salvar_regras(&self, cliente: ClienteId, dto: &RegrasDto) -> Resultado<RegrasDto> {
        let (regras, regime) = regras_validas(dto)?;
        self.banco.salvar_regras(cliente, &regras)?;
        self.banco.salvar_regime(cliente, &regime)?;
        // Mexer nas regras à mão sai do modelo.
        self.banco.salvar_modelo(cliente, None)?;
        Ok(regras_dto(
            &regras,
            &regime,
            &self.banco.funcionamento(cliente)?,
        ))
    }

    pub fn salvar_turno(&self, cliente: ClienteId, dto: &TurnoEntradaDto) -> Resultado<TurnoDto> {
        let nome = nome_valido(&dto.nome, "turno", 40)?;
        let horario = Horario::novo(
            hora_valida(&dto.inicio, "início")?,
            hora_valida(&dto.fim, "fim")?,
            dto.intervalo_min,
        )
        .map_err(|e| ErroApp::validacao(e.to_string()))?;
        if dto.efetivo_minimo > 999 {
            return Err(ErroApp::validacao("efetivo mínimo deve ser no máximo 999"));
        }
        let dias = dias_turno_validos(&dto.dias_semana)?;
        let regras = self.banco.regras(cliente)?;
        if horario.minutos_trabalhados() > regras.jornada_diaria_max_min {
            return Err(ErroApp::validacao(format!(
                "o turno soma {} trabalhadas e excede a jornada diária máxima de {}; ajuste o horário, o intervalo ou as regras",
                escala_core::formatar_minutos(horario.minutos_trabalhados()),
                escala_core::formatar_minutos(regras.jornada_diaria_max_min)
            )));
        }
        let dados = DadosTurno {
            id: dto.id,
            nome,
            horario,
            efetivo_minimo: dto.efetivo_minimo,
            ordem: dto.ordem,
            cor: cor_valida(&dto.cor)?,
            dias,
        };
        Ok(turno_dto(&self.banco.salvar_turno(cliente, &dados)?))
    }

    pub fn excluir_turno(&self, cliente: ClienteId, turno: i64) -> Resultado<()> {
        Ok(self.banco.excluir_turno(cliente, turno)?)
    }

    // ------------------------------------------------------------------ funcionários

    pub fn listar_funcionarios(&self, cliente: ClienteId) -> Resultado<Vec<FuncionarioDto>> {
        Ok(self
            .banco
            .funcionarios(cliente)?
            .into_iter()
            .map(|f| FuncionarioDto {
                id: f.id,
                matricula: f.matricula,
                nome: f.nome,
                cargo: f.cargo,
                ctps: f.ctps,
                secao: f.secao,
                carga_semanal_horas: f.carga_semanal_min.map(|m| f64::from(m) / 60.0),
                preferencia: periodo_dto(f.preferencia),
                ativo: f.ativo,
                ausencias: f
                    .ausencias
                    .into_iter()
                    .map(|a| AusenciaDto {
                        inicio: a.inicio,
                        fim: a.fim,
                        motivo: a.motivo,
                        justificada: a.justificada,
                    })
                    .collect(),
            })
            .collect())
    }

    pub fn definir_funcionario_ativo(
        &self,
        cliente: ClienteId,
        funcionario: i64,
        ativo: bool,
    ) -> Resultado<()> {
        Ok(self.banco.definir_ativo(cliente, funcionario, ativo)?)
    }

    pub fn excluir_funcionario(&self, cliente: ClienteId, funcionario: i64) -> Resultado<()> {
        Ok(self.banco.excluir_funcionario(cliente, funcionario)?)
    }

    // ------------------------------------------------------------------ importação

    /// Importa funcionários (planilha modelo do app ou Quadro de Horário; horários
    /// nunca são importados), valida contra as regras do cliente e, se `simular`
    /// for falso, grava tudo numa transação. Sempre devolve o relatório completo.
    pub fn importar_planilha(
        &mut self,
        cliente: ClienteId,
        caminho: &Path,
        simular: bool,
    ) -> Resultado<RelatorioImportacaoDto> {
        let bytes = std::fs::read(caminho).map_err(|e| escala_excel::ErroImportacao::Leitura {
            caminho: caminho.display().to_string(),
            motivo: e.to_string(),
        })?;
        let eh_xlsx = caminho
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("xlsx"));
        if eh_xlsx && escala_excel::detectar_formato(&bytes)? == FormatoPlanilha::QuadroHorario {
            return self.importar_quadro(cliente, caminho, bytes, simular);
        }
        let regras = self.banco.regras(cliente)?;
        let leitura = escala_excel::ler_planilha(caminho, &ContextoImportacao { regras: &regras })?;

        let existentes = self.banco.matriculas(cliente)?;
        let importadas: HashSet<&str> = leitura
            .funcionarios
            .iter()
            .map(|f| f.matricula.as_str())
            .collect();
        let mut rejeitados: Vec<LinhaRejeitadaDto> =
            leitura.rejeitadas.into_iter().map(rejeitada_dto).collect();
        let mut ausencias = Vec::new();
        for a in &leitura.ausencias {
            if existentes.contains(&a.matricula) || importadas.contains(a.matricula.as_str()) {
                ausencias.push(DadosAusencia {
                    matricula: a.matricula.clone(),
                    inicio: a.inicio,
                    fim: a.fim,
                    motivo: a.motivo.clone(),
                    justificada: a.justificada,
                });
            } else {
                rejeitados.push(LinhaRejeitadaDto {
                    planilha: a.aba.clone(),
                    linha: a.linha,
                    matricula: Some(a.matricula.clone()),
                    erros: vec![format!(
                        "matrícula {} não cadastrada neste cliente nem presente na planilha",
                        a.matricula
                    )],
                });
            }
        }
        rejeitados.sort_by(|a, b| (&a.planilha, a.linha).cmp(&(&b.planilha, b.linha)));

        let dados: Vec<DadosFuncionario> = leitura
            .funcionarios
            .iter()
            .map(|f| DadosFuncionario {
                matricula: f.matricula.clone(),
                nome: f.nome.clone(),
                cargo: f.cargo.clone(),
                ctps: None,
                secao: None,
                carga_semanal_min: f.carga_semanal_min,
                preferencia: f.preferencia,
            })
            .collect();

        let acoes: HashMap<String, AcaoImportacao> = if simular {
            dados
                .iter()
                .map(|f| {
                    let acao = if existentes.contains(&f.matricula) {
                        AcaoImportacao::Atualizado
                    } else {
                        AcaoImportacao::Criado
                    };
                    (f.matricula.clone(), acao)
                })
                .collect()
        } else {
            self.banco
                .gravar_importacao(cliente, &dados, &ausencias)?
                .into_iter()
                .collect()
        };

        let importados = leitura
            .funcionarios
            .iter()
            .map(|f| LinhaImportadaDto {
                linha: f.linha,
                matricula: f.matricula.clone(),
                nome: f.nome.clone(),
                acao: match acoes.get(&f.matricula) {
                    Some(AcaoImportacao::Atualizado) => "atualizado",
                    _ => "criado",
                }
                .to_string(),
            })
            .collect();

        Ok(RelatorioImportacaoDto {
            arquivo: caminho.file_name().map_or_else(
                || caminho.display().to_string(),
                |n| n.to_string_lossy().into_owned(),
            ),
            simulacao: simular,
            formato: "padrao".into(),
            empregador: None,
            total_linhas: leitura.total_linhas,
            importados,
            rejeitados,
            ausencias_importadas: u32::try_from(ausencias.len()).unwrap_or(u32::MAX),
            avisos: leitura.avisos,
        })
    }

    pub fn salvar_modelo_planilha(&self, caminho: &Path) -> Resultado<()> {
        Ok(escala_excel::salvar_modelo(caminho)?)
    }

    // ------------------------------------------------------------------ meses e agenda

    pub fn listar_meses(&self, cliente: ClienteId) -> Resultado<Vec<MesGeradoDto>> {
        Ok(self.banco.meses(cliente)?.iter().map(mes_dto).collect())
    }

    /// Monta a entrada do motor para o mês: funcionários (ativos ou todos),
    /// alocações dos meses vizinhos como fixas e as datas já planejadas.
    fn entrada_do_mes(
        &self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        so_ativos: bool,
    ) -> Resultado<(EntradaPlanejamento, Vec<TurnoRow>)> {
        let (inicio, _) = limites(ano, mes)?;
        self.entrada_do_periodo(cliente, ano, mes, inicio, so_ativos)
    }

    /// Como `entrada_do_mes`, mas o período começa em `inicio` (dentro do mês): os
    /// dias do mês antes dele entram como fixos e já planejados (reequilíbrio).
    fn entrada_do_periodo(
        &self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        inicio: NaiveDate,
        so_ativos: bool,
    ) -> Resultado<(EntradaPlanejamento, Vec<TurnoRow>)> {
        let (inicio_mes, fim) = limites(ano, mes)?;
        let inicio = inicio.clamp(inicio_mes, fim);
        let janela = (
            deslocar(inicio, JANELA_VIZINHOS_DIAS, false)?,
            deslocar(fim, JANELA_VIZINHOS_DIAS, true)?,
        );
        let regras = self.banco.regras(cliente)?;
        let etapas = self.banco.regime(cliente)?.etapas();
        let turnos = self.banco.turnos(cliente)?;
        let em_uso: Vec<&Turno> = turnos
            .iter()
            .filter(|t| !t.arquivado)
            .map(|t| &t.turno)
            .collect();
        let funcionarios_db = self.banco.funcionarios(cliente)?;
        let saldos =
            self.saldos_anteriores(cliente, inicio, &regras, &etapas, &turnos, &funcionarios_db)?;
        let minimo_por_funcao = funcoes_dto(
            &funcionarios_db,
            &self.banco.minimos_funcao(cliente)?,
            &turnos,
            1,
        )
        .into_iter()
        .filter(|f| f.minimo > 0)
        .map(|f| {
            (
                f.chave,
                FuncaoMinima {
                    nome: f.nome,
                    minimo: f.minimo,
                },
            )
        })
        .collect();
        let funcionarios = funcionarios_db
            .iter()
            .filter(|f| f.ativo || !so_ativos)
            .map(|f| plano(f, &em_uso, janela, saldos.get(&f.id).copied().unwrap_or(0)))
            .collect();

        let alocacoes_fixas = self
            .banco
            .alocacoes(cliente, janela.0, janela.1)?
            .into_iter()
            .map(|a| a.alocacao)
            .filter(|a| a.data < inicio || a.data > fim)
            .collect();
        let mut datas_planejadas: BTreeSet<NaiveDate> =
            inicio_mes.iter_days().take_while(|d| *d < inicio).collect();
        for m in self.banco.meses(cliente)? {
            if (m.ano, m.mes) == (ano, mes) {
                continue;
            }
            if let Some((mi, mf)) = limites_do_mes(m.ano, m.mes) {
                let (de, ate) = (mi.max(janela.0), mf.min(janela.1));
                datas_planejadas.extend(de.iter_days().take_while(|d| *d <= ate));
            }
        }
        let entrada = EntradaPlanejamento {
            inicio,
            fim,
            regras,
            // Arquivados ficam de fora: só existem em escalas já geradas.
            turnos: em_uso.into_iter().cloned().collect(),
            funcionarios,
            alocacoes_fixas,
            alocacoes_travadas: Vec::new(),
            datas_planejadas,
            regime: etapas,
            minimo_por_funcao,
        };
        Ok((entrada, turnos))
    }

    /// Saldo de horas de cada funcionário nas semanas fechadas antes da semana em
    /// que o mês começa: horas feitas − previstas, contando só semanas com todos os
    /// dias em meses gerados e em que a pessoa tem jornada ou falta (antes de ser
    /// contratada ou enquanto inativa, não há saldo).
    fn saldos_anteriores(
        &self,
        cliente: ClienteId,
        inicio_mes: NaiveDate,
        regras: &RegrasCarga,
        etapas: &[EtapaRegime],
        turnos: &[TurnoRow],
        funcionarios: &[FuncionarioRow],
    ) -> Resultado<HashMap<i64, i64>> {
        let mut saldos = HashMap::new();
        let meses: Vec<(NaiveDate, NaiveDate)> = self
            .banco
            .meses(cliente)?
            .iter()
            .filter_map(|m| limites_do_mes(m.ano, m.mes))
            .collect();
        let Some(primeiro) = meses.iter().map(|(i, _)| *i).min() else {
            return Ok(saldos);
        };
        let Some(semana_do_mes) = semanas_cobrindo(inicio_mes, inicio_mes, regras.inicio_semana)
            .and_then(|s| s.into_iter().next())
        else {
            return Ok(saldos);
        };
        let Some(ate) = semana_do_mes.inicio.pred_opt().filter(|a| *a >= primeiro) else {
            return Ok(saldos);
        };
        let semanas = semanas_cobrindo(primeiro, ate, regras.inicio_semana).unwrap_or_default();
        let Some(de) = semanas.first().map(|s| s.inicio) else {
            return Ok(saldos);
        };
        let planejadas: HashSet<NaiveDate> = meses
            .iter()
            .flat_map(|(i, f)| i.iter_days().take_while(move |d| d <= f))
            .collect();
        // Previsto gravado ao gerar ou ajustar cada mês: mudar carga ou regras depois
        // não reescreve o saldo de semanas passadas.
        let gravados = self.banco.previstos(cliente, de, ate)?;
        let mut por_pessoa: HashMap<i64, Vec<Alocacao>> = HashMap::new();
        for a in self.banco.alocacoes(cliente, de, ate)? {
            por_pessoa
                .entry(a.alocacao.funcionario_id)
                .or_default()
                .push(a.alocacao);
        }
        // Semanas passadas: os dias abertos vêm de todos os turnos, inclusive os
        // arquivados, que eram os do funcionamento da época.
        let todos: Vec<&Turno> = turnos.iter().map(|t| &t.turno).collect();
        let lista: Vec<Turno> = todos.iter().map(|t| (*t).clone()).collect();
        let por_id: HashMap<i64, &Turno> = todos.iter().map(|t| (t.id, *t)).collect();
        for f in funcionarios {
            let plano = plano(f, &todos, (de, ate), 0);
            let alocacoes = por_pessoa.get(&f.id).map_or(&[][..], Vec::as_slice);
            let mut saldo = 0i64;
            for s in semanas
                .iter()
                .filter(|s| s.dias().all(|d| planejadas.contains(&d)))
            {
                let da_semana: Vec<&Alocacao> =
                    alocacoes.iter().filter(|a| s.contem(a.data)).collect();
                if da_semana.is_empty() && !s.dias().any(|d| plano.faltas.contains(&d)) {
                    continue;
                }
                let previsto = gravados.get(&(f.id, s.inicio)).copied().unwrap_or_else(|| {
                    let limites = limites_da_semana(regras, etapas, s);
                    previsto_na_semana(&plano, &lista, &por_id, regras, &limites, s, &da_semana)
                });
                let feito: u32 = da_semana.iter().map(|a| a.minutos_trabalhados()).sum();
                saldo += i64::from(feito) - i64::from(previsto);
            }
            if saldo != 0 {
                saldos.insert(f.id, saldo);
            }
        }
        Ok(saldos)
    }

    /// Reequilibra o mês a partir de `a_partir`: os dias antes dele e os dias
    /// ajustados à mão no Quadro ficam como estão; o resto do mês é distribuído de
    /// novo, compensando o saldo das semanas anteriores dentro das regras. Com
    /// `seguintes`, os meses gerados depois deste também são refeitos (do dia 1,
    /// mantendo os ajustes manuais deles), para levar o saldo adiante.
    pub fn reequilibrar(
        &mut self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        a_partir: NaiveDate,
        seguintes: bool,
    ) -> Resultado<ReequilibrioDto> {
        if self.banco.mes(cliente, ano, mes)?.is_none() {
            return Err(ErroApp::validacao(
                "gere a escala deste mês antes de reequilibrar",
            ));
        }
        self.reequilibrar_mes(cliente, ano, mes, a_partir)?;
        let mut meses = vec![(ano, mes)];
        if seguintes {
            let mut posteriores: Vec<(i32, u32)> = self
                .banco
                .meses(cliente)?
                .iter()
                .map(|m| (m.ano, m.mes))
                .filter(|m| *m > (ano, mes))
                .collect();
            posteriores.sort();
            for (a, m) in posteriores {
                let (inicio, _) = limites(a, m)?;
                self.reequilibrar_mes(cliente, a, m, inicio)?;
                meses.push((a, m));
            }
        }
        let gerados = self.banco.meses(cliente)?;
        Ok(ReequilibrioDto {
            agenda: self.obter_agenda(cliente, ano, mes)?,
            meses: gerados
                .iter()
                .filter(|m| meses.contains(&(m.ano, m.mes)))
                .map(mes_dto)
                .collect(),
        })
    }

    fn reequilibrar_mes(
        &mut self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        a_partir: NaiveDate,
    ) -> Resultado<()> {
        let (inicio_mes, fim) = limites(ano, mes)?;
        let de = a_partir.clamp(inicio_mes, fim);
        let manuais = self.banco.ajustes_manuais(cliente, de, fim)?;
        let (mut entrada, _) = self.entrada_do_periodo(cliente, ano, mes, de, true)?;
        entrada.alocacoes_travadas = self
            .banco
            .alocacoes(cliente, de, fim)?
            .into_iter()
            .map(|a| a.alocacao)
            .filter(|a| manuais.contains(&(a.funcionario_id, a.data)))
            .collect();
        // Folga feita à mão: a pessoa não trabalha nesse dia, e as horas dele
        // continuam previstas (vão para os outros dias).
        for (funcionario, data) in &manuais {
            let trabalha = entrada
                .alocacoes_travadas
                .iter()
                .any(|a| a.funcionario_id == *funcionario && a.data == *data);
            if let Some(p) = entrada
                .funcionarios
                .iter_mut()
                .find(|p| p.id == *funcionario)
            {
                if !trabalha && !p.indisponivel.contains(data) {
                    p.faltas.insert(*data);
                }
            }
        }
        let resultado = gerar_escala(&entrada)?;
        // Defesa em profundidade: as jornadas novas não podem quebrar regra além do
        // que os ajustes manuais já quebram.
        let mut todas = entrada.alocacoes_travadas.clone();
        let antes = verificar(&entrada, &todas);
        todas.extend(resultado.alocacoes.iter().copied());
        if let Some(v) = verificar(&entrada, &todas)
            .into_iter()
            .find(|v| !antes.contains(v))
        {
            return Err(ErroApp::Interno(format!(
                "o reequilíbrio violou uma regra ({v}); nada foi gravado"
            )));
        }
        // Avisos: os dos dias antes do reequilíbrio continuam; os demais são os novos.
        let mut avisos: Vec<Aviso> = self
            .banco
            .avisos_do_mes(cliente, ano, mes)?
            .into_iter()
            .filter(|a| a.data.is_some_and(|d| d < de))
            .collect();
        avisos.extend(resultado.avisos);
        self.banco
            .substituir_periodo(cliente, ano, mes, de, fim, &resultado.alocacoes, &avisos)?;
        self.fixar_previstos_desde(cliente, ano, mes, de)
    }

    /// Grava o previsto das semanas fechadas do mês que terminam a partir de `de`.
    fn fixar_previstos_desde(
        &mut self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        de: NaiveDate,
    ) -> Resultado<()> {
        let agenda = self.agenda(cliente, ano, mes, true)?;
        let previstos: Vec<(i64, NaiveDate, u32)> = agenda
            .semanas
            .iter()
            .filter(|s| !s.pendente && s.fim >= de)
            .flat_map(|s| {
                s.funcionarios
                    .iter()
                    .map(move |h| (h.funcionario_id, s.inicio, h.previsto_min))
            })
            .collect();
        Ok(self.banco.gravar_previstos(cliente, &previstos)?)
    }

    /// Gera (ou regenera) a escala do mês e grava substituindo a anterior.
    pub fn gerar_mes(
        &mut self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
    ) -> Resultado<ResultadoGeracaoDto> {
        let (entrada, _) = self.entrada_do_mes(cliente, ano, mes, true)?;
        let resultado = gerar_escala(&entrada)?;
        // Defesa em profundidade: o motor nunca deveria violar regras rígidas.
        let violacoes = verificar(&entrada, &resultado.alocacoes);
        if let Some(v) = violacoes.first() {
            return Err(ErroApp::Interno(format!(
                "a escala gerada violou uma regra ({v}); nada foi gravado"
            )));
        }
        let gravado = self.banco.substituir_mes(
            cliente,
            ano,
            mes,
            entrada.inicio,
            entrada.fim,
            &resultado.alocacoes,
            &resultado.avisos,
        )?;
        self.fixar_previstos(cliente, ano, mes, None)?;
        Ok(ResultadoGeracaoDto {
            mes: mes_dto(&gravado),
            total_alocacoes: u32::try_from(resultado.alocacoes.len()).unwrap_or(u32::MAX),
            avisos: resultado.avisos.iter().map(aviso_dto).collect(),
        })
    }

    pub fn excluir_mes(&mut self, cliente: ClienteId, ano: i32, mes: u32) -> Resultado<()> {
        let (inicio, fim) = limites(ano, mes)?;
        Ok(self.banco.excluir_mes(cliente, ano, mes, inicio, fim)?)
    }

    /// Agenda do mês: alocações, resumo de horas por semana completa (somando
    /// meses vizinhos) e avisos (os da geração + violações das regras atuais).
    pub fn obter_agenda(&self, cliente: ClienteId, ano: i32, mes: u32) -> Resultado<AgendaMesDto> {
        self.agenda(cliente, ano, mes, false)
    }

    /// Grava as horas previstas das semanas fechadas do mês (ou só da semana de
    /// `data`), calculadas com as regras de agora.
    fn fixar_previstos(
        &mut self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        data: Option<NaiveDate>,
    ) -> Resultado<()> {
        let agenda = self.agenda(cliente, ano, mes, true)?;
        let previstos: Vec<(i64, NaiveDate, u32)> = agenda
            .semanas
            .iter()
            .filter(|s| !s.pendente && data.is_none_or(|d| s.inicio <= d && d <= s.fim))
            .flat_map(|s| {
                s.funcionarios
                    .iter()
                    .map(move |h| (h.funcionario_id, s.inicio, h.previsto_min))
            })
            .collect();
        Ok(self.banco.gravar_previstos(cliente, &previstos)?)
    }

    /// `recalcular`: ignora o previsto gravado das semanas fechadas e usa as regras de agora.
    fn agenda(
        &self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        recalcular: bool,
    ) -> Resultado<AgendaMesDto> {
        let (entrada, turnos) = self.entrada_do_mes(cliente, ano, mes, false)?;
        let gerado = self.banco.mes(cliente, ano, mes)?;
        let regras = entrada.regras;
        let semanas = semanas_cobrindo(entrada.inicio, entrada.fim, regras.inicio_semana)
            .ok_or_else(|| ErroApp::Interno("semanas do mês".into()))?;

        let do_mes = self.banco.alocacoes(cliente, entrada.inicio, entrada.fim)?;
        let alocacoes_mes: Vec<_> = do_mes.iter().map(|a| a.alocacao).collect();
        let mut todas = alocacoes_mes.clone();
        todas.extend(entrada.alocacoes_fixas.iter().copied());

        let funcionarios_db = self.banco.funcionarios(cliente)?;
        let alocados: HashSet<i64> = alocacoes_mes.iter().map(|a| a.funcionario_id).collect();
        let listados: Vec<&FuncionarioRow> = funcionarios_db
            .iter()
            .filter(|f| f.ativo || alocados.contains(&f.id))
            .collect();
        let planos: HashMap<i64, &FuncionarioPlano> =
            entrada.funcionarios.iter().map(|f| (f.id, f)).collect();

        let turnos_por_id: HashMap<i64, &Turno> =
            turnos.iter().map(|t| (t.turno.id, &t.turno)).collect();
        let gravados = match (recalcular, semanas.first(), semanas.last()) {
            (false, Some(a), Some(b)) => self.banco.previstos(cliente, a.inicio, b.inicio)?,
            _ => HashMap::new(),
        };
        let resumo = semanas
            .iter()
            .map(|s| {
                let limites = limites_da_semana(&regras, &entrada.regime, s);
                let pendente = s.dias().any(|d| {
                    (d < entrada.inicio || d > entrada.fim)
                        && !entrada.datas_planejadas.contains(&d)
                });
                ResumoSemanalDto {
                    inicio: s.inicio,
                    fim: s.fim,
                    pendente,
                    funcionarios: listados
                        .iter()
                        .map(|f| HorasSemanaFuncionarioDto {
                            funcionario_id: f.id,
                            minutos: todas
                                .iter()
                                .filter(|a| a.funcionario_id == f.id && s.contem(a.data))
                                .map(|a| a.minutos_trabalhados())
                                .sum(),
                            limite_min: planos.get(&f.id).map_or(limites.carga_max_min, |p| {
                                limite_do_funcionario(p, &limites)
                            }),
                            previsto_min: planos.get(&f.id).map_or(0, |p| {
                                if let Some(gravado) =
                                    gravados.get(&(f.id, s.inicio)).filter(|_| !pendente)
                                {
                                    return *gravado;
                                }
                                let da_semana: Vec<&Alocacao> = todas
                                    .iter()
                                    .filter(|a| a.funcionario_id == f.id && s.contem(a.data))
                                    .collect();
                                previsto_na_semana(
                                    p,
                                    &entrada.turnos,
                                    &turnos_por_id,
                                    &regras,
                                    &limites,
                                    s,
                                    &da_semana,
                                )
                            }),
                        })
                        .collect(),
                }
            })
            .collect();
        let regra = descrever_regra_do_mes(&regras, &entrada.regime, &semanas);

        let mut avisos: Vec<AvisoDto> = Vec::new();
        if gerado.is_some() {
            avisos.extend(
                self.banco
                    .avisos_do_mes(cliente, ano, mes)?
                    .iter()
                    .map(aviso_dto),
            );
            for v in verificar(&entrada, &alocacoes_mes) {
                avisos.push(aviso_dto(&Aviso {
                    tipo: TipoAviso::ViolacaoRegra,
                    data: Some(v.data()),
                    turno_id: None,
                    funcionario_id: None,
                    mensagem: format!("{v}. Ajuste no quadro ou gere o mês de novo."),
                }));
            }
        }

        let usados: HashSet<i64> = alocacoes_mes.iter().map(|a| a.turno_id).collect();
        let ausencias = listados
            .iter()
            .flat_map(|f| {
                f.ausencias
                    .iter()
                    .filter(|a| a.fim >= entrada.inicio && a.inicio <= entrada.fim)
                    .map(|a| AusenciaAgendaDto {
                        funcionario_id: f.id,
                        inicio: a.inicio,
                        fim: a.fim,
                        motivo: a.motivo.clone(),
                        justificada: a.justificada,
                    })
            })
            .collect();
        Ok(AgendaMesDto {
            ano,
            mes,
            gerado_em: gerado.map(|m| m.gerado_em),
            inicio_semana: regras.inicio_semana.como_texto().to_string(),
            turnos: turnos
                .iter()
                .filter(|t| !t.arquivado || usados.contains(&t.turno.id))
                .map(turno_dto)
                .collect(),
            funcionarios: listados
                .iter()
                .map(|f| FuncionarioResumoDto {
                    id: f.id,
                    nome: f.nome.clone(),
                    matricula: f.matricula.clone(),
                    cargo: f.cargo.clone(),
                    preferencia: periodo_dto(f.preferencia),
                    saldo_anterior_min: planos.get(&f.id).map_or(0, |p| p.saldo_anterior_min),
                    funcao: funcao_de(f),
                })
                .collect(),
            alocacoes: do_mes
                .iter()
                .map(|a| AlocacaoDto {
                    id: a.id,
                    funcionario_id: a.alocacao.funcionario_id,
                    turno_id: a.alocacao.turno_id,
                    data: a.alocacao.data,
                    inicio: hhmm(a.alocacao.horario.inicio()),
                    fim: hhmm(a.alocacao.horario.fim()),
                    minutos_trabalhados: a.alocacao.minutos_trabalhados(),
                })
                .collect(),
            semanas: resumo,
            avisos,
            ausencias,
            ajustes: self
                .banco
                .ajustes_manuais(cliente, entrada.inicio, entrada.fim)?
                .into_iter()
                .map(|(funcionario_id, data)| AjusteManualDto {
                    funcionario_id,
                    data,
                })
                .collect(),
            funcoes: entrada
                .minimo_por_funcao
                .iter()
                .map(|(chave, m)| FuncaoDto {
                    chave: chave.clone(),
                    nome: m.nome.clone(),
                    pessoas: u32::try_from(
                        listados
                            .iter()
                            .filter(|f| f.ativo && funcao_de(f).as_deref() == Some(chave.as_str()))
                            .count(),
                    )
                    .unwrap_or(0),
                    minimo: m.minimo,
                    pessoas_necessarias: 0,
                })
                .collect(),
            regra,
        })
    }

    /// Ajuste manual no Quadro de um mês já gerado: o dia do funcionário vira turno,
    /// folga ou ausência (falta ou justificada). Os avisos de cobertura são
    /// recalculados; regras quebradas pelo ajuste aparecem na agenda, sem impedir.
    pub fn definir_dia(
        &mut self,
        cliente: ClienteId,
        funcionario: i64,
        data: NaiveDate,
        dia: &DiaQuadroDto,
    ) -> Resultado<AgendaMesDto> {
        let (ano, mes) = (data.year(), data.month());
        if self.banco.mes(cliente, ano, mes)?.is_none() {
            return Err(ErroApp::validacao(
                "gere a escala deste mês antes de ajustar",
            ));
        }
        let turnos = self.banco.turnos(cliente)?;
        let marcado = match dia.tipo.as_str() {
            "turno" => {
                let id = dia
                    .turno_id
                    .ok_or_else(|| ErroApp::validacao("informe o turno do dia"))?;
                let t = turnos
                    .iter()
                    .find(|t| t.turno.id == id && !t.arquivado)
                    .ok_or(ErroApp::Banco(escala_db::ErroBanco::NaoEncontrado("turno")))?;
                DiaMarcado::Turno(t.turno.id, t.turno.horario)
            }
            "folga" => DiaMarcado::Folga,
            "ausencia" => DiaMarcado::Ausencia {
                justificada: dia.justificada.unwrap_or(true),
                motivo: dia
                    .motivo
                    .as_deref()
                    .map(str::trim)
                    .filter(|m| !m.is_empty())
                    .map(|m| m.chars().take(80).collect()),
            },
            outro => {
                return Err(ErroApp::validacao(format!(
                    "tipo de dia \"{outro}\" desconhecido; use turno, folga ou ausencia"
                )))
            }
        };
        let escolhido = match &marcado {
            DiaMarcado::Turno(turno_id, horario) => Some((*turno_id, *horario)),
            _ => None,
        };

        let (inicio, fim) = limites(ano, mes)?;
        let mut alocacoes: Vec<Alocacao> = self
            .banco
            .alocacoes(cliente, inicio, fim)?
            .into_iter()
            .map(|a| a.alocacao)
            .filter(|a| !(a.funcionario_id == funcionario && a.data == data))
            .collect();
        if let Some((turno_id, horario)) = escolhido {
            alocacoes.push(Alocacao {
                funcionario_id: funcionario,
                turno_id,
                data,
                horario,
            });
        }
        // Mantém os avisos gerais; os de cobertura e de carga são refeitos.
        let mut avisos: Vec<Aviso> = self
            .banco
            .avisos_do_mes(cliente, ano, mes)?
            .into_iter()
            .filter(|a| {
                !(a.tipo == TipoAviso::CargaAbaixoDoAlvo
                    || a.tipo == TipoAviso::FuncaoDescoberta
                    || (a.tipo == TipoAviso::CoberturaInsuficiente && a.data.is_some()))
            })
            .collect();
        avisos.extend(avisos_de_cobertura(&turnos, &alocacoes, inicio, fim));
        let (entrada, _) = self.entrada_do_mes(cliente, ano, mes, false)?;
        avisos.extend(avisos_de_funcao(&entrada, &alocacoes));
        self.banco
            .marcar_dia(cliente, ano, mes, funcionario, data, &marcado, &avisos)?;
        self.fixar_previstos(cliente, ano, mes, Some(data))?;
        self.obter_agenda(cliente, ano, mes)
    }
}

/// Funções abaixo do mínimo em algum turno: um aviso por função, turno e semana,
/// com os dias (mesmo texto do motor).
fn avisos_de_funcao(entrada: &EntradaPlanejamento, alocacoes: &[Alocacao]) -> Vec<Aviso> {
    let funcao: HashMap<i64, &str> = entrada
        .funcionarios
        .iter()
        .filter_map(|f| f.funcao.as_deref().map(|c| (f.id, c)))
        .collect();
    let mut faltas: BTreeMap<(NaiveDate, String, i64), Vec<NaiveDate>> = BTreeMap::new();
    let Some(semanas) = semanas_cobrindo(entrada.inicio, entrada.fim, entrada.regras.inicio_semana)
    else {
        return Vec::new();
    };
    for dia in entrada.inicio.iter_days().take_while(|d| *d <= entrada.fim) {
        let semana = semanas
            .iter()
            .find(|s| s.contem(dia))
            .map_or(dia, |s| s.inicio);
        for t in entrada.turnos.iter().filter(|t| t.funciona_em(dia)) {
            for (chave, m) in &entrada.minimo_por_funcao {
                let presentes = alocacoes
                    .iter()
                    .filter(|a| {
                        a.data == dia
                            && a.turno_id == t.id
                            && funcao.get(&a.funcionario_id) == Some(&chave.as_str())
                    })
                    .count();
                if u32::try_from(presentes).unwrap_or(u32::MAX) < m.minimo {
                    faltas
                        .entry((semana, chave.clone(), t.id))
                        .or_default()
                        .push(dia);
                }
            }
        }
    }
    faltas
        .into_iter()
        .map(|((_, chave, turno_id), dias)| {
            let turno = entrada
                .turnos
                .iter()
                .find(|t| t.id == turno_id)
                .map_or("?", |t| t.nome.as_str());
            let (nome, minimo) = entrada
                .minimo_por_funcao
                .get(&chave)
                .map_or((chave.as_str(), 1), |m| (m.nome.as_str(), m.minimo));
            let datas: Vec<String> = dias.iter().map(|d| d.format("%d/%m").to_string()).collect();
            Aviso {
                tipo: TipoAviso::FuncaoDescoberta,
                data: dias.first().copied(),
                turno_id: Some(turno_id),
                funcionario_id: None,
                mensagem: format!(
                    "{nome}: turno {turno} sem o mínimo de {minimo} pessoa(s) da função em {}.",
                    datas.join(", ")
                ),
            }
        })
        .collect()
}

/// Dias em que um turno em uso ficou abaixo do efetivo mínimo.
fn avisos_de_cobertura(
    turnos: &[TurnoRow],
    alocacoes: &[Alocacao],
    inicio: NaiveDate,
    fim: NaiveDate,
) -> Vec<Aviso> {
    let mut avisos = Vec::new();
    for dia in inicio.iter_days().take_while(|d| *d <= fim) {
        for t in turnos.iter().filter(|t| !t.arquivado) {
            if t.turno.efetivo_minimo == 0 || !t.turno.funciona_em(dia) {
                continue;
            }
            let escalados = alocacoes
                .iter()
                .filter(|a| a.data == dia && a.turno_id == t.turno.id)
                .count();
            let escalados = u32::try_from(escalados).unwrap_or(u32::MAX);
            if escalados < t.turno.efetivo_minimo {
                avisos.push(Aviso {
                    tipo: TipoAviso::CoberturaInsuficiente,
                    data: Some(dia),
                    turno_id: Some(t.turno.id),
                    funcionario_id: None,
                    mensagem: format!(
                        "{}: turno {} com {} de {} pessoa(s) mínimas.",
                        dia.format("%d/%m/%Y"),
                        t.turno.nome,
                        escalados,
                        t.turno.efetivo_minimo
                    ),
                });
            }
        }
    }
    avisos
}

/// Cores dadas aos turnos gerados pelo funcionamento (mesma paleta da interface).
const PALETA_TURNOS: [&str; 12] = [
    "#F2B705", "#F2780C", "#E0533D", "#D63A7A", "#8E4DC4", "#3B5BDB", "#1F8FD6", "#0F9E9A",
    "#2E9E5B", "#7A9A1F", "#8A6A4F", "#64748B",
];

impl Servico {
    /// Importa as pessoas do "Quadro de Horário de Trabalho" (nome, função, seção e
    /// CTPS). Os horários do quadro não são importados: os turnos saem do
    /// funcionamento do cliente e cada pessoa mantém a preferência que já tinha.
    fn importar_quadro(
        &mut self,
        cliente: ClienteId,
        caminho: &Path,
        bytes: Vec<u8>,
        simular: bool,
    ) -> Resultado<RelatorioImportacaoDto> {
        let leitura = escala_excel::ler_quadro_bytes(bytes)?;
        let (pessoas, rejeitadas) = quadro::pessoas(&leitura);
        let existentes = self.banco.matriculas(cliente)?;

        let acoes: HashMap<String, AcaoImportacao> = if simular {
            pessoas
                .iter()
                .map(|f| {
                    let acao = if existentes.contains(&f.matricula) {
                        AcaoImportacao::Atualizado
                    } else {
                        AcaoImportacao::Criado
                    };
                    (f.matricula.clone(), acao)
                })
                .collect()
        } else {
            let dados: Vec<DadosFuncionario> = pessoas
                .iter()
                .map(|f| DadosFuncionario {
                    matricula: f.matricula.clone(),
                    nome: f.nome.clone(),
                    cargo: f.funcao.clone(),
                    ctps: f.ctps.clone(),
                    secao: f.secao.clone(),
                    carga_semanal_min: None,
                    preferencia: None,
                })
                .collect();
            self.banco
                .gravar_importacao(cliente, &dados, &[])?
                .into_iter()
                .collect()
        };

        let mut avisos = leitura.avisos.clone();
        avisos.push(
            "Do quadro foram lidos só os dados das pessoas; os horários não são importados (os turnos vêm de Configurações → Funcionamento).".into(),
        );
        let mut rejeitados: Vec<LinhaRejeitadaDto> = leitura
            .rejeitadas
            .iter()
            .cloned()
            .map(rejeitada_dto)
            .collect();
        rejeitados.extend(rejeitadas);
        rejeitados.sort_by_key(|r| r.linha);

        Ok(RelatorioImportacaoDto {
            arquivo: caminho.file_name().map_or_else(
                || caminho.display().to_string(),
                |n| n.to_string_lossy().into_owned(),
            ),
            simulacao: simular,
            formato: "quadro".into(),
            empregador: leitura.empregador.clone(),
            total_linhas: leitura.total_linhas,
            importados: pessoas
                .iter()
                .map(|f| LinhaImportadaDto {
                    linha: f.linha,
                    matricula: f.matricula.clone(),
                    nome: f.nome.clone(),
                    acao: match acoes.get(&f.matricula) {
                        Some(AcaoImportacao::Atualizado) => "atualizado",
                        _ => "criado",
                    }
                    .into(),
                })
                .collect(),
            rejeitados,
            ausencias_importadas: 0,
            avisos,
        })
    }

    /// Exporta a escala do mês em Excel, pronta para imprimir e afixar.
    pub fn exportar_escala(
        &self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        caminho: &Path,
    ) -> Resultado<()> {
        let agenda = self.obter_agenda(cliente, ano, mes)?;
        if agenda.gerado_em.is_none() {
            return Err(ErroApp::validacao(
                "gere a escala deste mês antes de exportar",
            ));
        }
        let nome_cliente = self.banco.cliente(cliente)?.nome;
        let funcionarios = self.banco.funcionarios(cliente)?;
        let escala = exportar::montar(&nome_cliente, &agenda, &funcionarios)?;
        Ok(escala_excel::salvar_escala(caminho, &escala)?)
    }
}

impl Servico {
    /// Edita cargo, carga semanal e preferência de período.
    pub fn salvar_funcionario(
        &mut self,
        cliente: ClienteId,
        funcionario: i64,
        dto: &FuncionarioEdicaoDto,
    ) -> Resultado<FuncionarioDto> {
        let carga = match dto.carga_semanal_horas {
            None => None,
            Some(h) if h.is_finite() && h > 0.0 && h <= 168.0 => Some((h * 60.0).round() as u32),
            Some(h) => {
                return Err(ErroApp::validacao(format!(
                    "carga semanal inválida ({h}h); use de 1 a 168 horas"
                )))
            }
        };
        let cargo = dto
            .cargo
            .as_deref()
            .map(str::trim)
            .filter(|c| !c.is_empty())
            .map(str::to_string);
        self.banco.atualizar_funcionario(
            cliente,
            funcionario,
            &escala_db::EdicaoFuncionario {
                cargo,
                carga_semanal_min: carga,
                preferencia: periodo_valido(dto.preferencia.as_deref())?,
            },
        )?;
        self.listar_funcionarios(cliente)?
            .into_iter()
            .find(|f| f.id == funcionario)
            .ok_or_else(|| ErroApp::Interno("funcionário sumiu após salvar".into()))
    }
}
