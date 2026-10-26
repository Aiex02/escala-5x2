import { useState } from "react";
import { ChevronRight, Download, FileSpreadsheet, FolderOpen, ListChecks, Upload, Users } from "lucide-react";
import { api, emTauri, mensagemErro } from "../api/client";
import type { RelatorioImportacao } from "../api/types";
import { pluralizar } from "../util/formato";
import { Botao } from "./base/Botao";
import { Campo, Entrada } from "./base/Campo";
import { useNotificar } from "./Toast";
import { Alerta, CabecalhoTela, Selo } from "./ui";

interface Props {
  clienteId: number;
  onVerFuncionarios: () => void;
}

type Acao = "modelo" | "selecionar" | "validar" | "importar";

const FILTRO_EXCEL = [{ name: "Planilha do Excel", extensions: ["xlsx"] }];

// O plugin de diálogo só existe dentro do Tauri: importa sob demanda.
async function escolherPlanilha(): Promise<string | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const escolhido = await open({ multiple: false, directory: false, filters: FILTRO_EXCEL });
  return typeof escolhido === "string" ? escolhido : null;
}

async function escolherDestinoModelo(): Promise<string | null> {
  if (!emTauri) return "modelo_funcionarios.xlsx";
  const { save } = await import("@tauri-apps/plugin-dialog");
  return save({ defaultPath: "modelo_funcionarios.xlsx", filters: FILTRO_EXCEL });
}

function nomeArquivo(caminho: string): string {
  return caminho.split(/[\\/]/).pop() || caminho;
}

interface LinhaAjuda {
  coluna: string;
  obrigatoria: boolean;
  formato: string;
  exemplo: string;
}

const COLUNAS_FUNCIONARIOS: LinhaAjuda[] = [
  { coluna: "matricula", obrigatoria: true, formato: "Texto ou número, sem repetir", exemplo: "1001" },
  { coluna: "nome", obrigatoria: true, formato: "Texto", exemplo: "Ana Souza" },
  { coluna: "cargo", obrigatoria: false, formato: "Texto", exemplo: "Vigilante" },
  { coluna: "preferencia", obrigatoria: false, formato: "manhã, tarde ou noite; vazio = sem preferência", exemplo: "manhã" },
  { coluna: "carga_semanal", obrigatoria: false, formato: "Horas, até o limite do cliente", exemplo: "36" },
];

const COLUNAS_AUSENCIAS: LinhaAjuda[] = [
  { coluna: "matricula", obrigatoria: true, formato: "Matrícula de um funcionário", exemplo: "1001" },
  { coluna: "inicio", obrigatoria: true, formato: "Data dd/mm/aaaa", exemplo: "10/03/2026" },
  { coluna: "fim", obrigatoria: false, formato: "Data; se vazio, igual ao início", exemplo: "16/03/2026" },
  { coluna: "motivo", obrigatoria: false, formato: "Texto", exemplo: "Férias" },
  { coluna: "justificada", obrigatoria: false, formato: "sim ou não; vazio = sim. Justificada abona as horas do dia; não é falta e as horas ficam devendo", exemplo: "sim" },
];

