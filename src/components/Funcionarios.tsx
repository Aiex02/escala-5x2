import { useMemo, useState } from "react";
import { FileSpreadsheet, Pencil, Trash2, Users } from "lucide-react";
import { FuncionarioModal } from "./FuncionarioModal";
import { api, mensagemErro } from "../api/client";
import type { Funcionario } from "../api/types";
import { formatarPeriodo } from "../util/datas";
import { funcoesExistentes } from "../util/funcoes";
import { compararTexto, formatarHoras, normalizarTexto, pluralizar } from "../util/formato";
import { useCarregar } from "../util/useCarregar";
import { Botao, BotaoIcone } from "./base/Botao";
import { Busca } from "./base/Campo";
import { Interruptor } from "./base/Marcacao";
import { ChipPeriodo } from "./ChipPeriodo";
import { ConfirmModal } from "./Modal";
import { useNotificar } from "./Toast";
import { CabecalhoTela, Carregando, EstadoVazio, ErroCarregamento, Selo } from "./ui";

interface Props {
  clienteId: number;
  onIrImportar: () => void;
}

export function Funcionarios({ clienteId, onIrImportar }: Props) {
  const notificar = useNotificar();
  const { dados, erro, recarregar, definirDados } = useCarregar(async () => {
    const [funcionarios, config] = await Promise.all([api.listarFuncionarios(clienteId), api.obterConfiguracao(clienteId)]);
    return { funcionarios, limiteHoras: config.regras.cargaSemanalMaxHoras };
  }, [clienteId]);

  const [busca, setBusca] = useState("");
  const [pendentes, setPendentes] = useState<Set<number>>(new Set());
  const [excluindo, setExcluindo] = useState<Funcionario | null>(null);
  const [editando, setEditando] = useState<Funcionario | null>(null);

  const lista = useMemo(() => {
    const termo = normalizarTexto(busca);
    return [...(dados?.funcionarios ?? [])]
      .filter((f) => !termo || normalizarTexto(f.nome).includes(termo) || normalizarTexto(f.matricula).includes(termo) || normalizarTexto(f.cargo ?? "").includes(termo))
      .sort((a, b) => compararTexto(a.nome, b.nome));
  }, [dados?.funcionarios, busca]);

  const funcoes = useMemo(() => funcoesExistentes((dados?.funcionarios ?? []).map((f) => f.cargo)), [dados?.funcionarios]);

  if (!dados) {
    if (erro) return <ErroCarregamento mensagem={erro} onTentarNovamente={recarregar} />;
    return <Carregando texto="Carregando funcionários…" />;
  }

  async function alternarAtivo(f: Funcionario, ativo: boolean) {
    setPendentes((p) => new Set(p).add(f.id));
    try {
      await api.definirFuncionarioAtivo(clienteId, f.id, ativo);
      definirDados((d) => ({ ...d, funcionarios: d.funcionarios.map((x) => (x.id === f.id ? { ...x, ativo } : x)) }));
    } catch (e) {
      notificar.erro(mensagemErro(e));
    } finally {
      setPendentes((p) => {
        const novo = new Set(p);
        novo.delete(f.id);
        return novo;
      });
    }
  }

  async function excluir(f: Funcionario) {
    await api.excluirFuncionario(clienteId, f.id);
    definirDados((d) => ({ ...d, funcionarios: d.funcionarios.filter((x) => x.id !== f.id) }));
    notificar.sucesso(`${f.nome} foi excluído.`);
  }

  if (dados.funcionarios.length === 0) {
    return (
      <EstadoVazio
        icone={Users}
        titulo="Nenhum funcionário cadastrado"
        acao={
          <Botao variante="primario" icone={FileSpreadsheet} onClick={onIrImportar}>
            Importar planilha
          </Botao>
        }
      >
        Os funcionários deste cliente entram por uma planilha Excel com matrícula e nome.
      </EstadoVazio>
    );
  }

  const ativos = dados.funcionarios.filter((f) => f.ativo).length;

  return (
    <div className="tela">
      <CabecalhoTela
        titulo="Funcionários"
        acoes={
          <Botao icone={FileSpreadsheet} onClick={onIrImportar}>
            Importar planilha
          </Botao>
        }
      >
        <span>{pluralizar(dados.funcionarios.length, "cadastrado", "cadastrados")}</span>
        <span>{pluralizar(ativos, "ativo na escala", "ativos na escala")}</span>
      </CabecalhoTela>

      <section className="painel">
        <div className="painel-barra">
          <Busca id="busca-func" rotulo="Buscar funcionário" placeholder="Buscar por nome, matrícula ou cargo" valor={busca} onMudar={setBusca} className="busca-larga" />
        </div>
        <div className="tabela-rolagem">
          <table className="tabela tabela-funcionarios">
            <thead>
              <tr>
                <th scope="col">Funcionário</th>
                <th scope="col">Cargo</th>
                <th scope="col" data-dica="A escala atende a preferência quando houver vaga no período">
                  Preferência
                </th>
                <th scope="col">Carga</th>
                <th scope="col">Ausências</th>
                <th scope="col">Na escala</th>
                <th scope="col" className="coluna-acoes">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.length === 0 && (
                <tr>
                  <td colSpan={7} className="tabela-vazia">
                    Ninguém encontrado para “{busca}”.
                  </td>
                </tr>
              )}
              {lista.map((f) => (
                <tr key={f.id} className={f.ativo ? undefined : "inativo"}>
                  <th scope="row">
                    <span className="nome-linha">{f.nome}</span>
                    <span className="matricula-linha">{f.ctps ? `CTPS ${f.ctps}` : `Matrícula ${f.matricula}`}</span>
                  </th>
                  <td>{f.cargo ?? <span className="texto-fraco">—</span>}</td>
                  <td>
                    {f.preferencia ? (
                      <ChipPeriodo periodo={f.preferencia} />
                    ) : (
                      <span className="texto-fraco">Sem preferência</span>
                    )}
                  </td>
                  <td className="num-tab">
                    {f.cargaSemanalHoras === null ? (
                      <span className="texto-suave" data-dica={`Usa o limite do cliente (${formatarHoras(dados.limiteHoras)})`}>
                        {formatarHoras(dados.limiteHoras)}
                      </span>
                    ) : (
                      formatarHoras(f.cargaSemanalHoras)
                    )}
                  </td>
                  <td>
                    {f.ausencias.length === 0 ? (
                      <span className="texto-fraco">—</span>
                    ) : (
                      <Selo
                        tom="atencao"
                        dica={f.ausencias
                          .map((a) => `${formatarPeriodo(a.inicio, a.fim)}: ${a.justificada ? "justificada" : "falta"}${a.motivo ? ` (${a.motivo})` : ""}`)
                          .join("; ")}
                      >
                        {pluralizar(f.ausencias.length, "período", "períodos")}
                      </Selo>
                    )}
                  </td>
                  <td>
                    <Interruptor
                      ligado={f.ativo}
                      desabilitado={pendentes.has(f.id)}
                      rotuloAria={`${f.nome} entra na escala`}
                      onMudar={(v) => void alternarAtivo(f, v)}
                    />
                  </td>
                  <td className="coluna-acoes">
                    <div className="acoes-linha">
                      <BotaoIcone icone={Pencil} rotulo={`Editar ${f.nome}`} onClick={() => setEditando(f)} />
                      <BotaoIcone icone={Trash2} variante="perigo" rotulo={`Excluir ${f.nome}`} onClick={() => setExcluindo(f)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editando && (
        <FuncionarioModal
          clienteId={clienteId}
          funcionario={editando}
          limiteHoras={dados.limiteHoras}
          funcoes={funcoes}
          onSalvo={(salvo) => {
            definirDados((d) => ({ ...d, funcionarios: d.funcionarios.map((x) => (x.id === salvo.id ? salvo : x)) }));
            notificar.sucesso(`${salvo.nome} atualizado. Gere os meses de novo para aplicar.`);
          }}
          onFechar={() => setEditando(null)}
        />
      )}

      {excluindo && (
        <ConfirmModal titulo="Excluir funcionário" rotuloConfirmar="Excluir funcionário" perigo onConfirmar={() => excluir(excluindo)} onFechar={() => setExcluindo(null)}>
          <p>
            <strong>{excluindo.nome}</strong> (matrícula {excluindo.matricula}) sai do cadastro e de todas as escalas já geradas. Para só tirar da próxima escala, desligue
            “Na escala”.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
