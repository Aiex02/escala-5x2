//! Camada Tauri: estado da aplicação e comandos expostos à interface.
//!
//! Cada comando é uma casca fina sobre [`escala_app::Servico`]; nenhuma regra de
//! negócio mora aqui. Os comandos rodam fora da thread principal (`async`) para
//! não travar a janela durante importações e gerações.
#![forbid(unsafe_code)]
#![deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

use chrono::NaiveDate;
use escala_app::dto::{
    AgendaMesDto, ClienteDto, ConfiguracaoDto, ConfiguracaoEntradaDto, DiaQuadroDto, FuncaoDto,
    FuncaoMinimoDto, FuncionamentoEntradaDto, FuncionarioDto, FuncionarioEdicaoDto, MesGeradoDto,
    ModeloDto, ReequilibrioDto, RegrasDto, RelatorioImportacaoDto, ResultadoGeracaoDto, TurnoDto,
    TurnoEntradaDto,
};
use escala_app::{ErroApp, Servico};
use escala_db::Banco;
use tauri::{Builder, Manager, Runtime, State};

/// Nome do arquivo do banco dentro da pasta de dados do app.
const ARQUIVO_BANCO: &str = "escalas.sqlite3";

struct Estado(Mutex<Servico>);

impl Estado {
    /// Um pânico anterior não deixa o serviço inconsistente (transações do SQLite
    /// são desfeitas ao serem descartadas), então um mutex envenenado é recuperado.
    fn servico(&self) -> MutexGuard<'_, Servico> {
        self.0
            .lock()
            .unwrap_or_else(|envenenado| envenenado.into_inner())
    }
}

type Resposta<T> = Result<T, ErroApp>;

#[tauri::command(async)]
fn listar_clientes(estado: State<'_, Estado>) -> Resposta<Vec<ClienteDto>> {
    estado.servico().listar_clientes()
}

#[tauri::command(async)]
fn criar_cliente(
    estado: State<'_, Estado>,
    nome: String,
    modelo: Option<String>,
) -> Resposta<ClienteDto> {
    let mut servico = estado.servico();
    match modelo {
        Some(m) => servico.criar_cliente_com_modelo(&nome, &m),
        None => servico.criar_cliente(&nome),
    }
}

#[tauri::command(async)]
fn listar_modelos(estado: State<'_, Estado>) -> Vec<ModeloDto> {
    estado.servico().listar_modelos()
}

#[tauri::command(async)]
fn salvar_funcoes(
    estado: State<'_, Estado>,
    cliente_id: i64,
    funcoes: Vec<FuncaoMinimoDto>,
) -> Resposta<Vec<FuncaoDto>> {
    estado.servico().salvar_funcoes(cliente_id, &funcoes)
}

#[tauri::command(async)]
fn salvar_configuracao(
    estado: State<'_, Estado>,
    cliente_id: i64,
    entrada: ConfiguracaoEntradaDto,
) -> Resposta<ConfiguracaoDto> {
    estado.servico().salvar_configuracao(cliente_id, &entrada)
}

#[tauri::command(async)]
fn renomear_cliente(
    estado: State<'_, Estado>,
    cliente_id: i64,
    nome: String,
) -> Resposta<ClienteDto> {
    estado.servico().renomear_cliente(cliente_id, &nome)
}

#[tauri::command(async)]
fn excluir_cliente(estado: State<'_, Estado>, cliente_id: i64) -> Resposta<()> {
    estado.servico().excluir_cliente(cliente_id)
}

#[tauri::command(async)]
fn obter_configuracao(estado: State<'_, Estado>, cliente_id: i64) -> Resposta<ConfiguracaoDto> {
    estado.servico().obter_configuracao(cliente_id)
}

#[tauri::command(async)]
fn salvar_regras(
    estado: State<'_, Estado>,
    cliente_id: i64,
    regras: RegrasDto,
) -> Resposta<RegrasDto> {
    estado.servico().salvar_regras(cliente_id, &regras)
}

