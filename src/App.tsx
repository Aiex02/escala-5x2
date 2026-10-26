import { useCallback, useEffect, useState } from "react";
import { Building2, CalendarDays, CalendarPlus, Plus, RotateCw } from "lucide-react";
import { api, mensagemErro } from "./api/client";
import type { Cliente, MesGerado, ModeloFuncionamento, ResultadoReequilibrio } from "./api/types";
import { Agenda } from "./components/agenda/Agenda";
import { Botao } from "./components/base/Botao";
import { CamadaDicas } from "./components/base/Dicas";
import { ClienteDialogos, type DialogoCliente } from "./components/ClienteDialogos";
import { Configuracoes } from "./components/Configuracoes";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Funcionarios } from "./components/Funcionarios";
import { GerarMesModal } from "./components/GerarMesModal";
import { Importacao } from "./components/Importacao";
import { Sidebar } from "./components/Sidebar";
import { ToastProvider, useNotificar } from "./components/Toast";
import { Carregando, EstadoVazio } from "./components/ui";
import { gravarArmazenado, lerArmazenado } from "./util/armazenamento";
import { hojeISO, separarData, tituloMes } from "./util/datas";
import { pluralizar } from "./util/formato";
import type { MesRef, Tela } from "./util/tipos";

const CHAVE_CLIENTE = "organizador-escalas.ultimoCliente";

function lerClienteSalvo(): number | null {
  const valor = Number(lerArmazenado(CHAVE_CLIENTE));
  return Number.isInteger(valor) && valor > 0 ? valor : null;
}

export function App() {
  return (
    <ToastProvider>
      <Aplicativo />
      <CamadaDicas />
    </ToastProvider>
  );
}

