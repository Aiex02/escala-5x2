import { api } from "../api/client";
import { useCarregar } from "../util/useCarregar";
import { useModelos } from "../util/useModelos";
import { ConfiguracaoForm } from "./ConfiguracaoForm";
import { FuncoesPorTurno } from "./FuncoesPorTurno";
import { Turnos } from "./Turnos";
import { CabecalhoTela, Carregando, ErroCarregamento } from "./ui";

export function Configuracoes({ clienteId }: { clienteId: number }) {
  const configuracao = useCarregar(() => api.obterConfiguracao(clienteId), [clienteId]);
  const modelos = useModelos();
  const { dados, definirDados } = configuracao;

  if (!dados || !modelos.dados) {
    const erro = configuracao.erro ?? modelos.erro;
    if (erro) {
      return (
        <ErroCarregamento
          mensagem={erro}
          onTentarNovamente={() => {
            configuracao.recarregar();
            modelos.recarregar();
          }}
        />
      );
    }
    return <Carregando texto="Carregando configurações…" />;
  }

  return (
    <div className="tela">
      <CabecalhoTela titulo="Configurações">
        <span>Modelo de funcionamento, jornada, regras do fim da escala 6x1 e turnos deste cliente.</span>
      </CabecalhoTela>
      {/* Salvar recria os turnos: a configuração devolvida substitui a carregada, e a lista de turnos abaixo acompanha. */}
      <ConfiguracaoForm clienteId={clienteId} configuracao={dados} modelos={modelos.dados} onSalvo={(nova) => definirDados(() => nova)} />
      <FuncoesPorTurno clienteId={clienteId} funcoes={dados.funcoes} turnos={dados.turnos.length} onSalvo={(funcoes) => definirDados((d) => ({ ...d, funcoes }))} />
      <Turnos
        clienteId={clienteId}
        turnos={dados.turnos}
        // Criar ou excluir turnos muda quantas pessoas cada função precisa: o backend recalcula, então a configuração é lida de novo.
        onMudar={(atualizar) => {
          definirDados((d) => ({ ...d, turnos: atualizar(d.turnos) }));
          configuracao.recarregar();
        }}
        jornadaMaxHoras={dados.regras.jornadaDiariaMaxHoras}
      />
    </div>
  );
}
