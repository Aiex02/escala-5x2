import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Folder, FolderOpen } from "lucide-react";
import type { MesGerado } from "../api/types";
import { nomeMes } from "../util/datas";
import type { MesRef } from "../util/tipos";

interface Props {
  meses: MesGerado[];
  carregando: boolean;
  erro: string | null;
  selecionado: MesRef | null;
  onSelecionar: (ano: number, mes: number) => void;
}

/** Pastas por ano (mais recente primeiro), cada uma com os meses já gerados. */
export function ArvoreMeses({ meses, carregando, erro, selecionado, onSelecionar }: Props) {
  const anos = useMemo(() => {
    const porAno = new Map<number, MesGerado[]>();
    for (const m of meses) porAno.set(m.ano, [...(porAno.get(m.ano) ?? []), m]);
    return [...porAno.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([ano, lista]) => ({ ano, meses: [...lista].sort((a, b) => a.mes - b.mes) }));
  }, [meses]);

  const [expandidos, setExpandidos] = useState<Set<number>>(() => new Set(selecionado ? [selecionado.ano] : []));

  // O ano do mês aberto fica sempre expandido; sem seleção, o ano mais recente.
  const anoSelecionado = selecionado?.ano ?? null;
  const anoMaisRecente = anos[0]?.ano ?? null;
  useEffect(() => {
    const alvo = anoSelecionado ?? anoMaisRecente;
    if (alvo !== null) setExpandidos((atual) => (atual.has(alvo) ? atual : new Set(atual).add(alvo)));
  }, [anoSelecionado, anoMaisRecente]);

  function alternar(ano: number) {
    setExpandidos((atual) => {
      const novo = new Set(atual);
      if (!novo.delete(ano)) novo.add(ano);
      return novo;
    });
  }

  if (erro) return <p className="lateral-nota texto-erro">{erro}</p>;
  if (carregando && meses.length === 0) return <p className="lateral-nota">Carregando…</p>;
  if (meses.length === 0) return <p className="lateral-nota">Nenhuma escala gerada ainda.</p>;

  return (
    <ul className="arvore" aria-label="Escalas geradas">
      {anos.map(({ ano, meses: lista }) => {
        const aberto = expandidos.has(ano);
        const Pasta = aberto ? FolderOpen : Folder;
        return (
          <li key={ano}>
            <button type="button" className="arvore-ano" aria-expanded={aberto} onClick={() => alternar(ano)}>
              <ChevronRight className="arvore-seta" size={14} strokeWidth={2} aria-hidden="true" />
              <Pasta size={16} strokeWidth={1.8} aria-hidden="true" />
              <span className="arvore-ano-texto">{ano}</span>
              <span className="arvore-contagem">{lista.length}</span>
            </button>
            {aberto && (
              <ul className="arvore-meses">
                {lista.map((m) => {
                  const ativo = selecionado?.ano === m.ano && selecionado.mes === m.mes;
                  return (
                    <li key={m.mes}>
                      <button
                        type="button"
                        className={ativo ? "arvore-mes ativo" : "arvore-mes"}
                        aria-current={ativo ? "page" : undefined}
                        onClick={() => onSelecionar(m.ano, m.mes)}
                      >
                        {nomeMes(m.mes)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