function Aplicativo() {
  const notificar = useNotificar();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregandoClientes, setCarregandoClientes] = useState(true);
  const [erroClientes, setErroClientes] = useState<string | null>(null);
  const [clienteId, setClienteId] = useState<number | null>(null);

  const [meses, setMeses] = useState<MesGerado[]>([]);
  const [carregandoMeses, setCarregandoMeses] = useState(false);
  const [erroMeses, setErroMeses] = useState<string | null>(null);
  const [mesSelecionado, setMesSelecionado] = useState<MesRef | null>(null);
  const [versaoAgenda, setVersaoAgenda] = useState(0);

  const [tela, setTela] = useState<Tela>("agenda");
  const [dialogo, setDialogo] = useState<DialogoCliente>(null);
  const [nomeSugerido, setNomeSugerido] = useState("");
  const [gerandoMes, setGerandoMes] = useState(false);

  const clienteAtual = clientes.find((c) => c.id === clienteId) ?? null;

  /** Lê os clientes e escolhe qual fica selecionado (preferido > atual > salvo > primeiro). */
  const carregarClientes = useCallback(async (preferido?: number) => {
    const lista = await api.listarClientes();
    setClientes(lista);
    setClienteId((atual) => {
      const desejado = preferido ?? atual ?? lerClienteSalvo();
      return lista.some((c) => c.id === desejado) ? desejado : (lista[0]?.id ?? null);
    });
  }, []);

  const tentarCarregarClientes = useCallback(() => {
    setCarregandoClientes(true);
    setErroClientes(null);
    carregarClientes()
      .catch((e: unknown) => setErroClientes(mensagemErro(e)))
      .finally(() => setCarregandoClientes(false));
  }, [carregarClientes]);

  useEffect(tentarCarregarClientes, [tentarCarregarClientes]);

  // Trocar de cliente limpa a seleção de mês e recarrega a árvore.
  useEffect(() => {
    gravarArmazenado(CHAVE_CLIENTE, clienteId === null ? null : String(clienteId));
    setMesSelecionado(null);
    setMeses([]);
    setErroMeses(null);
    if (clienteId === null) return;
    let cancelado = false;
    setCarregandoMeses(true);
    api
      .listarMeses(clienteId)
      .then((lista) => {
        if (cancelado) return;
        setMeses(lista);
        // Abre direto o mês corrente quando ele já foi gerado.
        const { ano, mes } = separarData(hojeISO());
        if (lista.some((m) => m.ano === ano && m.mes === mes)) setMesSelecionado({ ano, mes });
      })
      .catch((e: unknown) => {
        if (!cancelado) setErroMeses(mensagemErro(e));
      })
      .finally(() => {
        if (!cancelado) setCarregandoMeses(false);
      });
    return () => {
      cancelado = true;
    };
  }, [clienteId]);

  const recarregarMeses = useCallback(async (id: number) => {
    try {
      setMeses(await api.listarMeses(id));
      setErroMeses(null);
    } catch (e) {
      setErroMeses(mensagemErro(e));
    }
  }, []);

  /** Gera (ou gera de novo) um mês e abre a agenda dele. Lança em caso de erro. */
  const gerarMes = useCallback(
    async (ano: number, mes: number) => {
      if (clienteId === null) throw new Error("Nenhum cliente selecionado.");
      const resultado = await api.gerarMes(clienteId, ano, mes);
      await recarregarMeses(clienteId);
      setMesSelecionado({ ano, mes });
      setTela("agenda");
      setVersaoAgenda((v) => v + 1);
      const avisos = resultado.avisos.length;
      notificar.sucesso(
        `Escala de ${tituloMes(ano, mes)} gerada: ${pluralizar(resultado.totalAlocacoes, "plantão", "plantões")}${avisos > 0 ? `, ${pluralizar(avisos, "aviso", "avisos")}` : ", sem avisos"}.`,
      );
    },
    [clienteId, recarregarMeses, notificar],
  );

  const excluirMes = useCallback(
    async (ano: number, mes: number) => {
      if (clienteId === null) return;
      await api.excluirMes(clienteId, ano, mes);
      setMesSelecionado(null);
      await recarregarMeses(clienteId);
      notificar.sucesso(`Escala de ${tituloMes(ano, mes)} excluída.`);
    },
    [clienteId, recarregarMeses, notificar],
  );

  /** Reequilibra um mês (e, se pedido, os seguintes) e atualiza a árvore de meses. Lança em caso de erro. */
  const reequilibrarMes = useCallback(
    async (ano: number, mes: number, aPartir: string, seguintes: boolean): Promise<ResultadoReequilibrio> => {
      if (clienteId === null) throw new Error("Nenhum cliente selecionado.");
      const resultado = await api.reequilibrar(clienteId, ano, mes, aPartir, seguintes);
      await recarregarMeses(clienteId);
      return resultado;
    },
    [clienteId, recarregarMeses],
  );

  function abrirNovoCliente(nome?: string) {
    setNomeSugerido(nome ?? "");
    setDialogo("criar");
  }

  async function criarCliente(nome: string, modelo: ModeloFuncionamento | null) {
    // O backend cria o cliente já com o modelo (sem escolha, o padrão): horário, jornada, regras e turnos.
    const novo = await api.criarCliente(nome, modelo?.id ?? null);
    await carregarClientes(novo.id);
    setTela("agenda");
    notificar.sucesso(modelo ? `Cliente “${novo.nome}” criado com o modelo “${modelo.nome}”.` : `Cliente “${novo.nome}” criado.`);
  }

  async function renomearCliente(nome: string) {
    if (clienteId === null) return;
    const atualizado = await api.renomearCliente(clienteId, nome);
    await carregarClientes(atualizado.id);
    notificar.sucesso("Cliente renomeado.");
  }

  async function excluirCliente() {
    if (clienteId === null) return;
    await api.excluirCliente(clienteId);
    await carregarClientes();
    notificar.sucesso("Cliente excluído.");
  }

  function selecionarMes(ano: number, mes: number) {
    setMesSelecionado({ ano, mes });
    setTela("agenda");
  }

  function renderizarTela() {
    if (clienteId === null) {
      return (
        <EstadoVazio
          icone={Building2}
          titulo="Comece cadastrando um cliente"
          acao={
            <Botao variante="primario" icone={Plus} onClick={() => abrirNovoCliente()}>
              Novo cliente
            </Botao>
          }
        >
          Cada cliente tem seus próprios turnos, funcionários e escalas mensais.
        </EstadoVazio>
      );
    }
    switch (tela) {
      case "agenda":
        return mesSelecionado ? (
          <Agenda
            key={`${clienteId}-${mesSelecionado.ano}-${mesSelecionado.mes}`}
            clienteId={clienteId}
            ano={mesSelecionado.ano}
            mes={mesSelecionado.mes}
            versao={versaoAgenda}
            onGerar={gerarMes}
            onExcluirMes={excluirMes}
            meses={meses}
            onReequilibrar={reequilibrarMes}
          />
        ) : (
          <EstadoVazio
            icone={CalendarDays}
            titulo={meses.length > 0 ? "Escolha uma escala" : "Nenhuma escala gerada"}
            acao={
              <Botao variante="primario" icone={CalendarPlus} onClick={() => setGerandoMes(true)}>
                Nova escala
              </Botao>
            }
          >
            {meses.length > 0
              ? "Abra um mês na barra lateral ou gere a escala de um mês novo."
              : "Importe os funcionários e gere a escala do primeiro mês."}
          </EstadoVazio>
        );
      case "funcionarios":
        return <Funcionarios key={clienteId} clienteId={clienteId} onIrImportar={() => setTela("importar")} />;
      case "importar":
        return <Importacao key={clienteId} clienteId={clienteId} onVerFuncionarios={() => setTela("funcionarios")} />;
      case "config":
        return <Configuracoes key={clienteId} clienteId={clienteId} />;
    }
  }

  if (carregandoClientes) {
    return (
      <div className="tela-cheia">
        <Carregando texto="Abrindo…" />
      </div>
    );
  }

  if (erroClientes) {
    return (
      <div className="tela-cheia">
        <EstadoVazio
          titulo="Não foi possível abrir os dados"
          acao={
            <Botao variante="primario" icone={RotateCw} onClick={tentarCarregarClientes}>
              Tentar de novo
            </Botao>
          }
        >
          {erroClientes}
        </EstadoVazio>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        clientes={clientes}
        clienteId={clienteId}
        onSelecionarCliente={setClienteId}
        onNovoCliente={abrirNovoCliente}
        onRenomearCliente={() => setDialogo("renomear")}
        onExcluirCliente={() => setDialogo("excluir")}
        meses={meses}
        carregandoMeses={carregandoMeses}
        erroMeses={erroMeses}
        mesSelecionado={mesSelecionado}
        onSelecionarMes={selecionarMes}
        onNovoMes={() => setGerandoMes(true)}
        tela={tela}
        onNavegar={setTela}
      />
      <main className="principal">
        <ErrorBoundary key={`${clienteId}-${tela}`}>{renderizarTela()}</ErrorBoundary>
      </main>
      <ClienteDialogos
        dialogo={dialogo}
        cliente={clienteAtual}
        nomeSugerido={nomeSugerido}
        onFechar={() => setDialogo(null)}
        onCriar={criarCliente}
        onRenomear={renomearCliente}
        onExcluir={excluirCliente}
      />
      {gerandoMes && clienteAtual && (
        <GerarMesModal nomeCliente={clienteAtual.nome} meses={meses} onGerar={gerarMes} onFechar={() => setGerandoMes(false)} />
      )}
    </div>
  );
}
