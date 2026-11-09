"use client";

import { useState } from "react";
import { ChevronRight, Clock, Layers, TrendingUp, TriangleAlert, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { textoContratar } from "@/lib/dimensionamento";
import type { AvisoAgendaDto, FaltaPessoalDto, TipoAvisoDto } from "@/servicos/agendaDto";
import { formatarDiaMesBR, NOMES_TIPO_AVISO } from "./util";

type Props = {
  avisos: AvisoAgendaDto[];
  /** Diagnóstico do dimensionamento: seção fixa no topo, fora dos avisos do motor. */
  faltas?: FaltaPessoalDto[];
  aoFocar: (aviso: AvisoAgendaDto) => void;
};

const ORDEM: TipoAvisoDto[] = [
  "violacaoRegra",
  "coberturaInsuficiente",
  "funcaoDescoberta",
  "coberturaParcial",
  "cargaAbaixoDoAlvo",
  "turnoExcedeJornada",
  "funcionarioSemTurno",
  "excessoSemanal",
  "horaExtra",
];

const ICONE_TIPO: Partial<Record<TipoAvisoDto, typeof Clock>> = { coberturaParcial: Layers, horaExtra: Clock, excessoSemanal: TrendingUp };

export function PainelAvisos({ avisos, faltas = [], aoFocar }: Props) {
  const [aberto, setAberto] = useState(true);
  const porTipo = ORDEM.map((tipo) => ({ tipo, itens: avisos.filter((a) => a.tipo === tipo) })).filter((g) => g.itens.length > 0);

  return (
    <aside aria-label="Avisos da escala" className="rounded-lg border border-borda bg-superficie xl:w-80 xl:shrink-0">
      <button
        type="button"
        onClick={() => setAberto((a) => !a)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-acento"
      >
        <ChevronRight className={cn("size-4 transition-transform", aberto && "rotate-90")} aria-hidden />
        <TriangleAlert className={cn("size-4", avisos.length > 0 ? "text-atencao" : "text-texto-suave")} aria-hidden />
        Avisos
        <span className="numero ml-auto rounded-full bg-secondary px-2 font-mono text-xs">{avisos.length + faltas.length}</span>
      </button>
      {aberto && (
        <div className="max-h-[calc(100dvh-20rem)] overflow-y-auto border-t border-borda px-3 py-2">
          {faltas.length > 0 && (
            <section className="mb-3 border-b border-borda pb-3" aria-label="Falta de pessoal">
              <h3 className="mb-1 flex items-center justify-between text-xs font-semibold tracking-wide text-critico uppercase">
                <span className="flex items-center gap-1.5">
                  <UserPlus className="size-3.5" aria-hidden />
                  Falta de pessoal
                </span>
                <span className="numero font-mono">{faltas.length}</span>
              </h3>
              <ul className="flex flex-col gap-1">
                {faltas.map((f) => (
                  <li key={f.nome} className="px-1.5 py-0.5 text-xs">
                    <span className="font-medium">{f.geral ? "Pessoas (efetivo geral)" : f.nome}</span>: {textoContratar(f, true)}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {porTipo.length === 0 ? (
            <p className="py-2 text-sm text-texto-suave">{faltas.length === 0 ? "Nenhum aviso. A cobertura e as regras estão em dia." : "Nenhum outro aviso."}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {porTipo.map(({ tipo, itens }) => (
                <li key={tipo}>
                  <h3 className="mb-1 flex items-center justify-between text-xs font-semibold tracking-wide text-texto-suave uppercase">
                    <span className="flex items-center gap-1.5">
                      {(() => {
                        const Icone = ICONE_TIPO[tipo];
                        return Icone ? <Icone className="size-3.5" aria-hidden /> : null;
                      })()}
                      {NOMES_TIPO_AVISO[tipo]}
                    </span>
                    <span className="numero font-mono">{itens.length}</span>
                  </h3>
                  <ul className="flex flex-col">
                    {itens.map((a, i) => (
                      <li key={`${a.data}-${a.turnoId}-${a.funcionarioId}-${i}`}>
                        <button
                          type="button"
                          onClick={() => aoFocar(a)}
                          className="flex w-full gap-2 rounded-md px-1.5 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-acento"
                        >
                          {a.data && <span className="numero shrink-0 font-mono text-texto-suave">{formatarDiaMesBR(a.data)}</span>}
                          <span>{a.mensagem}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