#[tauri::command(async)]
fn salvar_funcionamento(
    estado: State<'_, Estado>,
    cliente_id: i64,
    entrada: FuncionamentoEntradaDto,
) -> Resposta<ConfiguracaoDto> {
    estado.servico().salvar_funcionamento(cliente_id, &entrada)
}

#[tauri::command(async)]
fn salvar_turno(
    estado: State<'_, Estado>,
    cliente_id: i64,
    turno: TurnoEntradaDto,
) -> Resposta<TurnoDto> {
    estado.servico().salvar_turno(cliente_id, &turno)
}

#[tauri::command(async)]
fn excluir_turno(estado: State<'_, Estado>, cliente_id: i64, turno_id: i64) -> Resposta<()> {
    estado.servico().excluir_turno(cliente_id, turno_id)
}

#[tauri::command(async)]
fn listar_funcionarios(
    estado: State<'_, Estado>,
    cliente_id: i64,
) -> Resposta<Vec<FuncionarioDto>> {
    estado.servico().listar_funcionarios(cliente_id)
}

#[tauri::command(async)]
fn definir_funcionario_ativo(
    estado: State<'_, Estado>,
    cliente_id: i64,
    funcionario_id: i64,
    ativo: bool,
) -> Resposta<()> {
    estado
        .servico()
        .definir_funcionario_ativo(cliente_id, funcionario_id, ativo)
}

#[tauri::command(async)]
fn salvar_funcionario(
    estado: State<'_, Estado>,
    cliente_id: i64,
    funcionario_id: i64,
    dados: FuncionarioEdicaoDto,
) -> Resposta<FuncionarioDto> {
    estado
        .servico()
        .salvar_funcionario(cliente_id, funcionario_id, &dados)
}

#[tauri::command(async)]
fn excluir_funcionario(
    estado: State<'_, Estado>,
    cliente_id: i64,
    funcionario_id: i64,
) -> Resposta<()> {
    estado
        .servico()
        .excluir_funcionario(cliente_id, funcionario_id)
}

#[tauri::command(async)]
fn importar_planilha(
    estado: State<'_, Estado>,
    cliente_id: i64,
    caminho: PathBuf,
    simular: bool,
) -> Resposta<RelatorioImportacaoDto> {
    estado
        .servico()
        .importar_planilha(cliente_id, &caminho, simular)
}

#[tauri::command(async)]
fn exportar_escala(
    estado: State<'_, Estado>,
    cliente_id: i64,
    ano: i32,
    mes: u32,
    caminho: PathBuf,
) -> Resposta<()> {
    estado
        .servico()
        .exportar_escala(cliente_id, ano, mes, &caminho)
}

#[tauri::command(async)]
fn salvar_modelo_planilha(estado: State<'_, Estado>, caminho: PathBuf) -> Resposta<()> {
    estado.servico().salvar_modelo_planilha(&caminho)
}

#[tauri::command(async)]
fn listar_meses(estado: State<'_, Estado>, cliente_id: i64) -> Resposta<Vec<MesGeradoDto>> {
    estado.servico().listar_meses(cliente_id)
}

#[tauri::command(async)]
fn gerar_mes(
    estado: State<'_, Estado>,
    cliente_id: i64,
    ano: i32,
    mes: u32,
) -> Resposta<ResultadoGeracaoDto> {
    estado.servico().gerar_mes(cliente_id, ano, mes)
}

#[tauri::command(async)]
fn excluir_mes(estado: State<'_, Estado>, cliente_id: i64, ano: i32, mes: u32) -> Resposta<()> {
    estado.servico().excluir_mes(cliente_id, ano, mes)
}

#[tauri::command(async)]
fn obter_agenda(
    estado: State<'_, Estado>,
    cliente_id: i64,
    ano: i32,
    mes: u32,
) -> Resposta<AgendaMesDto> {
    estado.servico().obter_agenda(cliente_id, ano, mes)
}