export function Importacao({ clienteId, onVerFuncionarios }: Props) {
  const notificar = useNotificar();
  const [caminho, setCaminho] = useState("");
  const [acao, setAcao] = useState<Acao | null>(null);
  const [relatorio, setRelatorio] = useState<RelatorioImportacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ajudaAberta, setAjudaAberta] = useState(false);

  const ocupado = acao !== null;
  const semCaminho = caminho.trim() === "";

  async function baixarModelo() {
    setAcao("modelo");
    try {
      const destino = await escolherDestinoModelo();
      if (!destino) return;
      await api.salvarModeloPlanilha(destino);
      notificar.sucesso(`Modelo salvo em ${destino}.`);
    } catch (e) {
      notificar.erro(mensagemErro(e));
    } finally {
      setAcao(null);
    }
  }

  async function selecionar() {
    setAcao("selecionar");
    try {
      const escolhido = await escolherPlanilha();
      if (escolhido) {
        setCaminho(escolhido);
        setRelatorio(null);
        setErro(null);
      }
    } catch (e) {
      notificar.erro(mensagemErro(e));
    } finally {
      setAcao(null);
    }
  }

  async function executar(simular: boolean) {
    setAcao(simular ? "validar" : "importar");
    setErro(null);
    try {
      const r = await api.importarPlanilha(clienteId, caminho.trim(), simular);
      setRelatorio(r);
      if (simular) notificar.info("Planilha conferida. Nada foi gravado ainda.");
      else notificar.sucesso(`Importação concluída: ${pluralizar(r.importados.length, "funcionário", "funcionários")}.`);
    } catch (e) {
      setRelatorio(null);
      setErro(mensagemErro(e));
    } finally {
      setAcao(null);
    }
  }

  return (
    <div className="tela">
      <CabecalhoTela
        titulo="Importar planilha"
        acoes={
          <Botao icone={Download} carregando={acao === "modelo"} onClick={() => void baixarModelo()} disabled={ocupado && acao !== "modelo"}>
            Baixar modelo
          </Botao>
        }
      >
        <span>Só funcionários são importados: use a planilha modelo do app ou o Quadro de Horário de Trabalho da empresa (.xlsx).</span>
        <span>Os horários vêm de Configurações, em Funcionamento e jornada.</span>
      </CabecalhoTela>

      <section className="painel">
        <div className="arquivo">
          <span className="arquivo-icone" aria-hidden="true">
            <FileSpreadsheet size={26} strokeWidth={1.6} />
          </span>
          {emTauri ? (
            <div className="arquivo-info">
              <span className="arquivo-nome">{semCaminho ? "Nenhuma planilha escolhida" : nomeArquivo(caminho)}</span>
              <span className="arquivo-caminho">{semCaminho ? "Escolha um arquivo .xlsx no computador." : caminho}</span>
            </div>
          ) : (
            <Campo id="caminho-planilha" rotulo="Caminho da planilha" dica="Fora do app desktop não há seletor de arquivos; a demonstração ignora o conteúdo." className="arquivo-info">
              <Entrada id="caminho-planilha" value={caminho} placeholder="/caminho/para/funcionarios.xlsx" onChange={(e) => (setCaminho(e.target.value), setErro(null))} />
            </Campo>
          )}
          {emTauri && (
            <Botao icone={FolderOpen} carregando={acao === "selecionar"} disabled={ocupado && acao !== "selecionar"} onClick={() => void selecionar()}>
              {semCaminho ? "Escolher arquivo" : "Trocar arquivo"}
            </Botao>
          )}
        </div>
        <div className="arquivo-acoes">
          <span className="arquivo-acoes-espaco" />
          <Botao icone={ListChecks} carregando={acao === "validar"} disabled={semCaminho || (ocupado && acao !== "validar")} onClick={() => void executar(true)}>
            Conferir sem gravar
          </Botao>
          <Botao variante="primario" icone={Upload} carregando={acao === "importar"} disabled={semCaminho || (ocupado && acao !== "importar")} onClick={() => void executar(false)}>
            Importar
          </Botao>
        </div>
        {erro && (
          <div className="painel-corpo">
            <Alerta tipo="erro">{erro}</Alerta>
          </div>
        )}
      </section>

      {relatorio && <Relatorio relatorio={relatorio} onVerFuncionarios={onVerFuncionarios} />}

      <section className="painel">
        <button type="button" className="painel-cab painel-cab-botao" aria-expanded={ajudaAberta} onClick={() => setAjudaAberta((a) => !a)}>
          <ChevronRight className="arvore-seta" size={15} strokeWidth={2} aria-hidden="true" />
          <h2>Colunas que a planilha precisa ter</h2>
        </button>
        {ajudaAberta && (
          <div className="painel-corpo ajuda">
            <h3>Quadro de Horário de Trabalho</h3>
            <p>
              O quadro que a empresa já usa (Cód., Nome, Função, Seção, Número e Série da CTPS, Entrada, Intervalo, Saída e Descanso), inclusive convertido de PDF para
              Excel. Só os dados das pessoas são lidos: nome, função, seção e CTPS, que identifica o funcionário. Os horários do quadro não são importados.
            </p>
            <h3>Planilha modelo do app</h3>
            <p>
              Aba <strong>Funcionarios</strong> (ou a primeira aba), com os nomes das colunas na primeira linha. Maiúsculas e acentos não importam. Matrículas já
              cadastradas são atualizadas; quem não estiver na planilha continua cadastrado.
            </p>
            <TabelaAjuda linhas={COLUNAS_FUNCIONARIOS} />
            <p>
              Colunas de horário (<code>turno</code>, <code>entrada</code>, <code>saída</code>, <code>intervalo</code> e <code>dias</code>) são ignoradas, com um aviso. Os
              horários da escala vêm de Configurações, em Funcionamento e jornada.
            </p>
            <h3>Aba Ausencias (opcional)</h3>
            <TabelaAjuda linhas={COLUNAS_AUSENCIAS} />
          </div>
        )}
      </section>
    </div>
  );
}

