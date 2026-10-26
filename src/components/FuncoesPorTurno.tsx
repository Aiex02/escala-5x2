import { useMemo, useState, type FormEvent } from "react";
import { Save, TriangleAlert } from "lucide-react";
import { api, mensagemErro } from "../api/client";
import type { Funcao } from "../api/types";
import { compararTexto, pluralizar } from "../util/formato";
import { Botao } from "./base/Botao";
import { CampoNumero, lerNumero } from "./base/CampoNumero";
import { useNotificar } from "./Toast";
import { Alerta, Selo } from "./ui";

const MINIMO_MAX = 20;

interface Props {
  clienteId: number;
  /** Funções dos funcionários ativos, com o mínimo salvo. */
  funcoes: Funcao[];
  /** Quantidade de turnos em uso (para explicar quantas pessoas a função precisa). */
  turnos: number;
  onSalvo: (funcoes: Funcao[]) => void;
}

/** Mínimo digitado: inteiro de 0 a 20, ou NaN. */
function lerMinimo(texto: string): number {
  const n = lerNumero(texto);
  return Number.isInteger(n) && n >= 0 && n <= MINIMO_MAX ? n : NaN;
}

/** A função tem gente de menos para o mínimo salvo em todos os turnos? */
function faltaGente(f: Funcao): boolean {
  return f.minimo > 0 && f.pessoas < f.pessoasNecessarias;
}

function textoNecessarias(f: Funcao, turnos: number): string {
  const cobrir = turnos === 1 ? "o turno" : `os ${turnos} turnos`;
  return `Precisa de ${pluralizar(f.pessoasNecessarias, "pessoa", "pessoas")} para cobrir ${cobrir} todos os dias; tem ${f.pessoas}`;
}

/**
 * Funções por turno: para cada cargo dos funcionários ativos, quantas pessoas dele cada turno de cada dia
 * deve ter. A tabela já avisa quando a equipe não alcança esse mínimo com as folgas da regra final.
 */
export function FuncoesPorTurno({ clienteId, funcoes, turnos, onSalvo }: Props) {
  const notificar = useNotificar();
  // Mínimos digitados e ainda não salvos, por chave da função.
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);

  const ordenadas = useMemo(() => [...funcoes].sort((a, b) => compararTexto(a.nome, b.nome)), [funcoes]);

  const textoDe = (f: Funcao) => rascunho[f.chave] ?? String(f.minimo);
  const minimoDe = (f: Funcao) => lerMinimo(textoDe(f));
  const alterada = (f: Funcao) => rascunho[f.chave] !== undefined && minimoDe(f) !== f.minimo;

  const invalido = funcoes.some((f) => Number.isNaN(minimoDe(f)));
  const alterado = funcoes.some(alterada);
  const comFalta = funcoes.filter((f) => !alterada(f) && faltaGente(f));

  function mudar(chave: string, texto: string) {
    setErroServidor(null);
    setRascunho((r) => ({ ...r, [chave]: texto }));
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (invalido || !alterado) return;
    setSalvando(true);
    setErroServidor(null);
    try {
      const salvas = await api.salvarFuncoes(
        clienteId,
        funcoes.map((f) => ({ chave: f.chave, minimo: minimoDe(f) })),
      );
      setRascunho({});
      onSalvo(salvas);
      notificar.sucesso("Mínimos por função salvos. Gere os meses de novo para aplicar.");
    } catch (err) {
      setErroServidor(mensagemErro(err));
    } finally {
      setSalvando(false);
    }
  }

  function situacao(f: Funcao) {
    const minimo = minimoDe(f);
    if (Number.isNaN(minimo)) return <span className="funcao-situacao funcao-situacao-erro">Use um número de 0 a {MINIMO_MAX}.</span>;
    if (minimo === 0) return <span className="texto-fraco">Sem exigência</span>;
    // O cálculo de quem é necessário vem do backend com o mínimo salvo: mudou, só depois de salvar.
    if (alterada(f)) return <span className="texto-suave">Salve para calcular quantas pessoas são necessárias.</span>;
    if (faltaGente(f)) {
      return (
        <span className="funcao-situacao funcao-situacao-atencao">
          <TriangleAlert size={15} strokeWidth={2} aria-hidden="true" />
          {textoNecessarias(f, turnos)}
        </span>
      );
    }
    return (
      <Selo tom="sucesso" dica={textoNecessarias(f, turnos)}>
        Equipe suficiente
      </Selo>
    );
  }

  const textoRodape = invalido ? "Corrija os campos em destaque para salvar." : alterado ? "Há alterações não salvas." : "Tudo salvo.";

  return (
    <form className="painel" onSubmit={(e) => void salvar(e)} noValidate aria-labelledby="titulo-funcoes">
      <header className="painel-cab">
        <div>
          <h2 id="titulo-funcoes">Funções por turno</h2>
          <p className="painel-sub">
            Ao gerar o mês, cada turno de cada dia recebe ao menos esta quantidade de pessoas de cada função (por exemplo, uma cafeteria com 1 atendente e 1 cozinheiro por turno). Funções
            com pessoas de menos geram avisos na agenda. Use 0 nas funções que não precisam estar em todo turno, como uma gerente só.
          </p>
        </div>
      </header>

      {funcoes.length === 0 ? (
        <p className="painel-corpo texto-suave">
          Nenhum funcionário ativo tem função cadastrada. Preencha “Função” em Funcionários para exigir um mínimo de cada função em cada turno.
        </p>
      ) : (
        <>
          <div className="tabela-rolagem">
            <table className="tabela tabela-funcoes">
              <colgroup>
                <col className="col-funcao" />
                <col className="col-pessoas" />
                <col className="col-minimo" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Função</th>
                  <th scope="col" className="num" data-dica="Funcionários ativos com essa função">
                    Pessoas ativas
                  </th>
                  <th scope="col" data-dica="Pessoas da função em cada turno de cada dia (0 = sem exigência)">
                    Mínimo por turno
                  </th>
                  <th scope="col">Situação</th>
                </tr>
              </thead>
              <tbody>
                {ordenadas.map((f) => (
                  <tr key={f.chave}>
                    <th scope="row">{f.nome}</th>
                    <td className="num">{f.pessoas}</td>
                    <td>
                      <div className="campo-minimo">
                        <CampoNumero
                          id={`funcao-minimo-${f.chave}`}
                          valor={textoDe(f)}
                          onMudar={(texto) => mudar(f.chave, texto)}
                          max={MINIMO_MAX}
                          invalido={Number.isNaN(minimoDe(f))}
                          rotuloAria={`Mínimo por turno de ${f.nome}`}
                        />
                      </div>
                    </td>
                    <td>{situacao(f)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {erroServidor && (
            <div className="painel-corpo painel-corpo-dividido">
              <Alerta tipo="erro">{erroServidor}</Alerta>
            </div>
          )}

          <footer className="painel-rodape">
            <span className="texto-suave">{textoRodape}</span>
            <div className="rodape-acoes">
              {comFalta.length > 0 && (
                <Selo tom="atencao" dica="Com os mínimos salvos, a escala gera avisos nos dias em que a função não tiver gente suficiente.">
                  {pluralizar(comFalta.length, "função com pessoas a menos", "funções com pessoas a menos")}
                </Selo>
              )}
              <Botao type="submit" variante="primario" icone={Save} carregando={salvando} disabled={!alterado || invalido}>
                Salvar
              </Botao>
            </div>
          </footer>
        </>
      )}
    </form>
  );
}
