import { useMemo, useState } from "react";
import { CalendarPlus, Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { mensagemErro } from "../api/client";
import type { MesGerado } from "../api/types";
import { hojeISO, NOMES_MESES, separarData, tituloMes } from "../util/datas";
import { Botao, BotaoIcone } from "./base/Botao";
import { Modal } from "./Modal";
import { Alerta } from "./ui";

interface Props {
  nomeCliente: string;
  meses: MesGerado[];
  /** Gera e abre a agenda; lança em caso de erro. */
  onGerar: (ano: number, mes: number) => Promise<void>;
  onFechar: () => void;
}

/** Primeiro mês ainda não gerado a partir do mês atual (até um ano à frente). */
function sugestao(meses: MesGerado[]): { ano: number; mes: number } {
  const hoje = separarData(hojeISO());
  for (let i = 0; i < 12; i++) {
    const total = hoje.ano * 12 + (hoje.mes - 1) + i;
    const ano = Math.floor(total / 12);
    const mes = (total % 12) + 1;
    if (!meses.some((m) => m.ano === ano && m.mes === mes)) return { ano, mes };
  }
  return { ano: hoje.ano, mes: hoje.mes };
}

export function GerarMesModal({ nomeCliente, meses, onGerar, onFechar }: Props) {
  const inicial = useMemo(() => sugestao(meses), [meses]);
  const [ano, setAno] = useState(inicial.ano);
  const [mes, setMes] = useState(inicial.mes);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const gerados = new Set(meses.filter((m) => m.ano === ano).map((m) => m.mes));
  const jaExiste = gerados.has(mes);

  async function gerar() {
    setGerando(true);
    setErro(null);
    try {
      await onGerar(ano, mes);
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setGerando(false);
    }
  }

  return (
    <Modal
      titulo="Nova escala"
      subtitulo={`Escolha o mês para gerar a escala de ${nomeCliente}.`}
      onFechar={gerando ? () => undefined : onFechar}
      largura="estreita"
      rodape={
        <>
          <Botao onClick={onFechar} disabled={gerando}>
            Cancelar
          </Botao>
          <Botao variante="primario" icone={jaExiste ? RefreshCw : CalendarPlus} carregando={gerando} onClick={() => void gerar()}>
            {jaExiste ? "Gerar de novo" : "Gerar escala"}
          </Botao>
        </>
      }
    >
      <div className="seletor-ano">
        <BotaoIcone icone={ChevronLeft} rotulo="Ano anterior" variante="secundario" onClick={() => setAno((a) => a - 1)} disabled={ano <= 2000} />
        <span className="seletor-ano-valor" aria-live="polite">
          {ano}
        </span>
        <BotaoIcone icone={ChevronRight} rotulo="Próximo ano" variante="secundario" onClick={() => setAno((a) => a + 1)} disabled={ano >= 2100} />
      </div>

      <div className="grade-meses" role="radiogroup" aria-label={`Meses de ${ano}`}>
        {NOMES_MESES.map((nome, i) => {
          const numero = i + 1;
          const selecionado = numero === mes;
          const gerado = gerados.has(numero);
          return (
            <button
              key={nome}
              type="button"
              role="radio"
              aria-checked={selecionado}
              className={gerado ? "mes-opcao gerado" : "mes-opcao"}
              data-dica={gerado ? "Já tem escala" : undefined}
              onClick={() => setMes(numero)}
            >
              <span>{nome.slice(0, 3)}</span>
              {gerado && <Check className="mes-opcao-marca" size={13} strokeWidth={2.6} aria-label="já gerado" />}
            </button>
          );
        })}
      </div>

      {jaExiste ? (
        <Alerta tipo="atencao">
          {tituloMes(ano, mes)} já tem escala. Gerar de novo substitui a atual e descarta os ajustes feitos à mão no Quadro: todos os funcionários ativos são redistribuídos pelas regras e
          preferências de hoje. Para manter os ajustes, cancele e use Reequilibrar na escala do mês.
        </Alerta>
      ) : (
        <p className="modal-nota">
          A escala de {tituloMes(ano, mes).toLowerCase()} redistribui todos os funcionários ativos entre os turnos, atendendo a preferência de período quando houver vaga. Ela respeita a
          carga semanal configurada, soma as semanas que atravessam os meses vizinhos e compensa o saldo de horas dos meses anteriores dentro das regras.
        </p>
      )}
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