function TabelaAjuda({ linhas }: { linhas: LinhaAjuda[] }) {
  return (
    <div className="tabela-rolagem">
      <table className="tabela tabela-compacta">
        <thead>
          <tr>
            <th scope="col">Coluna</th>
            <th scope="col">Formato</th>
            <th scope="col">Exemplo</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.coluna}>
              <th scope="row">
                <code>{l.coluna}</code>
                {l.obrigatoria && <Selo tom="destaque">obrigatória</Selo>}
              </th>
              <td>{l.formato}</td>
              <td className="texto-suave">{l.exemplo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Relatorio({ relatorio, onVerFuncionarios }: { relatorio: RelatorioImportacao; onVerFuncionarios: () => void }) {
  const { importados, rejeitados, avisos } = relatorio;
  return (
    <section className="painel" aria-labelledby="titulo-relatorio">
      <header className="painel-cab">
        <div>
          <h2 id="titulo-relatorio">
            {relatorio.simulacao ? "Conferência" : "Importação"} de {relatorio.arquivo}
          </h2>
          <p className="painel-sub">
            {relatorio.formato === "quadro" ? `Quadro de Horário de Trabalho${relatorio.empregador ? ` de ${relatorio.empregador}` : ""}` : "Planilha modelo do app"}
          </p>
        </div>
        {!relatorio.simulacao && (
          <Botao tamanho="p" icone={Users} onClick={onVerFuncionarios}>
            Ver funcionários
          </Botao>
        )}
      </header>
      <div className="painel-corpo relatorio">
        {relatorio.simulacao ? (
          <Alerta tipo="info">Nada foi gravado. Se estiver tudo certo, clique em Importar.</Alerta>
        ) : (
          <Alerta tipo="sucesso">Os dados foram gravados.</Alerta>
        )}

        <dl className="numeros">
          <div>
            <dt>Linhas lidas</dt>
            <dd>{relatorio.totalLinhas}</dd>
          </div>
          <div>
            <dt>{relatorio.simulacao ? "Prontos para importar" : "Importados"}</dt>
            <dd className="texto-sucesso">{importados.length}</dd>
          </div>
          <div>
            <dt>Recusados</dt>
            <dd className={rejeitados.length > 0 ? "texto-erro" : undefined}>{rejeitados.length}</dd>
          </div>
          <div>
            <dt>Ausências</dt>
            <dd>{relatorio.ausenciasImportadas}</dd>
          </div>
        </dl>

        {avisos.length > 0 && (
          <Alerta tipo="atencao">
            <ul className="lista-simples">
              {avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </Alerta>
        )}

        {rejeitados.length > 0 && (
          <>
            <h3>Linhas recusadas</h3>
            <div className="tabela-rolagem">
              <table className="tabela tabela-compacta">
                <thead>
                  <tr>
                    <th scope="col">Aba</th>
                    <th scope="col" className="num">
                      Linha
                    </th>
                    <th scope="col">Matrícula</th>
                    <th scope="col">O que corrigir</th>
                  </tr>
                </thead>
                <tbody>
                  {rejeitados.map((l, i) => (
                    <tr key={i}>
                      <td>{l.planilha}</td>
                      <td className="num">{l.linha}</td>
                      <td>{l.matricula ?? <span className="texto-fraco">—</span>}</td>
                      <td>
                        <ul className="lista-simples lista-erros">
                          {l.erros.map((e, j) => (
                            <li key={j}>{e}</li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        <h3>{relatorio.simulacao ? "Funcionários prontos para importar" : "Funcionários importados"}</h3>
        {importados.length === 0 ? (
          <p className="texto-suave">Nenhuma linha válida.</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  <th scope="col" className="num">
                    Linha
                  </th>
                  <th scope="col">Matrícula</th>
                  <th scope="col">Nome</th>
                  <th scope="col">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {importados.map((l) => (
                  <tr key={`${l.linha}-${l.matricula}`}>
                    <td className="num">{l.linha}</td>
                    <td>{l.matricula}</td>
                    <td>{l.nome}</td>
                    <td>
                      <Selo tom={l.acao === "criado" ? "sucesso" : "neutro"}>{l.acao === "criado" ? "Novo" : "Atualizado"}</Selo>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