#[tauri::command(async)]
fn reequilibrar(
    estado: State<'_, Estado>,
    cliente_id: i64,
    ano: i32,
    mes: u32,
    a_partir: NaiveDate,
    seguintes: bool,
) -> Resposta<ReequilibrioDto> {
    estado
        .servico()
        .reequilibrar(cliente_id, ano, mes, a_partir, seguintes)
}

#[tauri::command(async)]
fn definir_dia(
    estado: State<'_, Estado>,
    cliente_id: i64,
    funcionario_id: i64,
    data: NaiveDate,
    dia: DiaQuadroDto,
) -> Resposta<AgendaMesDto> {
    estado
        .servico()
        .definir_dia(cliente_id, funcionario_id, data, &dia)
}

fn registrar_comandos<R: Runtime>(builder: Builder<R>) -> Builder<R> {
    builder.invoke_handler(tauri::generate_handler![
        listar_clientes,
        criar_cliente,
        renomear_cliente,
        excluir_cliente,
        obter_configuracao,
        listar_modelos,
        salvar_configuracao,
        salvar_funcoes,
        salvar_regras,
        salvar_funcionamento,
        salvar_turno,
        excluir_turno,
        listar_funcionarios,
        definir_funcionario_ativo,
        excluir_funcionario,
        salvar_funcionario,
        importar_planilha,
        salvar_modelo_planilha,
        listar_meses,
        gerar_mes,
        excluir_mes,
        obter_agenda,
        definir_dia,
        reequilibrar,
        exportar_escala,
    ])
}

/// Ponto de entrada do app desktop.
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let pasta = app.path().app_data_dir()?;
            std::fs::create_dir_all(&pasta)?;
            let banco = Banco::abrir(&pasta.join(ARQUIVO_BANCO))?;
            app.manage(Estado(Mutex::new(Servico::novo(banco))));
            Ok(())
        });
    let resultado = registrar_comandos(builder).run(tauri::generate_context!());

    if let Err(erro) = resultado {
        eprintln!("Não foi possível iniciar o Organizador de Escalas: {erro}");
        std::process::exit(1);
    }
}

