//! Esquema do banco e migrações versionadas por `PRAGMA user_version`.

use rusqlite::Connection;

use crate::ErroBanco;

/// Cada item é uma migração; a posição + 1 é a versão resultante.
/// Nunca altere uma migração já publicada: acrescente uma nova.
const MIGRACOES: &[&str] = &[
    r#"
CREATE TABLE clientes (
    id        INTEGER PRIMARY KEY,
    nome      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    criado_em TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE regras (
    cliente_id                  INTEGER PRIMARY KEY REFERENCES clientes(id) ON DELETE CASCADE,
    carga_semanal_max_min       INTEGER NOT NULL CHECK (carga_semanal_max_min > 0),
    jornada_diaria_max_min      INTEGER NOT NULL CHECK (jornada_diaria_max_min > 0),
    descanso_entre_jornadas_min INTEGER NOT NULL CHECK (descanso_entre_jornadas_min >= 0),
    max_dias_consecutivos       INTEGER NOT NULL CHECK (max_dias_consecutivos > 0),
    inicio_semana               TEXT NOT NULL CHECK (inicio_semana IN ('segunda', 'domingo'))
);

CREATE TABLE turnos (
    id             INTEGER PRIMARY KEY,
    cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    nome           TEXT NOT NULL COLLATE NOCASE,
    inicio_min     INTEGER NOT NULL CHECK (inicio_min BETWEEN 0 AND 1439),
    fim_min        INTEGER NOT NULL CHECK (fim_min BETWEEN 0 AND 1439),
    intervalo_min  INTEGER NOT NULL DEFAULT 0 CHECK (intervalo_min >= 0),
    efetivo_minimo INTEGER NOT NULL DEFAULT 0 CHECK (efetivo_minimo >= 0),
    ordem          INTEGER NOT NULL DEFAULT 0,
    cor            TEXT NOT NULL DEFAULT '#888888',
    UNIQUE (cliente_id, nome)
);

CREATE TABLE funcionarios (
    id                INTEGER PRIMARY KEY,
    cliente_id        INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    matricula         TEXT NOT NULL,
    nome              TEXT NOT NULL,
    cargo             TEXT,
    carga_semanal_min INTEGER CHECK (carga_semanal_min IS NULL OR carga_semanal_min > 0),
    -- bit 0 = segunda ... bit 6 = domingo
    dias_disponiveis  INTEGER NOT NULL DEFAULT 127 CHECK (dias_disponiveis BETWEEN 1 AND 127),
    ativo             INTEGER NOT NULL DEFAULT 1,
    UNIQUE (cliente_id, matricula)
);

-- Turnos que o funcionário pode cobrir; horário próprio opcional (NULL = horário do turno).
CREATE TABLE funcionario_turnos (
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    turno_id       INTEGER NOT NULL REFERENCES turnos(id) ON DELETE CASCADE,
    inicio_min     INTEGER,
    fim_min        INTEGER,
    intervalo_min  INTEGER,
    PRIMARY KEY (funcionario_id, turno_id)
);

CREATE TABLE ausencias (
    id             INTEGER PRIMARY KEY,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    inicio         TEXT NOT NULL,
    fim            TEXT NOT NULL,
    motivo         TEXT,
    CHECK (fim >= inicio)
);
CREATE INDEX ausencias_funcionario ON ausencias (funcionario_id);

CREATE TABLE meses_gerados (
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    ano        INTEGER NOT NULL,
    mes        INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
    gerado_em  TEXT NOT NULL,
    PRIMARY KEY (cliente_id, ano, mes)
);

CREATE TABLE avisos_mes (
    id             INTEGER PRIMARY KEY,
    cliente_id     INTEGER NOT NULL,
    ano            INTEGER NOT NULL,
    mes            INTEGER NOT NULL,
    tipo           TEXT NOT NULL,
    data           TEXT,
    turno_id       INTEGER,
    funcionario_id INTEGER,
    mensagem       TEXT NOT NULL,
    FOREIGN KEY (cliente_id, ano, mes) REFERENCES meses_gerados (cliente_id, ano, mes) ON DELETE CASCADE
);
CREATE INDEX avisos_mes_chave ON avisos_mes (cliente_id, ano, mes);

-- Horário gravado na própria alocação: alterar o turno depois não muda escalas já geradas.
CREATE TABLE alocacoes (
    id                  INTEGER PRIMARY KEY,
    cliente_id          INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    funcionario_id      INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    turno_id            INTEGER NOT NULL REFERENCES turnos(id),
    data                TEXT NOT NULL,
    inicio_min          INTEGER NOT NULL,
    fim_min             INTEGER NOT NULL,
    intervalo_min       INTEGER NOT NULL,
    minutos_trabalhados INTEGER NOT NULL,
    UNIQUE (funcionario_id, data)
);
CREATE INDEX alocacoes_cliente_data ON alocacoes (cliente_id, data);
CREATE INDEX alocacoes_turno ON alocacoes (turno_id);
"#,
    // v2: dias da semana em que cada turno funciona (bit 0 = segunda ... bit 6 = domingo).
    r#"
ALTER TABLE turnos ADD COLUMN dias_semana INTEGER NOT NULL DEFAULT 127 CHECK (dias_semana BETWEEN 1 AND 127);
"#,
    // v3: fim da escala 6x1 (EC 141/2026): folgas semanais, domingos seguidos e regime
    // legal por cliente; CTPS e seção vindas do quadro de horário.
    r#"
ALTER TABLE regras ADD COLUMN folgas_semanais_min INTEGER NOT NULL DEFAULT 1 CHECK (folgas_semanais_min BETWEEN 0 AND 6);
ALTER TABLE regras ADD COLUMN domingos_seguidos_max INTEGER NOT NULL DEFAULT 0 CHECK (domingos_seguidos_max BETWEEN 0 AND 52);
ALTER TABLE regras ADD COLUMN regime TEXT NOT NULL DEFAULT 'livre' CHECK (regime IN ('livre', 'ec141'));
ALTER TABLE regras ADD COLUMN ec141_publicacao TEXT;
ALTER TABLE funcionarios ADD COLUMN ctps TEXT;
ALTER TABLE funcionarios ADD COLUMN secao TEXT;
"#,
    // v4: horário preferido do funcionário entre os turnos que ele pode fazer
    // (o do quadro de horário; o motor tenta mantê-lo quando há vaga).
    r#"
ALTER TABLE funcionario_turnos ADD COLUMN preferido INTEGER NOT NULL DEFAULT 0;
UPDATE funcionario_turnos SET preferido = 1
 WHERE funcionario_id IN (SELECT funcionario_id FROM funcionario_turnos GROUP BY funcionario_id HAVING COUNT(*) = 1);
"#,
    // v5: horário de funcionamento do estabelecimento (os turnos são gerados dele),
    // turnos arquivados e preferência de período no lugar dos turnos e dias do
    // funcionário. `funcionario_turnos` e `dias_disponiveis` ficam sem uso; a
    // preferência começa pelo horário preferido de cada pessoa.
    r#"
CREATE TABLE funcionamento (
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    dia        INTEGER NOT NULL CHECK (dia BETWEEN 0 AND 6),
    abre_min   INTEGER NOT NULL CHECK (abre_min BETWEEN 0 AND 1439),
    fecha_min  INTEGER NOT NULL CHECK (fecha_min BETWEEN 0 AND 1439),
    PRIMARY KEY (cliente_id, dia)
);
ALTER TABLE regras ADD COLUMN jornada_padrao_min INTEGER NOT NULL DEFAULT 360 CHECK (jornada_padrao_min BETWEEN 60 AND 720);
ALTER TABLE regras ADD COLUMN intervalo_padrao_min INTEGER NOT NULL DEFAULT 15 CHECK (intervalo_padrao_min BETWEEN 0 AND 120);
ALTER TABLE turnos ADD COLUMN arquivado INTEGER NOT NULL DEFAULT 0;
ALTER TABLE funcionarios ADD COLUMN preferencia TEXT CHECK (preferencia IS NULL OR preferencia IN ('manha', 'tarde', 'noite'));
UPDATE funcionarios SET preferencia = (
    SELECT CASE
             WHEN COALESCE(ft.inicio_min, t.inicio_min) < 300 THEN 'noite'
             WHEN COALESCE(ft.inicio_min, t.inicio_min) < 720 THEN 'manha'
             WHEN COALESCE(ft.inicio_min, t.inicio_min) < 1080 THEN 'tarde'
             ELSE 'noite'
           END
      FROM funcionario_turnos ft JOIN turnos t ON t.id = ft.turno_id
     WHERE ft.funcionario_id = funcionarios.id AND ft.preferido = 1
     ORDER BY t.ordem, t.id
     LIMIT 1
);
"#,
    // v6: ausência justificada (férias, atestado: abona as horas) ou falta (não abona).
    // As ausências já gravadas vieram da importação (férias, afastamentos): justificadas.
    r#"
ALTER TABLE ausencias ADD COLUMN justificada INTEGER NOT NULL DEFAULT 1;
"#,
    // v7: horas previstas de cada semana fechada, gravadas ao gerar ou ajustar o mês.
    // O saldo de semanas passadas usa o previsto da época, não o das regras atuais.
    r#"
CREATE TABLE previsto_semanas (
    cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    inicio         TEXT NOT NULL,
    previsto_min   INTEGER NOT NULL CHECK (previsto_min >= 0),
    PRIMARY KEY (funcionario_id, inicio)
);
CREATE INDEX previsto_semanas_cliente ON previsto_semanas (cliente_id, inicio);
"#,
    // v8: modelo de funcionamento em uso (horário, jornada e regras vêm dele);
    // NULL = configuração personalizada. Clientes antigos ficam personalizados.
    r#"
ALTER TABLE regras ADD COLUMN modelo TEXT;
"#,
    // v9: mínimo de pessoas de cada função (cargo normalizado) em cada turno de cada
    // dia. Função sem linha usa o padrão (1).
    r#"
CREATE TABLE funcoes_minimas (
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    funcao     TEXT NOT NULL,
    minimo     INTEGER NOT NULL CHECK (minimo BETWEEN 0 AND 20),
    PRIMARY KEY (cliente_id, funcao)
);
"#,
    // v10: dias ajustados à mão no Quadro; ficam travados ao reequilibrar o mês.
    r#"
CREATE TABLE ajustes_manuais (
    cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    funcionario_id INTEGER NOT NULL REFERENCES funcionarios(id) ON DELETE CASCADE,
    data           TEXT NOT NULL,
    PRIMARY KEY (funcionario_id, data)
);
CREATE INDEX ajustes_manuais_cliente ON ajustes_manuais (cliente_id, data);
"#,
];

pub(crate) fn configurar(conn: &Connection) -> Result<(), ErroBanco> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    // WAL não se aplica a bancos em memória; ignorar o retorno é seguro.
    let _modo: String = conn.pragma_update_and_check(None, "journal_mode", "WAL", |l| l.get(0))?;
    Ok(())
}

pub(crate) fn migrar(conn: &mut Connection) -> Result<(), ErroBanco> {
    let versao: i64 = conn.pragma_query_value(None, "user_version", |l| l.get(0))?;
    let versao = usize::try_from(versao).unwrap_or(0);
    if versao > MIGRACOES.len() {
        return Err(ErroBanco::VersaoFutura {
            banco: versao,
            app: MIGRACOES.len(),
        });
    }
    for (i, sql) in MIGRACOES.iter().enumerate().skip(versao) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(
            None,
            "user_version",
            i64::try_from(i + 1).unwrap_or(i64::MAX),
        )?;
        tx.commit()?;
    }
    Ok(())
}
