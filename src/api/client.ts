// Camada fina sobre os comandos Tauri. Componentes nunca chamam `invoke`
// diretamente: usam `api.*`, que devolve Promises tipadas. Falhas do backend
// chegam como string (mensagem em português) e são normalizadas por `mensagemErro`.
//
// Fora do Tauri (ex.: `npm run dev` aberto no navegador) usa-se um backend
// simulado em memória (`mock.ts`) para permitir desenvolver a interface.

import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AgendaMes,
  Cliente,
  DiaQuadro,
  Configuracao,
  ConfiguracaoEntrada,
  Funcao,
  FuncionamentoEntrada,
  Funcionario,
  FuncionarioEdicao,
  MesGerado,
  ModeloFuncionamento,
  ResultadoReequilibrio,
  Regras,
  RelatorioImportacao,
  ResultadoGeracao,
  Turno,
  TurnoEntrada,
} from "./types";

export interface Backend {
  listarClientes(): Promise<Cliente[]>;
  /** Sem `modelo`, o cliente nasce com o modelo padrão (shopping). */
  criarCliente(nome: string, modelo?: string | null): Promise<Cliente>;
  renomearCliente(clienteId: number, nome: string): Promise<Cliente>;
  excluirCliente(clienteId: number): Promise<void>;

  obterConfiguracao(clienteId: number): Promise<Configuracao>;
  listarModelos(): Promise<ModeloFuncionamento[]>;
  /** Grava o mínimo por turno de cada função; devolve as funções atualizadas. */
  salvarFuncoes(clienteId: number, funcoes: { chave: string; minimo: number }[]): Promise<Funcao[]>;
  /** Salva modelo ou configuração personalizada (regras + funcionamento) e refaz os turnos. */
  salvarConfiguracao(clienteId: number, entrada: ConfiguracaoEntrada): Promise<Configuracao>;
  salvarRegras(clienteId: number, regras: Regras): Promise<Regras>;
  /** Grava o funcionamento e a jornada e recalcula os turnos; devolve a configuração nova. */
  salvarFuncionamento(clienteId: number, entrada: FuncionamentoEntrada): Promise<Configuracao>;
  salvarTurno(clienteId: number, turno: TurnoEntrada): Promise<Turno>;
  excluirTurno(clienteId: number, turnoId: number): Promise<void>;

  listarFuncionarios(clienteId: number): Promise<Funcionario[]>;
  definirFuncionarioAtivo(clienteId: number, funcionarioId: number, ativo: boolean): Promise<void>;
  excluirFuncionario(clienteId: number, funcionarioId: number): Promise<void>;
  /** Altera cargo, carga, dias disponíveis e horários permitidos; devolve o funcionário atualizado. */
  salvarFuncionario(clienteId: number, funcionarioId: number, dados: FuncionarioEdicao): Promise<Funcionario>;

  /** `simular = true` valida e devolve o relatório sem gravar nada. Aceita a planilha modelo ou o Quadro de Horário de Trabalho. */
  /** Importa só funcionários (planilha modelo ou Quadro de Horário); horários não são importados. */
  importarPlanilha(clienteId: number, caminho: string, simular: boolean): Promise<RelatorioImportacao>;
  /** Grava em `caminho` uma planilha modelo com as colunas esperadas. */
  salvarModeloPlanilha(caminho: string): Promise<void>;

  listarMeses(clienteId: number): Promise<MesGerado[]>;
  /** Gera (ou regenera, substituindo) a escala do mês. */
  gerarMes(clienteId: number, ano: number, mes: number): Promise<ResultadoGeracao>;
  excluirMes(clienteId: number, ano: number, mes: number): Promise<void>;
  obterAgenda(clienteId: number, ano: number, mes: number): Promise<AgendaMes>;
  /** Ajuste manual de um dia: põe a pessoa no turno ou dá folga (`turnoId = null`). Devolve a agenda do mês. */
  /** Ajuste no Quadro de um mês gerado: turno, folga ou ausência do dia. Devolve o mês recalculado. */
  definirDia(clienteId: number, funcionarioId: number, data: string, dia: DiaQuadro): Promise<AgendaMes>;
  /**
   * Refaz o mês a partir de `aPartir` ("YYYY-MM-DD"), mantendo os dias anteriores e os dias
   * ajustados à mão, e compensa o saldo dentro das regras. `seguintes`: refaz também os meses
   * gerados depois (do dia 1, mantendo os ajustes deles).
   */
  reequilibrar(clienteId: number, ano: number, mes: number, aPartir: string, seguintes: boolean): Promise<ResultadoReequilibrio>;
  /** Grava a escala do mês em Excel (.xlsx) em `caminho`. */
  exportarEscala(clienteId: number, ano: number, mes: number, caminho: string): Promise<void>;
}