/// Exercita os comandos pela mesma ponte IPC usada pela interface (nomes de
/// comando e de argumentos em camelCase, como em `src/api/client.ts`).
#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod testes {
    use super::*;
    use serde_json::{json, Value};
    use tauri::ipc::{CallbackFn, InvokeBody};
    use tauri::test::{
        get_ipc_response, mock_builder, mock_context, noop_assets, MockRuntime, INVOKE_KEY,
    };
    use tauri::webview::InvokeRequest;
    use tauri::WebviewWindow;

    fn janela() -> WebviewWindow<MockRuntime> {
        let app = registrar_comandos(mock_builder())
            .build(mock_context(noop_assets()))
            .expect("app");
        app.manage(Estado(Mutex::new(Servico::novo(
            Banco::em_memoria().expect("banco"),
        ))));
        tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .expect("janela")
    }

    fn invocar(
        janela: &WebviewWindow<MockRuntime>,
        comando: &str,
        args: Value,
    ) -> Result<Value, Value> {
        get_ipc_response(
            janela,
            InvokeRequest {
                cmd: comando.into(),
                callback: CallbackFn(0),
                error: CallbackFn(1),
                url: "tauri://localhost".parse().expect("url"),
                body: InvokeBody::Json(args),
                headers: Default::default(),
                invoke_key: INVOKE_KEY.to_string(),
            },
        )
        .map(|corpo| corpo.deserialize::<Value>().expect("json"))
    }

    fn ok(janela: &WebviewWindow<MockRuntime>, comando: &str, args: Value) -> Value {
        invocar(janela, comando, args).unwrap_or_else(|e| panic!("{comando} falhou: {e}"))
    }

    #[test]
    fn todos_os_comandos_respondem_pela_ponte_ipc() {
        let j = janela();
        let modelos = ok(&j, "listar_modelos", json!({}));
        assert!(modelos.as_array().is_some_and(|m| m.len() >= 7));
        let outro = ok(
            &j,
            "criar_cliente",
            json!({ "nome": "Escritório IPC", "modelo": "administrativo" }),
        );
        let cfg_outro = ok(
            &j,
            "obter_configuracao",
            json!({ "clienteId": outro["id"] }),
        );
        assert_eq!(cfg_outro["modelo"], "administrativo");
        assert_eq!(cfg_outro["funcionamento"][5]["aberto"], false);
        let cfg_outro = ok(
            &j,
            "salvar_configuracao",
            json!({ "clienteId": outro["id"], "entrada": { "modelo": "supermercado" } }),
        );
        assert_eq!(cfg_outro["modelo"], "supermercado");
        ok(&j, "excluir_cliente", json!({ "clienteId": outro["id"] }));
        let cliente = ok(&j, "criar_cliente", json!({ "nome": "Cliente IPC" }));
        let id = cliente["id"].as_i64().expect("id");
        assert_eq!(
            ok(&j, "listar_clientes", json!({}))[0]["nome"],
            "Cliente IPC"
        );
        ok(
            &j,
            "renomear_cliente",
            json!({ "clienteId": id, "nome": "Cliente IPC 2" }),
        );

        let cfg = ok(&j, "obter_configuracao", json!({ "clienteId": id }));
        let mut regras = cfg["regras"].clone();
        regras["cargaSemanalMaxHoras"] = json!(36);
        assert_eq!(
            ok(
                &j,
                "salvar_regras",
                json!({ "clienteId": id, "regras": regras })
            )["cargaSemanalMaxHoras"],
            36.0
        );
        let dias: Vec<Value> = (0..7)
            .map(|dia| json!({ "dia": dia, "aberto": dia < 6, "abre": "09:00", "fecha": "21:00" }))
            .collect();
        let cfg = ok(
            &j,
            "salvar_funcionamento",
            json!({ "clienteId": id, "entrada": { "dias": dias, "jornadaHoras": 6, "intervaloMin": 15 } }),
        );
        assert_eq!(cfg["funcionamento"][6]["aberto"], false);
        assert_eq!(cfg["turnos"].as_array().map(Vec::len), Some(2));
        assert_eq!(cfg["turnos"][0]["inicio"], "09:00");
        assert_eq!(cfg["turnos"][1]["fim"], "21:00");
        assert_eq!(cfg["regras"]["jornadaPadraoHoras"], 6.0);
        let turno = ok(
            &j,
            "salvar_turno",
            json!({ "clienteId": id, "turno": { "id": null, "nome": "Extra", "inicio": "08:00", "fim": "12:00",
                    "intervaloMin": 0, "efetivoMinimo": 0, "ordem": 9, "cor": "#00AA00",
                    "diasSemana": [0, 1, 2, 3, 4] } }),
        );
        assert_eq!(turno["diasSemana"], json!([0, 1, 2, 3, 4]));
        ok(
            &j,
            "excluir_turno",
            json!({ "clienteId": id, "turnoId": turno["id"] }),
        );

        let modelo = std::env::temp_dir().join(format!("modelo_ipc_{}.xlsx", std::process::id()));
        ok(&j, "salvar_modelo_planilha", json!({ "caminho": modelo }));
        let sim = ok(
            &j,
            "importar_planilha",
            json!({ "clienteId": id, "caminho": modelo, "simular": true }),
        );
        assert_eq!(sim["simulacao"], true);
        let rel = ok(
            &j,
            "importar_planilha",
            json!({ "clienteId": id, "caminho": modelo, "simular": false }),
        );
        assert_eq!(rel["importados"].as_array().map(Vec::len), Some(4));
        let _ = std::fs::remove_file(&modelo);

        let funcs = ok(&j, "listar_funcionarios", json!({ "clienteId": id }));
        let f0 = funcs[0]["id"].clone();
        let editado = ok(
            &j,
            "salvar_funcionario",
            json!({ "clienteId": id, "funcionarioId": f0, "dados": {
                "cargo": "Atendente", "cargaSemanalHoras": null, "preferencia": "tarde" } }),
        );
        assert_eq!(editado["preferencia"], "tarde");
        ok(
            &j,
            "definir_funcionario_ativo",
            json!({ "clienteId": id, "funcionarioId": f0, "ativo": false }),
        );

        let geracao = ok(
            &j,
            "gerar_mes",
            json!({ "clienteId": id, "ano": 2026, "mes": 1 }),
        );
        assert!(geracao["totalAlocacoes"].as_u64().unwrap_or(0) > 0);
        assert_eq!(
            ok(&j, "listar_meses", json!({ "clienteId": id }))[0]["mes"],
            1
        );
        let agenda = ok(
            &j,
            "obter_agenda",
            json!({ "clienteId": id, "ano": 2026, "mes": 1 }),
        );
        assert_eq!(agenda["inicioSemana"], "segunda");
        assert!(agenda["alocacoes"]
            .as_array()
            .is_some_and(|a| !a.is_empty()));
        assert!(agenda["regra"]
            .as_str()
            .is_some_and(|r| r.contains("por semana")));
        let primeira = agenda["alocacoes"][0].clone();
        let ajustada = ok(
            &j,
            "definir_dia",
            json!({ "clienteId": id, "funcionarioId": primeira["funcionarioId"],
                    "data": primeira["data"],
                    "dia": { "tipo": "ausencia", "justificada": false, "motivo": null } }),
        );
        assert_eq!(
            ajustada["alocacoes"].as_array().map(Vec::len),
            agenda["alocacoes"].as_array().map(|a| a.len() - 1)
        );
        let do_dia = |agenda: &Value| {
            agenda["ausencias"].as_array().and_then(|l| {
                l.iter()
                    .find(|a| {
                        a["funcionarioId"] == primeira["funcionarioId"]
                            && a["inicio"] == primeira["data"]
                    })
                    .cloned()
            })
        };
        assert_eq!(
            do_dia(&ajustada).map(|a| a["justificada"].clone()),
            Some(json!(false))
        );
        let com_turno = ok(
            &j,
            "definir_dia",
            json!({ "clienteId": id, "funcionarioId": primeira["funcionarioId"],
                    "data": primeira["data"],
                    "dia": { "tipo": "turno", "turnoId": primeira["turnoId"] } }),
        );
        assert_eq!(do_dia(&com_turno), None);
        assert!(com_turno["funcionarios"][0]["saldoAnteriorMin"].is_i64());
        let exportada =
            std::env::temp_dir().join(format!("escala_ipc_{}.xlsx", std::process::id()));
        ok(
            &j,
            "exportar_escala",
            json!({ "clienteId": id, "ano": 2026, "mes": 1, "caminho": exportada }),
        );
        assert!(exportada.exists());
        let _ = std::fs::remove_file(&exportada);
        ok(
            &j,
            "excluir_mes",
            json!({ "clienteId": id, "ano": 2026, "mes": 1 }),
        );
        ok(
            &j,
            "excluir_funcionario",
            json!({ "clienteId": id, "funcionarioId": f0 }),
        );

        // Erros chegam à interface como mensagem em texto.
        let erro = invocar(
            &j,
            "gerar_mes",
            json!({ "clienteId": id, "ano": 2026, "mes": 13 }),
        )
        .expect_err("erro");
        assert!(
            erro.as_str().is_some_and(|m| m.contains("mês 13 inválido")),
            "{erro}"
        );

        ok(&j, "excluir_cliente", json!({ "clienteId": id }));
        assert_eq!(ok(&j, "listar_clientes", json!({})), json!([]));
    }
}
