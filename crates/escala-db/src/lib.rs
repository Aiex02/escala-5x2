//! Persistência local em SQLite embutido (compilado junto com o app via
//! `rusqlite/bundled`, sem servidor nem instalação).
//!
//! Cada cliente é dono dos seus turnos, regras, funcionários, meses gerados e
//! alocações; excluir o cliente remove tudo em cascata.
#![forbid(unsafe_code)]
#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]

mod esquema;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

use chrono::{Datelike, NaiveDate};
use escala_core::{
    Alocacao, Aviso, DiasSemana, FuncionarioId, HoraDoDia, Horario, InicioSemana, JanelaDia,
    Periodo, RegimeLegal, RegrasCarga, TipoAviso, Turno, TurnoId,
};
use rusqlite::{params, Connection, ErrorCode, OptionalExtension, Row, Transaction};
use thiserror::Error;

pub type ClienteId = i64;

#[derive(Debug, Error)]
pub enum ErroBanco {
    #[error("erro no banco de dados: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("{0} não encontrado(a)")]
    NaoEncontrado(&'static str),
    #[error("{0}")]
    Conflito(String),
    #[error("dado inválido no banco: {0}")]
    DadoInvalido(String),
    #[error("o banco foi criado por uma versão mais nova do aplicativo (esquema {banco}; esta versão suporta até {app})")]
    VersaoFutura { banco: usize, app: usize },
}

type Resultado<T> = Result<T, ErroBanco>;

fn violou_unicidade(e: &rusqlite::Error) -> bool {
    matches!(e, rusqlite::Error::SqliteFailure(f, _) if f.code == ErrorCode::ConstraintViolation)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClienteRow {
    pub id: ClienteId,
    pub nome: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TurnoRow {
    pub turno: Turno,
    pub cor: String,
    /// Turno fora do funcionamento atual, mantido só por escalas já geradas.
    pub arquivado: bool,
}

/// Horário de funcionamento do estabelecimento e jornada usada nos turnos.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Funcionamento {
    /// Dias abertos; vazio = ainda não configurado (clientes antigos).
    pub janelas: Vec<JanelaDia>,
    pub jornada_min: u32,
    pub intervalo_min: u32,
}

/// Dados para criar (`id = None`) ou atualizar um turno.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DadosTurno {
    pub id: Option<TurnoId>,
    pub nome: String,
    pub horario: Horario,
    pub efetivo_minimo: u32,
    pub ordem: i32,
    pub cor: String,
    /// Dias da semana em que o turno funciona.
    pub dias: DiasSemana,
}

/// Alterações feitas pela tela de funcionários.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdicaoFuncionario {
    pub cargo: Option<String>,
    pub carga_semanal_min: Option<u32>,
    pub preferencia: Option<Periodo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AusenciaRow {
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub motivo: Option<String>,
    /// true = justificada (abona as horas do dia); false = falta.
    pub justificada: bool,
}

/// O que o Quadro grava num dia de um funcionário.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DiaMarcado {
    Turno(TurnoId, Horario),
    Folga,
    Ausencia {
        justificada: bool,
        motivo: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FuncionarioRow {
    pub id: FuncionarioId,
    pub matricula: String,
    pub nome: String,
    pub cargo: Option<String>,
    /// Número/série da CTPS (quadro de horário).
    pub ctps: Option<String>,
    pub secao: Option<String>,
    pub carga_semanal_min: Option<u32>,
    /// Período preferido; a escala atende quando houver vaga.
    pub preferencia: Option<Periodo>,
    pub ativo: bool,
    pub ausencias: Vec<AusenciaRow>,
}

/// Funcionário vindo da importação (atualiza pelo par cliente + matrícula).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DadosFuncionario {
    pub matricula: String,
    pub nome: String,
    pub cargo: Option<String>,
    pub ctps: Option<String>,
    pub secao: Option<String>,
    pub carga_semanal_min: Option<u32>,
    /// `None` mantém a preferência já gravada.
    pub preferencia: Option<Periodo>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DadosAusencia {
    pub matricula: String,
    pub inicio: NaiveDate,
    pub fim: NaiveDate,
    pub motivo: Option<String>,
    pub justificada: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AcaoImportacao {
    Criado,
    Atualizado,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MesRow {
    pub ano: i32,
    pub mes: u32,
    pub gerado_em: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AlocacaoRow {
    pub id: i64,
    pub alocacao: Alocacao,
}

/// Conexão com o banco local. Não é `Sync`: o app a guarda atrás de um `Mutex`.
pub struct Banco {
    conn: Connection,
}

fn hora(minutos: u32) -> Resultado<HoraDoDia> {
    HoraDoDia::de_minutos(minutos)
        .ok_or_else(|| ErroBanco::DadoInvalido(format!("horário {minutos} min")))
}

fn horario(inicio: u32, fim: u32, intervalo: u32) -> Resultado<Horario> {
    Horario::novo(hora(inicio)?, hora(fim)?, intervalo)
        .map_err(|e| ErroBanco::DadoInvalido(e.to_string()))
}

fn periodo(codigo: Option<String>) -> Resultado<Option<Periodo>> {
    codigo
        .map(|c| {
            Periodo::de_texto(&c).ok_or_else(|| ErroBanco::DadoInvalido(format!("período \"{c}\"")))
        })
        .transpose()
}

fn ler_alocacao(
    l: &Row<'_>,
) -> rusqlite::Result<(i64, FuncionarioId, TurnoId, NaiveDate, u32, u32, u32)> {
    Ok((
        l.get(0)?,
        l.get(1)?,
        l.get(2)?,
        l.get(3)?,
        l.get(4)?,
        l.get(5)?,
        l.get(6)?,
    ))
}

impl Banco {
    /// Abre (ou cria) o arquivo do banco e aplica as migrações pendentes.
    pub fn abrir(caminho: &Path) -> Resultado<Self> {
        Self::preparar(Connection::open(caminho)?)
    }

    /// Banco temporário em memória (testes).
    pub fn em_memoria() -> Resultado<Self> {
        Self::preparar(Connection::open_in_memory()?)
    }

    fn preparar(mut conn: Connection) -> Resultado<Self> {
        esquema::configurar(&conn)?;
        esquema::migrar(&mut conn)?;
        Ok(Banco { conn })
    }

    // ------------------------------------------------------------------ clientes

    pub fn listar_clientes(&self) -> Resultado<Vec<ClienteRow>> {
        let mut st = self
            .conn
            .prepare("SELECT id, nome FROM clientes ORDER BY nome COLLATE NOCASE")?;
        let linhas = st.query_map([], |l| {
            Ok(ClienteRow {
                id: l.get(0)?,
                nome: l.get(1)?,
            })
        })?;
        Ok(linhas.collect::<Result<_, _>>()?)
    }

    pub fn cliente(&self, id: ClienteId) -> Resultado<ClienteRow> {
        self.conn
            .query_row("SELECT id, nome FROM clientes WHERE id = ?1", [id], |l| {
                Ok(ClienteRow {
                    id: l.get(0)?,
                    nome: l.get(1)?,
                })
            })
            .optional()?
            .ok_or(ErroBanco::NaoEncontrado("cliente"))
    }

    /// Cria o cliente já com regras, funcionamento e turnos iniciais.
    pub fn criar_cliente(
        &mut self,
        nome: &str,
        regras: &RegrasCarga,
        regime: &RegimeLegal,
        funcionamento: &Funcionamento,
        turnos: &[DadosTurno],
    ) -> Resultado<ClienteRow> {
        let tx = self.conn.transaction()?;
        tx.execute("INSERT INTO clientes (nome) VALUES (?1)", [nome])
            .map_err(|e| {
                if violou_unicidade(&e) {
                    ErroBanco::Conflito(format!("já existe um cliente chamado \"{nome}\""))
                } else {
                    e.into()
                }
            })?;
        let id = tx.last_insert_rowid();
        gravar_regras(&tx, id, regras)?;
        gravar_regime(&tx, id, regime)?;
        gravar_funcionamento(&tx, id, funcionamento)?;
        for t in turnos {
            inserir_turno(&tx, id, t)?;
        }
        tx.commit()?;
        Ok(ClienteRow {
            id,
            nome: nome.to_string(),
        })
    }

    pub fn renomear_cliente(&self, id: ClienteId, nome: &str) -> Resultado<ClienteRow> {
        let n = self
            .conn
            .execute(
                "UPDATE clientes SET nome = ?2 WHERE id = ?1",
                params![id, nome],
            )
            .map_err(|e| {
                if violou_unicidade(&e) {
                    ErroBanco::Conflito(format!("já existe um cliente chamado \"{nome}\""))
                } else {
                    e.into()
                }
            })?;
        if n == 0 {
            return Err(ErroBanco::NaoEncontrado("cliente"));
        }
        Ok(ClienteRow {
            id,
            nome: nome.to_string(),
        })
    }

    pub fn excluir_cliente(&self, id: ClienteId) -> Resultado<()> {
        match self
            .conn
            .execute("DELETE FROM clientes WHERE id = ?1", [id])?
        {
            0 => Err(ErroBanco::NaoEncontrado("cliente")),
            _ => Ok(()),
        }
    }

    // ------------------------------------------------------------------ regras

    pub fn regras(&self, cliente: ClienteId) -> Resultado<RegrasCarga> {
        let linha = self
            .conn
            .query_row(
                "SELECT carga_semanal_max_min, jornada_diaria_max_min, descanso_entre_jornadas_min,
                        max_dias_consecutivos, inicio_semana, folgas_semanais_min, domingos_seguidos_max
                 FROM regras WHERE cliente_id = ?1",
                [cliente],
                |l| {
                    Ok((
                        l.get::<_, u32>(0)?,
                        l.get::<_, u32>(1)?,
                        l.get::<_, u32>(2)?,
                        l.get::<_, u32>(3)?,
                        l.get::<_, String>(4)?,
                        l.get::<_, u32>(5)?,
                        l.get::<_, u32>(6)?,
                    ))
                },
            )
            .optional()?
            .ok_or(ErroBanco::NaoEncontrado("regras do cliente"))?;
        let inicio_semana = InicioSemana::de_texto(&linha.4)
            .ok_or_else(|| ErroBanco::DadoInvalido(format!("início de semana \"{}\"", linha.4)))?;
        Ok(RegrasCarga {
            carga_semanal_max_min: linha.0,
            jornada_diaria_max_min: linha.1,
            descanso_entre_jornadas_min: linha.2,
            max_dias_consecutivos: linha.3,
            inicio_semana,
            folgas_semanais_min: linha.5,
            domingos_seguidos_max: linha.6,
        })
    }

    pub fn regime(&self, cliente: ClienteId) -> Resultado<RegimeLegal> {
        let (codigo, publicacao): (String, Option<NaiveDate>) = self
            .conn
            .query_row(
                "SELECT regime, ec141_publicacao FROM regras WHERE cliente_id = ?1",
                [cliente],
                |l| Ok((l.get(0)?, l.get(1)?)),
            )
            .optional()?
            .ok_or(ErroBanco::NaoEncontrado("regras do cliente"))?;
        RegimeLegal::de_codigo(&codigo, publicacao)
            .ok_or_else(|| ErroBanco::DadoInvalido(format!("regime \"{codigo}\"")))
    }

    /// Mínimos por função gravados (chave normalizada → pessoas por turno).
    pub fn minimos_funcao(&self, cliente: ClienteId) -> Resultado<HashMap<String, u32>> {
        let mut st = self
            .conn
            .prepare("SELECT funcao, minimo FROM funcoes_minimas WHERE cliente_id = ?1")?;
        let linhas = st.query_map([cliente], |l| Ok((l.get(0)?, l.get(1)?)))?;
        Ok(linhas.collect::<Result<_, _>>()?)
    }

    /// Grava (ou troca) o mínimo de cada função informada.
    pub fn salvar_minimos_funcao(
        &mut self,
        cliente: ClienteId,
        minimos: &[(String, u32)],
    ) -> Resultado<()> {
        self.cliente(cliente)?;
        let tx = self.conn.transaction()?;
        {
            let mut st = tx.prepare(
                "INSERT INTO funcoes_minimas (cliente_id, funcao, minimo) VALUES (?1, ?2, ?3)
                 ON CONFLICT (cliente_id, funcao) DO UPDATE SET minimo = excluded.minimo",
            )?;
            for (funcao, minimo) in minimos {
                st.execute(params![cliente, funcao, minimo])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    /// Modelo de funcionamento em uso; `None` = configuração personalizada.
    pub fn modelo(&self, cliente: ClienteId) -> Resultado<Option<String>> {
        self.conn
            .query_row(
                "SELECT modelo FROM regras WHERE cliente_id = ?1",
                [cliente],
                |l| l.get(0),
            )
            .optional()?
            .ok_or(ErroBanco::NaoEncontrado("regras do cliente"))
    }

    pub fn salvar_modelo(&self, cliente: ClienteId, modelo: Option<&str>) -> Resultado<()> {
        match self.conn.execute(
            "UPDATE regras SET modelo = ?2 WHERE cliente_id = ?1",
            params![cliente, modelo],
        )? {
            0 => Err(ErroBanco::NaoEncontrado("regras do cliente")),
            _ => Ok(()),
        }
    }

    pub fn salvar_regime(&self, cliente: ClienteId, regime: &RegimeLegal) -> Resultado<()> {
        gravar_regime(&self.conn, cliente, regime)
    }

    pub fn salvar_regras(&self, cliente: ClienteId, regras: &RegrasCarga) -> Resultado<()> {
        self.cliente(cliente)?;
        gravar_regras(&self.conn, cliente, regras)
    }

    // ------------------------------------------------------------------ funcionamento

    pub fn funcionamento(&self, cliente: ClienteId) -> Resultado<Funcionamento> {
        let (jornada_min, intervalo_min): (u32, u32) = self
            .conn
            .query_row(
                "SELECT jornada_padrao_min, intervalo_padrao_min FROM regras WHERE cliente_id = ?1",
                [cliente],
                |l| Ok((l.get(0)?, l.get(1)?)),
            )
            .optional()?
            .ok_or(ErroBanco::NaoEncontrado("regras do cliente"))?;
        let mut st = self.conn.prepare(
            "SELECT dia, abre_min, fecha_min FROM funcionamento WHERE cliente_id = ?1 ORDER BY dia",
        )?;
        let linhas = st.query_map([cliente], |l| {
            Ok((l.get::<_, u8>(0)?, l.get::<_, u32>(1)?, l.get::<_, u32>(2)?))
        })?;
        let mut janelas = Vec::new();
        for l in linhas {
            let (dia, abre, fecha) = l?;
            janelas.push(JanelaDia {
                dia,
                abre: hora(abre)?,
                fecha: hora(fecha)?,
            });
        }
        Ok(Funcionamento {
            janelas,
            jornada_min,
            intervalo_min,
        })
    }

    /// Grava o funcionamento e troca os turnos pelos `turnos` informados numa
    /// transação: os com `id` são atualizados, os sem `id` criados, e os demais
    /// turnos do cliente são arquivados (se aparecem em escalas geradas) ou
    /// excluídos.
    pub fn aplicar_funcionamento(
        &mut self,
        cliente: ClienteId,
        funcionamento: &Funcionamento,
        turnos: &[DadosTurno],
    ) -> Resultado<Vec<TurnoRow>> {
        self.cliente(cliente)?;
        for t in turnos {
            validar_dias_turno(t)?;
        }
        let tx = self.conn.transaction()?;
        gravar_funcionamento(&tx, cliente, funcionamento)?;

        let mantidos: HashSet<TurnoId> = turnos.iter().filter_map(|t| t.id).collect();
        let existentes: Vec<(TurnoId, String, u32, bool, bool)> = {
            let mut st = tx.prepare(
                "SELECT t.id, t.nome, t.inicio_min, t.arquivado,
                        EXISTS (SELECT 1 FROM alocacoes a WHERE a.turno_id = t.id)
                 FROM turnos t WHERE t.cliente_id = ?1",
            )?;
            let linhas = st.query_map([cliente], |l| {
                Ok((l.get(0)?, l.get(1)?, l.get(2)?, l.get(3)?, l.get(4)?))
            })?;
            linhas.collect::<Result<_, _>>()?
        };
        for id in &mantidos {
            if !existentes.iter().any(|(e, ..)| e == id) {
                return Err(ErroBanco::NaoEncontrado("turno"));
            }
        }
        for (id, nome, inicio, arquivado, em_uso) in &existentes {
            if mantidos.contains(id) {
                // Nome provisório: os nomes podem trocar entre turnos mantidos.
                tx.execute(
                    "UPDATE turnos SET nome = ?2, arquivado = 0 WHERE id = ?1",
                    params![id, format!("~{id}")],
                )?;
            } else if !*em_uso {
                tx.execute("DELETE FROM turnos WHERE id = ?1", [id])?;
            } else if !*arquivado {
                let base = format!("{nome} (antigo {})", hora(*inicio)?);
                let nome_livre = nome_disponivel(&tx, cliente, &base)?;
                tx.execute(
                    "UPDATE turnos SET arquivado = 1, nome = ?2 WHERE id = ?1",
                    params![id, nome_livre],
                )?;
            }
        }
        for t in turnos {
            let conflito = |e: rusqlite::Error| {
                if violou_unicidade(&e) {
                    ErroBanco::Conflito(format!("já existe um turno chamado \"{}\"", t.nome))
                } else {
                    e.into()
                }
            };
            match t.id {
                Some(id) => {
                    tx.execute(
                        "UPDATE turnos SET nome = ?2, inicio_min = ?3, fim_min = ?4, intervalo_min = ?5,
                                efetivo_minimo = ?6, ordem = ?7, cor = ?8, dias_semana = ?9
                         WHERE id = ?1",
                        params![
                            id,
                            t.nome,
                            t.horario.inicio().minutos(),
                            t.horario.fim().minutos(),
                            t.horario.intervalo_min(),
                            t.efetivo_minimo,
                            t.ordem,
                            t.cor,
                            t.dias.bits()
                        ],
                    )
                    .map_err(conflito)?;
                }
                None => {
                    inserir_turno(&tx, cliente, t).map_err(|e| match e {
                        ErroBanco::Sqlite(e) => conflito(e),
                        outro => outro,
                    })?;
                }
            }
        }
        tx.commit()?;
        self.turnos(cliente)
    }

    // ------------------------------------------------------------------ turnos

    /// Turnos do cliente, os em uso primeiro e os arquivados no fim.
    pub fn turnos(&self, cliente: ClienteId) -> Resultado<Vec<TurnoRow>> {
        let mut st = self.conn.prepare(
            "SELECT id, nome, inicio_min, fim_min, intervalo_min, efetivo_minimo, ordem, cor, dias_semana, arquivado
             FROM turnos WHERE cliente_id = ?1 ORDER BY arquivado, ordem, id",
        )?;
        let linhas = st.query_map([cliente], |l| {
            Ok((
                l.get::<_, TurnoId>(0)?,
                l.get::<_, String>(1)?,
                l.get::<_, u32>(2)?,
                l.get::<_, u32>(3)?,
                l.get::<_, u32>(4)?,
                l.get::<_, u32>(5)?,
                l.get::<_, i32>(6)?,
                l.get::<_, String>(7)?,
                l.get::<_, u8>(8)?,
                l.get::<_, bool>(9)?,
            ))
        })?;
        let mut turnos = Vec::new();
        for l in linhas {
            let (id, nome, ini, fim, intervalo, efetivo_minimo, ordem, cor, dias_semana, arquivado) =
                l?;
            turnos.push(TurnoRow {
                turno: Turno {
                    id,
                    nome,
                    horario: horario(ini, fim, intervalo)?,
                    efetivo_minimo,
                    ordem,
                    dias: DiasSemana::de_bits(dias_semana),
                },
                cor,
                arquivado,
            });
        }
        Ok(turnos)
    }

    pub fn salvar_turno(&self, cliente: ClienteId, dados: &DadosTurno) -> Resultado<TurnoRow> {
        validar_dias_turno(dados)?;
        self.cliente(cliente)?;
        let conflito = |e: rusqlite::Error| {
            if violou_unicidade(&e) {
                ErroBanco::Conflito(format!("já existe um turno chamado \"{}\"", dados.nome))
            } else {
                e.into()
            }
        };
        let mut arquivado = false;
        let id = match dados.id {
            Some(id) => {
                arquivado = self
                    .conn
                    .query_row(
                        "SELECT arquivado FROM turnos WHERE id = ?1 AND cliente_id = ?2",
                        params![id, cliente],
                        |l| l.get(0),
                    )
                    .optional()?
                    .ok_or(ErroBanco::NaoEncontrado("turno"))?;
                let n = self
                    .conn
                    .execute(
                        "UPDATE turnos SET nome = ?3, inicio_min = ?4, fim_min = ?5, intervalo_min = ?6,
                                efetivo_minimo = ?7, ordem = ?8, cor = ?9, dias_semana = ?10
                         WHERE id = ?1 AND cliente_id = ?2",
                        params![
                            id,
                            cliente,
                            dados.nome,
                            dados.horario.inicio().minutos(),
                            dados.horario.fim().minutos(),
                            dados.horario.intervalo_min(),
                            dados.efetivo_minimo,
                            dados.ordem,
                            dados.cor,
                            dados.dias.bits()
                        ],
                    )
                    .map_err(conflito)?;
                if n == 0 {
                    return Err(ErroBanco::NaoEncontrado("turno"));
                }
                id
            }
            None => inserir_turno(&self.conn, cliente, dados).map_err(|e| match e {
                ErroBanco::Sqlite(e) => conflito(e),
                outro => outro,
            })?,
        };
        Ok(TurnoRow {
            turno: Turno {
                id,
                nome: dados.nome.clone(),
                horario: dados.horario,
                efetivo_minimo: dados.efetivo_minimo,
                ordem: dados.ordem,
                dias: dados.dias,
            },
            cor: dados.cor.clone(),
            arquivado,
        })
    }

    /// Quantas alocações de meses gerados usam o turno.
    pub fn alocacoes_do_turno(&self, cliente: ClienteId, turno: TurnoId) -> Resultado<u32> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM alocacoes WHERE turno_id = ?1 AND cliente_id = ?2",
            params![turno, cliente],
            |l| l.get(0),
        )?)
    }

    /// Recusa a exclusão se o turno já aparece em escalas geradas.
    pub fn excluir_turno(&self, cliente: ClienteId, turno: TurnoId) -> Resultado<()> {
        let em_uso: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM alocacoes WHERE turno_id = ?1 AND cliente_id = ?2",
            params![turno, cliente],
            |l| l.get(0),
        )?;
        if em_uso > 0 {
            return Err(ErroBanco::Conflito(format!(
                "o turno é usado em {em_uso} alocação(ões) de meses já gerados; exclua esses meses antes de remover o turno"
            )));
        }
        match self.conn.execute(
            "DELETE FROM turnos WHERE id = ?1 AND cliente_id = ?2",
            params![turno, cliente],
        )? {
            0 => Err(ErroBanco::NaoEncontrado("turno")),
            _ => Ok(()),
        }
    }

    // ------------------------------------------------------------------ funcionários

    pub fn funcionarios(&self, cliente: ClienteId) -> Resultado<Vec<FuncionarioRow>> {
        let mut ausencias: HashMap<FuncionarioId, Vec<AusenciaRow>> = HashMap::new();
        {
            let mut st = self.conn.prepare(
                "SELECT a.funcionario_id, a.inicio, a.fim, a.motivo, a.justificada
                 FROM ausencias a JOIN funcionarios f ON f.id = a.funcionario_id
                 WHERE f.cliente_id = ?1 ORDER BY a.inicio",
            )?;
            let linhas = st.query_map([cliente], |l| {
                Ok((
                    l.get::<_, FuncionarioId>(0)?,
                    AusenciaRow {
                        inicio: l.get(1)?,
                        fim: l.get(2)?,
                        motivo: l.get(3)?,
                        justificada: l.get(4)?,
                    },
                ))
            })?;
            for l in linhas {
                let (f, a) = l?;
                ausencias.entry(f).or_default().push(a);
            }
        }
        let mut st = self.conn.prepare(
            "SELECT id, matricula, nome, cargo, carga_semanal_min, preferencia, ativo, ctps, secao
             FROM funcionarios WHERE cliente_id = ?1 ORDER BY nome COLLATE NOCASE, matricula",
        )?;
        let linhas = st.query_map([cliente], |l| {
            Ok((
                l.get::<_, FuncionarioId>(0)?,
                l.get::<_, String>(1)?,
                l.get::<_, String>(2)?,
                l.get::<_, Option<String>>(3)?,
                l.get::<_, Option<u32>>(4)?,
                l.get::<_, Option<String>>(5)?,
                l.get::<_, bool>(6)?,
                l.get::<_, Option<String>>(7)?,
                l.get::<_, Option<String>>(8)?,
            ))
        })?;
        let mut resultado = Vec::new();
        for l in linhas {
            let (id, matricula, nome, cargo, carga_semanal_min, preferencia, ativo, ctps, secao) =
                l?;
            resultado.push(FuncionarioRow {
                id,
                matricula,
                nome,
                cargo,
                ctps,
                secao,
                carga_semanal_min,
                preferencia: periodo(preferencia)?,
                ativo,
                ausencias: ausencias.remove(&id).unwrap_or_default(),
            });
        }
        Ok(resultado)
    }

    pub fn matriculas(&self, cliente: ClienteId) -> Resultado<HashSet<String>> {
        let mut st = self
            .conn
            .prepare("SELECT matricula FROM funcionarios WHERE cliente_id = ?1")?;
        let linhas = st.query_map([cliente], |l| l.get::<_, String>(0))?;
        Ok(linhas.collect::<Result<_, _>>()?)
    }

    /// Grava a importação numa única transação: cria ou atualiza funcionários pela
    /// matrícula e substitui as ausências dos funcionários presentes em `ausencias`.
    pub fn gravar_importacao(
        &mut self,
        cliente: ClienteId,
        funcionarios: &[DadosFuncionario],
        ausencias: &[DadosAusencia],
    ) -> Resultado<Vec<(String, AcaoImportacao)>> {
        self.cliente(cliente)?;
        let tx = self.conn.transaction()?;
        let mut acoes = Vec::with_capacity(funcionarios.len());
        for f in funcionarios {
            match id_por_matricula(&tx, cliente, &f.matricula)? {
                Some(id) => {
                    tx.execute(
                        "UPDATE funcionarios SET nome = ?2, cargo = ?3,
                                carga_semanal_min = COALESCE(?4, carga_semanal_min),
                                preferencia = COALESCE(?5, preferencia),
                                ctps = COALESCE(?6, ctps), secao = COALESCE(?7, secao)
                         WHERE id = ?1",
                        params![
                            id,
                            f.nome,
                            f.cargo,
                            f.carga_semanal_min,
                            f.preferencia.map(Periodo::codigo),
                            f.ctps,
                            f.secao
                        ],
                    )?;
                    acoes.push((f.matricula.clone(), AcaoImportacao::Atualizado));
                }
                None => {
                    tx.execute(
                        "INSERT INTO funcionarios (cliente_id, matricula, nome, cargo, carga_semanal_min, preferencia, ctps, secao)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                        params![
                            cliente,
                            f.matricula,
                            f.nome,
                            f.cargo,
                            f.carga_semanal_min,
                            f.preferencia.map(Periodo::codigo),
                            f.ctps,
                            f.secao
                        ],
                    )?;
                    acoes.push((f.matricula.clone(), AcaoImportacao::Criado));
                }
            }
        }

        let mut por_matricula: BTreeMap<&str, Vec<&DadosAusencia>> = BTreeMap::new();
        for a in ausencias {
            por_matricula
                .entry(a.matricula.as_str())
                .or_default()
                .push(a);
        }
        for (matricula, lista) in por_matricula {
            let id = id_por_matricula(&tx, cliente, matricula)?
                .ok_or(ErroBanco::NaoEncontrado("funcionário da ausência"))?;
            tx.execute("DELETE FROM ausencias WHERE funcionario_id = ?1", [id])?;
            for a in lista {
                inserir_ausencia(
                    &tx,
                    id,
                    &AusenciaRow {
                        inicio: a.inicio,
                        fim: a.fim,
                        motivo: a.motivo.clone(),
                        justificada: a.justificada,
                    },
                )?;
            }
        }
        tx.commit()?;
        Ok(acoes)
    }

    /// Atualiza cargo, carga semanal e preferência de período do funcionário.
    pub fn atualizar_funcionario(
        &self,
        cliente: ClienteId,
        funcionario: FuncionarioId,
        dados: &EdicaoFuncionario,
    ) -> Resultado<()> {
        let n = self.conn.execute(
            "UPDATE funcionarios SET cargo = ?3, carga_semanal_min = ?4, preferencia = ?5
             WHERE id = ?1 AND cliente_id = ?2",
            params![
                funcionario,
                cliente,
                dados.cargo,
                dados.carga_semanal_min,
                dados.preferencia.map(Periodo::codigo)
            ],
        )?;
        if n == 0 {
            return Err(ErroBanco::NaoEncontrado("funcionário"));
        }
        Ok(())
    }

    pub fn definir_ativo(
        &self,
        cliente: ClienteId,
        funcionario: FuncionarioId,
        ativo: bool,
    ) -> Resultado<()> {
        match self.conn.execute(
            "UPDATE funcionarios SET ativo = ?3 WHERE id = ?1 AND cliente_id = ?2",
            params![funcionario, cliente, ativo],
        )? {
            0 => Err(ErroBanco::NaoEncontrado("funcionário")),
            _ => Ok(()),
        }
    }

    /// Remove o funcionário e, em cascata, suas alocações em meses gerados.
    pub fn excluir_funcionario(
        &self,
        cliente: ClienteId,
        funcionario: FuncionarioId,
    ) -> Resultado<()> {
        match self.conn.execute(
            "DELETE FROM funcionarios WHERE id = ?1 AND cliente_id = ?2",
            params![funcionario, cliente],
        )? {
            0 => Err(ErroBanco::NaoEncontrado("funcionário")),
            _ => Ok(()),
        }
    }

    // ------------------------------------------------------------------ meses e alocações

    pub fn meses(&self, cliente: ClienteId) -> Resultado<Vec<MesRow>> {
        let mut st = self.conn.prepare(
            "SELECT ano, mes, gerado_em FROM meses_gerados WHERE cliente_id = ?1 ORDER BY ano, mes",
        )?;
        let linhas = st.query_map([cliente], |l| {
            Ok(MesRow {
                ano: l.get(0)?,
                mes: l.get(1)?,
                gerado_em: l.get(2)?,
            })
        })?;
        Ok(linhas.collect::<Result<_, _>>()?)
    }

    pub fn mes(&self, cliente: ClienteId, ano: i32, mes: u32) -> Resultado<Option<MesRow>> {
        Ok(self
            .conn
            .query_row(
                "SELECT ano, mes, gerado_em FROM meses_gerados WHERE cliente_id = ?1 AND ano = ?2 AND mes = ?3",
                params![cliente, ano, mes],
                |l| Ok(MesRow { ano: l.get(0)?, mes: l.get(1)?, gerado_em: l.get(2)? }),
            )
            .optional()?)
    }

    /// Horas previstas gravadas por (funcionário, início da semana) em `[de, ate]`.
    pub fn previstos(
        &self,
        cliente: ClienteId,
        de: NaiveDate,
        ate: NaiveDate,
    ) -> Resultado<HashMap<(FuncionarioId, NaiveDate), u32>> {
        let mut st = self.conn.prepare(
            "SELECT funcionario_id, inicio, previsto_min FROM previsto_semanas
             WHERE cliente_id = ?1 AND inicio BETWEEN ?2 AND ?3",
        )?;
        let linhas = st.query_map(params![cliente, de, ate], |l| {
            Ok(((l.get(0)?, l.get(1)?), l.get(2)?))
        })?;
        Ok(linhas.collect::<Result<_, _>>()?)
    }

    /// Grava (ou troca) as horas previstas de semanas fechadas.
    pub fn gravar_previstos(
        &mut self,
        cliente: ClienteId,
        previstos: &[(FuncionarioId, NaiveDate, u32)],
    ) -> Resultado<()> {
        let tx = self.conn.transaction()?;
        {
            let mut st = tx.prepare(
                "INSERT INTO previsto_semanas (cliente_id, funcionario_id, inicio, previsto_min)
                 SELECT ?1, ?2, ?3, ?4 WHERE EXISTS
                     (SELECT 1 FROM funcionarios WHERE id = ?2 AND cliente_id = ?1)
                 ON CONFLICT (funcionario_id, inicio) DO UPDATE SET previsto_min = excluded.previsto_min",
            )?;
            for (funcionario, inicio, previsto) in previstos {
                st.execute(params![cliente, funcionario, inicio, previsto])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn avisos_do_mes(&self, cliente: ClienteId, ano: i32, mes: u32) -> Resultado<Vec<Aviso>> {
        let mut st = self.conn.prepare(
            "SELECT tipo, data, turno_id, funcionario_id, mensagem FROM avisos_mes
             WHERE cliente_id = ?1 AND ano = ?2 AND mes = ?3 ORDER BY id",
        )?;
        let linhas = st.query_map(params![cliente, ano, mes], |l| {
            Ok((
                l.get::<_, String>(0)?,
                l.get::<_, Option<NaiveDate>>(1)?,
                l.get::<_, Option<TurnoId>>(2)?,
                l.get::<_, Option<FuncionarioId>>(3)?,
                l.get::<_, String>(4)?,
            ))
        })?;
        let mut avisos = Vec::new();
        for l in linhas {
            let (tipo, data, turno_id, funcionario_id, mensagem) = l?;
            let tipo = TipoAviso::de_codigo(&tipo)
                .ok_or_else(|| ErroBanco::DadoInvalido(format!("tipo de aviso \"{tipo}\"")))?;
            avisos.push(Aviso {
                tipo,
                data,
                turno_id,
                funcionario_id,
                mensagem,
            });
        }
        Ok(avisos)
    }

    /// Alocações do cliente com data em `[inicio, fim]`.
    pub fn alocacoes(
        &self,
        cliente: ClienteId,
        inicio: NaiveDate,
        fim: NaiveDate,
    ) -> Resultado<Vec<AlocacaoRow>> {
        let mut st = self.conn.prepare(
            "SELECT id, funcionario_id, turno_id, data, inicio_min, fim_min, intervalo_min
             FROM alocacoes WHERE cliente_id = ?1 AND data BETWEEN ?2 AND ?3
             ORDER BY data, turno_id, funcionario_id",
        )?;
        let linhas = st.query_map(params![cliente, inicio, fim], ler_alocacao)?;
        let mut resultado = Vec::new();
        for l in linhas {
            let (id, funcionario_id, turno_id, data, ini, fim_min, intervalo) = l?;
            resultado.push(AlocacaoRow {
                id,
                alocacao: Alocacao {
                    funcionario_id,
                    turno_id,
                    data,
                    horario: horario(ini, fim_min, intervalo)?,
                },
            });
        }
        Ok(resultado)
    }

    /// Substitui atomicamente a escala de um mês (alocações e avisos).
    #[allow(clippy::too_many_arguments)]
    pub fn substituir_mes(
        &mut self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        inicio: NaiveDate,
        fim: NaiveDate,
        alocacoes: &[Alocacao],
        avisos: &[Aviso],
    ) -> Resultado<MesRow> {
        self.cliente(cliente)?;
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM alocacoes WHERE cliente_id = ?1 AND data BETWEEN ?2 AND ?3",
            params![cliente, inicio, fim],
        )?;
        // Gerar o mês de novo descarta os ajustes feitos à mão.
        tx.execute(
            "DELETE FROM ajustes_manuais WHERE cliente_id = ?1 AND data BETWEEN ?2 AND ?3",
            params![cliente, inicio, fim],
        )?;
        tx.execute(
            "INSERT INTO meses_gerados (cliente_id, ano, mes, gerado_em)
             VALUES (?1, ?2, ?3, datetime('now', 'localtime'))
             ON CONFLICT (cliente_id, ano, mes) DO UPDATE SET gerado_em = excluded.gerado_em",
            params![cliente, ano, mes],
        )?;
        {
            let mut st = tx.prepare(
                "INSERT INTO alocacoes (cliente_id, funcionario_id, turno_id, data, inicio_min, fim_min, intervalo_min, minutos_trabalhados)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for a in alocacoes {
                if a.data < inicio || a.data > fim {
                    return Err(ErroBanco::DadoInvalido(format!(
                        "alocação de {} fora do mês",
                        a.data
                    )));
                }
                st.execute(params![
                    cliente,
                    a.funcionario_id,
                    a.turno_id,
                    a.data,
                    a.horario.inicio().minutos(),
                    a.horario.fim().minutos(),
                    a.horario.intervalo_min(),
                    a.minutos_trabalhados()
                ])?;
            }
        }
        gravar_avisos(&tx, cliente, ano, mes, avisos)?;
        let gerado_em: String = tx.query_row(
            "SELECT gerado_em FROM meses_gerados WHERE cliente_id = ?1 AND ano = ?2 AND mes = ?3",
            params![cliente, ano, mes],
            |l| l.get(0),
        )?;
        tx.commit()?;
        Ok(MesRow {
            ano,
            mes,
            gerado_em,
        })
    }

    /// Ajuste manual de um mês gerado, numa transação: o dia do funcionário vira
    /// turno, folga ou ausência. A data sai de qualquer ausência que a contenha (um
    /// período de férias é dividido em dois) e os avisos do mês são substituídos.
    #[allow(clippy::too_many_arguments)]
    pub fn marcar_dia(
        &mut self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        funcionario: FuncionarioId,
        data: NaiveDate,
        dia: &DiaMarcado,
        avisos: &[Aviso],
    ) -> Resultado<()> {
        if (data.year(), data.month()) != (ano, mes) {
            return Err(ErroBanco::DadoInvalido(format!(
                "{data} fora de {mes:02}/{ano}"
            )));
        }
        if self.mes(cliente, ano, mes)?.is_none() {
            return Err(ErroBanco::NaoEncontrado("mês gerado"));
        }
        let tx = self.conn.transaction()?;
        let do_cliente: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM funcionarios WHERE id = ?1 AND cliente_id = ?2)",
            params![funcionario, cliente],
            |l| l.get(0),
        )?;
        if !do_cliente {
            return Err(ErroBanco::NaoEncontrado("funcionário"));
        }
        tx.execute(
            "DELETE FROM alocacoes WHERE funcionario_id = ?1 AND data = ?2",
            params![funcionario, data],
        )?;
        tirar_dia_das_ausencias(&tx, funcionario, data)?;
        tx.execute(
            "INSERT OR IGNORE INTO ajustes_manuais (cliente_id, funcionario_id, data) VALUES (?1, ?2, ?3)",
            params![cliente, funcionario, data],
        )?;
        if let DiaMarcado::Ausencia {
            justificada,
            motivo,
        } = dia
        {
            inserir_ausencia(
                &tx,
                funcionario,
                &AusenciaRow {
                    inicio: data,
                    fim: data,
                    motivo: motivo.clone(),
                    justificada: *justificada,
                },
            )?;
        }
        if let DiaMarcado::Turno(turno_id, horario) = dia {
            let pertence: bool = tx.query_row(
                "SELECT EXISTS (SELECT 1 FROM turnos WHERE id = ?1 AND cliente_id = ?2)",
                params![turno_id, cliente],
                |l| l.get(0),
            )?;
            if !pertence {
                return Err(ErroBanco::NaoEncontrado("turno"));
            }
            tx.execute(
                "INSERT INTO alocacoes (cliente_id, funcionario_id, turno_id, data, inicio_min, fim_min, intervalo_min, minutos_trabalhados)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    cliente,
                    funcionario,
                    turno_id,
                    data,
                    horario.inicio().minutos(),
                    horario.fim().minutos(),
                    horario.intervalo_min(),
                    horario.minutos_trabalhados()
                ],
            )?;
        }
        gravar_avisos(&tx, cliente, ano, mes, avisos)?;
        tx.commit()?;
        Ok(())
    }

    /// Dias ajustados à mão no Quadro em `[de, ate]`.
    pub fn ajustes_manuais(
        &self,
        cliente: ClienteId,
        de: NaiveDate,
        ate: NaiveDate,
    ) -> Resultado<BTreeSet<(FuncionarioId, NaiveDate)>> {
        let mut st = self.conn.prepare(
            "SELECT funcionario_id, data FROM ajustes_manuais
             WHERE cliente_id = ?1 AND data BETWEEN ?2 AND ?3",
        )?;
        let linhas = st.query_map(params![cliente, de, ate], |l| Ok((l.get(0)?, l.get(1)?)))?;
        Ok(linhas.collect::<Result<_, _>>()?)
    }

    /// Reequilíbrio: troca as jornadas de `[de, ate]` (dentro do mês gerado) por
    /// `alocacoes`, mantendo as dos dias ajustados à mão, e substitui os avisos do mês.
    #[allow(clippy::too_many_arguments)]
    pub fn substituir_periodo(
        &mut self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        de: NaiveDate,
        ate: NaiveDate,
        alocacoes: &[Alocacao],
        avisos: &[Aviso],
    ) -> Resultado<()> {
        if self.mes(cliente, ano, mes)?.is_none() {
            return Err(ErroBanco::NaoEncontrado("mês gerado"));
        }
        let tx = self.conn.transaction()?;
        tx.execute(
            "DELETE FROM alocacoes WHERE cliente_id = ?1 AND data BETWEEN ?2 AND ?3
               AND NOT EXISTS (SELECT 1 FROM ajustes_manuais m
                                WHERE m.funcionario_id = alocacoes.funcionario_id
                                  AND m.data = alocacoes.data)",
            params![cliente, de, ate],
        )?;
        {
            let mut st = tx.prepare(
                "INSERT INTO alocacoes (cliente_id, funcionario_id, turno_id, data, inicio_min, fim_min, intervalo_min, minutos_trabalhados)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for a in alocacoes {
                if a.data < de || a.data > ate {
                    return Err(ErroBanco::DadoInvalido(format!(
                        "jornada de {} fora do período reequilibrado",
                        a.data
                    )));
                }
                st.execute(params![
                    cliente,
                    a.funcionario_id,
                    a.turno_id,
                    a.data,
                    a.horario.inicio().minutos(),
                    a.horario.fim().minutos(),
                    a.horario.intervalo_min(),
                    a.minutos_trabalhados()
                ])?;
            }
        }
        gravar_avisos(&tx, cliente, ano, mes, avisos)?;
        tx.commit()?;
        Ok(())
    }

    pub fn excluir_mes(
        &mut self,
        cliente: ClienteId,
        ano: i32,
        mes: u32,
        inicio: NaiveDate,
        fim: NaiveDate,
    ) -> Resultado<()> {
        let tx = self.conn.transaction()?;
        let n = tx.execute(
            "DELETE FROM meses_gerados WHERE cliente_id = ?1 AND ano = ?2 AND mes = ?3",
            params![cliente, ano, mes],
        )?;
        if n == 0 {
            return Err(ErroBanco::NaoEncontrado("mês gerado"));
        }
        tx.execute(
            "DELETE FROM alocacoes WHERE cliente_id = ?1 AND data BETWEEN ?2 AND ?3",
            params![cliente, inicio, fim],
        )?;
        tx.execute(
            "DELETE FROM ajustes_manuais WHERE cliente_id = ?1 AND data BETWEEN ?2 AND ?3",
            params![cliente, inicio, fim],
        )?;
        tx.execute(
            "DELETE FROM avisos_mes WHERE cliente_id = ?1 AND ano = ?2 AND mes = ?3",
            params![cliente, ano, mes],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn gravar_regras(conn: &Connection, cliente: ClienteId, r: &RegrasCarga) -> Resultado<()> {
    conn.execute(
        "INSERT INTO regras (cliente_id, carga_semanal_max_min, jornada_diaria_max_min,
                             descanso_entre_jornadas_min, max_dias_consecutivos, inicio_semana,
                             folgas_semanais_min, domingos_seguidos_max)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT (cliente_id) DO UPDATE SET
            carga_semanal_max_min = excluded.carga_semanal_max_min,
            jornada_diaria_max_min = excluded.jornada_diaria_max_min,
            descanso_entre_jornadas_min = excluded.descanso_entre_jornadas_min,
            max_dias_consecutivos = excluded.max_dias_consecutivos,
            inicio_semana = excluded.inicio_semana,
            folgas_semanais_min = excluded.folgas_semanais_min,
            domingos_seguidos_max = excluded.domingos_seguidos_max",
        params![
            cliente,
            r.carga_semanal_max_min,
            r.jornada_diaria_max_min,
            r.descanso_entre_jornadas_min,
            r.max_dias_consecutivos,
            r.inicio_semana.como_texto(),
            r.folgas_semanais_min,
            r.domingos_seguidos_max
        ],
    )?;
    Ok(())
}

fn inserir_ausencia(
    tx: &Transaction<'_>,
    funcionario: FuncionarioId,
    a: &AusenciaRow,
) -> Resultado<()> {
    tx.execute(
        "INSERT INTO ausencias (funcionario_id, inicio, fim, motivo, justificada) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![funcionario, a.inicio, a.fim, a.motivo, a.justificada],
    )?;
    Ok(())
}

/// Remove `data` das ausências do funcionário, dividindo os períodos que a contêm.
fn tirar_dia_das_ausencias(
    tx: &Transaction<'_>,
    funcionario: FuncionarioId,
    data: NaiveDate,
) -> Resultado<()> {
    let periodos: Vec<(i64, AusenciaRow)> = {
        let mut st = tx.prepare(
            "SELECT id, inicio, fim, motivo, justificada FROM ausencias
             WHERE funcionario_id = ?1 AND inicio <= ?2 AND fim >= ?2",
        )?;
        let linhas = st.query_map(params![funcionario, data], |l| {
            Ok((
                l.get(0)?,
                AusenciaRow {
                    inicio: l.get(1)?,
                    fim: l.get(2)?,
                    motivo: l.get(3)?,
                    justificada: l.get(4)?,
                },
            ))
        })?;
        linhas.collect::<Result<_, _>>()?
    };
    for (id, a) in periodos {
        tx.execute("DELETE FROM ausencias WHERE id = ?1", [id])?;
        if let Some(antes) = data.pred_opt().filter(|d| *d >= a.inicio) {
            inserir_ausencia(
                tx,
                funcionario,
                &AusenciaRow {
                    fim: antes,
                    ..a.clone()
                },
            )?;
        }
        if let Some(depois) = data.succ_opt().filter(|d| *d <= a.fim) {
            inserir_ausencia(
                tx,
                funcionario,
                &AusenciaRow {
                    inicio: depois,
                    ..a
                },
            )?;
        }
    }
    Ok(())
}

/// Substitui os avisos guardados do mês.
fn gravar_avisos(
    tx: &Transaction<'_>,
    cliente: ClienteId,
    ano: i32,
    mes: u32,
    avisos: &[Aviso],
) -> Resultado<()> {
    tx.execute(
        "DELETE FROM avisos_mes WHERE cliente_id = ?1 AND ano = ?2 AND mes = ?3",
        params![cliente, ano, mes],
    )?;
    let mut st = tx.prepare(
        "INSERT INTO avisos_mes (cliente_id, ano, mes, tipo, data, turno_id, funcionario_id, mensagem)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
    )?;
    for a in avisos {
        st.execute(params![
            cliente,
            ano,
            mes,
            a.tipo.codigo(),
            a.data,
            a.turno_id,
            a.funcionario_id,
            a.mensagem
        ])?;
    }
    Ok(())
}

fn gravar_funcionamento(conn: &Connection, cliente: ClienteId, f: &Funcionamento) -> Resultado<()> {
    let n = conn.execute(
        "UPDATE regras SET jornada_padrao_min = ?2, intervalo_padrao_min = ?3 WHERE cliente_id = ?1",
        params![cliente, f.jornada_min, f.intervalo_min],
    )?;
    if n == 0 {
        return Err(ErroBanco::NaoEncontrado("regras do cliente"));
    }
    conn.execute("DELETE FROM funcionamento WHERE cliente_id = ?1", [cliente])?;
    for j in &f.janelas {
        conn.execute(
            "INSERT INTO funcionamento (cliente_id, dia, abre_min, fecha_min) VALUES (?1, ?2, ?3, ?4)",
            params![cliente, j.dia, j.abre.minutos(), j.fecha.minutos()],
        )
        .map_err(|e| {
            if violou_unicidade(&e) {
                ErroBanco::Conflito(format!("dia {} informado mais de uma vez", j.dia))
            } else {
                e.into()
            }
        })?;
    }
    Ok(())
}

/// `base`, ou `base (2)`, `base (3)`... o primeiro nome de turno livre no cliente.
fn nome_disponivel(tx: &Transaction<'_>, cliente: ClienteId, base: &str) -> Resultado<String> {
    let mut nome = base.to_string();
    for n in 2..1000 {
        let usado: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM turnos WHERE cliente_id = ?1 AND nome = ?2)",
            params![cliente, nome],
            |l| l.get(0),
        )?;
        if !usado {
            return Ok(nome);
        }
        nome = format!("{base} ({n})");
    }
    Err(ErroBanco::Conflito(format!(
        "nomes de turno \"{base}\" esgotados"
    )))
}

fn gravar_regime(conn: &Connection, cliente: ClienteId, regime: &RegimeLegal) -> Resultado<()> {
    let publicacao = match regime {
        RegimeLegal::Ec141 { publicacao } => Some(*publicacao),
        RegimeLegal::Livre => None,
    };
    let n = conn.execute(
        "UPDATE regras SET regime = ?2, ec141_publicacao = ?3 WHERE cliente_id = ?1",
        params![cliente, regime.codigo(), publicacao],
    )?;
    if n == 0 {
        return Err(ErroBanco::NaoEncontrado("regras do cliente"));
    }
    Ok(())
}

fn validar_dias_turno(t: &DadosTurno) -> Resultado<()> {
    if t.dias.vazio() {
        return Err(ErroBanco::Conflito(format!(
            "o turno \"{}\" precisa funcionar em ao menos um dia da semana",
            t.nome
        )));
    }
    Ok(())
}

fn inserir_turno(conn: &Connection, cliente: ClienteId, t: &DadosTurno) -> Resultado<TurnoId> {
    validar_dias_turno(t)?;
    conn.execute(
        "INSERT INTO turnos (cliente_id, nome, inicio_min, fim_min, intervalo_min, efetivo_minimo, ordem, cor, dias_semana)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            cliente,
            t.nome,
            t.horario.inicio().minutos(),
            t.horario.fim().minutos(),
            t.horario.intervalo_min(),
            t.efetivo_minimo,
            t.ordem,
            t.cor,
            t.dias.bits()
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

fn id_por_matricula(
    tx: &Transaction<'_>,
    cliente: ClienteId,
    matricula: &str,
) -> Resultado<Option<FuncionarioId>> {
    Ok(tx
        .query_row(
            "SELECT id FROM funcionarios WHERE cliente_id = ?1 AND matricula = ?2",
            params![cliente, matricula],
            |l| l.get(0),
        )
        .optional()?)
}