const backendTauri: Backend = {
  listarClientes: () => invoke("listar_clientes"),
  criarCliente: (nome, modelo) => invoke("criar_cliente", { nome, modelo: modelo ?? null }),
  renomearCliente: (clienteId, nome) => invoke("renomear_cliente", { clienteId, nome }),
  excluirCliente: (clienteId) => invoke("excluir_cliente", { clienteId }),

  obterConfiguracao: (clienteId) => invoke("obter_configuracao", { clienteId }),
  listarModelos: () => invoke("listar_modelos"),
  salvarFuncoes: (clienteId, funcoes) => invoke("salvar_funcoes", { clienteId, funcoes }),
  salvarConfiguracao: (clienteId, entrada) => invoke("salvar_configuracao", { clienteId, entrada }),
  salvarRegras: (clienteId, regras) => invoke("salvar_regras", { clienteId, regras }),
  salvarFuncionamento: (clienteId, entrada) => invoke("salvar_funcionamento", { clienteId, entrada }),
  salvarTurno: (clienteId, turno) => invoke("salvar_turno", { clienteId, turno }),
  excluirTurno: (clienteId, turnoId) => invoke("excluir_turno", { clienteId, turnoId }),

  listarFuncionarios: (clienteId) => invoke("listar_funcionarios", { clienteId }),
  definirFuncionarioAtivo: (clienteId, funcionarioId, ativo) =>
    invoke("definir_funcionario_ativo", { clienteId, funcionarioId, ativo }),
  excluirFuncionario: (clienteId, funcionarioId) =>
    invoke("excluir_funcionario", { clienteId, funcionarioId }),
  salvarFuncionario: (clienteId, funcionarioId, dados) =>
    invoke("salvar_funcionario", { clienteId, funcionarioId, dados }),

  importarPlanilha: (clienteId, caminho, simular) => invoke("importar_planilha", { clienteId, caminho, simular }),
  salvarModeloPlanilha: (caminho) => invoke("salvar_modelo_planilha", { caminho }),

  listarMeses: (clienteId) => invoke("listar_meses", { clienteId }),
  gerarMes: (clienteId, ano, mes) => invoke("gerar_mes", { clienteId, ano, mes }),
  excluirMes: (clienteId, ano, mes) => invoke("excluir_mes", { clienteId, ano, mes }),
  obterAgenda: (clienteId, ano, mes) => invoke("obter_agenda", { clienteId, ano, mes }),
  exportarEscala: (clienteId, ano, mes, caminho) => invoke("exportar_escala", { clienteId, ano, mes, caminho }),
  definirDia: (clienteId, funcionarioId, data, dia) => invoke("definir_dia", { clienteId, funcionarioId, data, dia }),
  reequilibrar: (clienteId, ano, mes, aPartir, seguintes) => invoke("reequilibrar", { clienteId, ano, mes, aPartir, seguintes }),
};

export const emTauri = isTauri();

async function carregarBackend(): Promise<Backend> {
  if (emTauri) return backendTauri;
  const { criarBackendSimulado } = await import("./mock");
  return criarBackendSimulado();
}

const backendPromise = carregarBackend();

/** Proxy que resolve o backend correto na primeira chamada. */
export const api: Backend = new Proxy({} as Backend, {
  get(_alvo, prop: string) {
    return async (...args: unknown[]) => {
      const backend = await backendPromise;
      const fn = (backend as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[prop];
      if (typeof fn !== "function") throw new Error(`Operação desconhecida: ${prop}`);
      return fn(...args);
    };
  },
});

/** Converte qualquer erro vindo do backend em mensagem legível. */
export function mensagemErro(erro: unknown): string {
  if (typeof erro === "string") return erro;
  if (erro instanceof Error) return erro.message;
  if (erro && typeof erro === "object" && "mensagem" in erro) {
    return String((erro as { mensagem: unknown }).mensagem);
  }
  return "Erro inesperado.";
}
