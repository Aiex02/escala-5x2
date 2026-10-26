import { forwardRef, useState } from "react";
import { ChevronRight, CircleCheck } from "lucide-react";
import type { Aviso, TipoAviso } from "../../api/types";
import { formatarDiaMes } from "../../util/datas";
import { rotuloAviso } from "../../util/tipos";

const ORDEM: TipoAviso[] = ["violacaoRegra", "coberturaInsuficiente", "funcaoDescoberta", "cargaAbaixoDoAlvo", "funcionarioSemTurno", "turnoExcedeJornada"];

/** A mensagem já lista os dias (a data do aviso seria só o primeiro deles). */
const TIPOS_COM_DIAS_NA_MENSAGEM: ReadonlySet<TipoAviso> = new Set(["funcaoDescoberta"]);

/** Avisos da geração agrupados por tipo; grupos grandes começam recolhidos. */
export const ListaAvisos = forwardRef<HTMLElement, { avisos: Aviso[] }>(function ListaAvisos({ avisos }, ref) {
  const tipos = [...new Set<TipoAviso>([...ORDEM, ...avisos.map((a) => a.tipo)])];
  const grupos = tipos
    .map((tipo) => ({ tipo, itens: avisos.filter((a) => a.tipo === tipo).sort((a, b) => (a.data ?? "").localeCompare(b.data ?? "")) }))
    .filter((g) => g.itens.length > 0);

  return (
    <section ref={ref} className="painel" aria-labelledby="titulo-avisos">
      <header className="painel-cab">
        <h2 id="titulo-avisos">Avisos</h2>
        {avisos.length > 0 && <span className="selo selo-atencao">{avisos.length}</span>}
      </header>
      {grupos.length === 0 ? (
        <p className="painel-ok">
          <CircleCheck size={17} strokeWidth={1.9} aria-hidden="true" />
          Nenhum aviso: a escala atende todas as regras.
        </p>
      ) : (
        <div className="avisos">
          {grupos.map((g) => (
            <GrupoAvisos key={g.tipo} tipo={g.tipo} itens={g.itens} />
          ))}
        </div>
      )}
    </section>
  );
});

function GrupoAvisos({ tipo, itens }: { tipo: TipoAviso; itens: Aviso[] }) {
  const [aberto, setAberto] = useState(itens.length <= 6);
  return (
    <div className="avisos-grupo">
      <button type="button" className="avisos-grupo-cab" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <ChevronRight className="arvore-seta" size={14} strokeWidth={2} aria-hidden="true" />
        <span>{rotuloAviso(tipo)}</span>
        <span className="arvore-contagem">{itens.length}</span>
      </button>
      {aberto && (
        <ul className="avisos-lista">
          {itens.map((a, i) => (
            <li key={i}>
              {a.data && !TIPOS_COM_DIAS_NA_MENSAGEM.has(a.tipo) && <span className="avisos-data">{formatarDiaMes(a.data)}</span>}
              <span>{a.mensagem}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
