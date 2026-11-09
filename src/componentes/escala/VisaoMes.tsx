"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/componentes/ui/sheet";
import type { AgendaMesDto, AvisoAgendaDto } from "@/servicos/agendaDto";
import { faixaHorario, estiloTurno, NOMES_DIA_LONGO, NOMES_TIPO_AVISO } from "./util";

type Props = { agenda: AgendaMesDto; hoje: string };

const CABECALHO = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

export function VisaoMes({ agenda, hoje }: Props) {
  const [diaAberto, setDiaAberto] = useState<number | null>(null);
  const turnosPorId = useMemo(() => new Map(agenda.turnos.map((t) => [t.id, t])), [agenda.turnos]);
  const avisosPorDia = useMemo(() => {
    const mapa = new Map<string, AvisoAgendaDto[]>();
    for (const a of agenda.avisos) {
      if (!a.data) continue;
      mapa.set(a.data, [...(mapa.get(a.data) ?? []), a]);
    }
    return mapa;
  }, [agenda.avisos]);
  const linhas = useMemo(() => agenda.grupos.flatMap((g) => g.linhas), [agenda.grupos]);
  const vazios = agenda.dias[0]?.diaSemana ?? 0;

  const dia = diaAberto !== null ? agenda.dias[diaAberto] : undefined;
  const detalhe = useMemo(() => {
    if (diaAberto === null) return null;
    const porTurno = new Map<string, string[]>();
    const folgas: string[] = [];
    const faltas: string[] = [];
    const justificadas: string[] = [];
    for (const l of linhas) {
      const c = l.celulas[diaAberto];
      if (!c) continue;
      if (c.tipo === "turno") porTurno.set(c.turnoId, [...(porTurno.get(c.turnoId) ?? []), l.nome]);
      else if (c.tipo === "folga") folgas.push(l.nome);
      else if (c.tipo === "falta") faltas.push(l.nome);
      else if (c.tipo === "justificada") justificadas.push(c.motivo ? `${l.nome} (${c.motivo})` : l.nome);
    }
    return { porTurno, folgas, faltas, justificadas };
  }, [diaAberto, linhas]);

  return (
    <>
      <div className="overflow-x-auto">
        <div className="grid min-w-[44rem] grid-cols-7 gap-1.5" role="grid" aria-label="Calendário do mês">
          {CABECALHO.map((c) => (
            <div key={c} role="columnheader" className="px-1 pb-0.5 text-xs font-medium tracking-wide text-texto-suave uppercase">
              {c}
            </div>
          ))}
          {Array.from({ length: vazios }, (_, i) => (
            <div key={`v${i}`} role="gridcell" aria-hidden />
          ))}
          {agenda.dias.map((d, i) => {
            const avisos = avisosPorDia.get(d.data) ?? [];
            const ehHoje = d.data === hoje;
            return (
              <button
                key={d.data}
                role="gridcell"
                type="button"
                onClick={() => setDiaAberto(i)}
                aria-label={`${Number(d.data.slice(8, 10))}, ${NOMES_DIA_LONGO[d.diaSemana]}. ${avisos.length} aviso(s)`}
                className={cn(
                  "flex min-h-24 flex-col gap-1 rounded-lg border border-borda bg-superficie p-1.5 text-left text-xs outline-none transition-colors hover:border-acento/60 focus-visible:ring-2 focus-visible:ring-acento",
                  d.diaSemana >= 5 && "bg-texto/[0.04]",
                  !d.aberto && "bg-[repeating-linear-gradient(135deg,transparent_0_4px,color-mix(in_oklch,var(--texto)_8%,transparent)_4px_5px)]",
                  ehHoje && "border-acento",
                )}
              >
                <span className="flex items-center justify-between">
                  <span className={cn("numero grid h-5 min-w-5 place-items-center rounded-full font-mono text-xs font-medium", ehHoje && "bg-acento px-1 text-acento-texto")}>{Number(d.data.slice(8, 10))}</span>
                  {avisos.length > 0 && (
                    <span className="flex items-center gap-0.5" aria-hidden>
                      {avisos.slice(0, 4).map((a, k) => (
                        <span key={k} className={cn("size-1.5 rounded-full", a.tipo === "coberturaInsuficiente" || a.tipo === "violacaoRegra" ? "bg-critico" : "bg-atencao")} />
                      ))}
                      {avisos.length > 4 && <span className="font-mono text-[10px] text-texto-suave">+{avisos.length - 4}</span>}
                    </span>
                  )}
                </span>
                {agenda.totaisPorTurno.map((t) => {
                  const turno = turnosPorId.get(t.turnoId);
                  const n = t.porDia[i] ?? 0;
                  if (!turno || (n === 0 && (turno.diasSemana & (1 << d.diaSemana)) === 0)) return null;
                  return (
                    <span key={t.turnoId} className="flex items-center gap-1">
                      <span className="size-2 shrink-0 rounded-sm border" style={estiloTurno(turno.cor)} aria-hidden />
                      <span className="truncate">{turno.nome}</span>
                      <span className={cn("numero ml-auto font-mono", turno.efetivoMinimo > 0 && n < turno.efetivoMinimo && "font-semibold text-critico")}>{n}</span>
                    </span>
                  );
                })}
              </button>
            );
          })}
        </div>
      </div>

      <Sheet open={diaAberto !== null} onOpenChange={(o) => !o && setDiaAberto(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {dia && detalhe && (
            <>
              <SheetHeader>
                <SheetTitle className="capitalize">
                  {NOMES_DIA_LONGO[dia.diaSemana]}, {dia.data.slice(8, 10)}/{dia.data.slice(5, 7)}
                </SheetTitle>
                <SheetDescription>{dia.aberto ? "Quem trabalha em cada turno neste dia." : "O estabelecimento fecha neste dia."}</SheetDescription>
              </SheetHeader>
              <div className="flex flex-col gap-4 px-4 pb-6">
                {agenda.turnos.map((t) => {
                  const nomes = detalhe.porTurno.get(t.id) ?? [];
                  if (nomes.length === 0 && (t.diasSemana & (1 << dia.diaSemana)) === 0) return null;
                  return (
                    <section key={t.id}>
                      <h3 className="mb-1 flex items-center gap-2 text-sm font-medium">
                        <span className="size-3 rounded-sm border" style={estiloTurno(t.cor)} aria-hidden />
                        {t.nome}
                        <span className="font-mono text-xs font-normal text-texto-suave">{faixaHorario(t.inicioMin, t.fimMin)}</span>
                        <span className="numero ml-auto font-mono text-xs">{nomes.length}</span>
                      </h3>
                      {nomes.length > 0 ? <p className="text-sm text-texto-suave">{nomes.join(", ")}</p> : <p className="text-sm text-critico">Ninguém escalado.</p>}
                    </section>
                  );
                })}
                <Grupo titulo="Folga" nomes={detalhe.folgas} />
                <Grupo titulo="Falta" nomes={detalhe.faltas} />
                <Grupo titulo="Ausência justificada" nomes={detalhe.justificadas} />
                {(avisosPorDia.get(dia.data) ?? []).length > 0 && (
                  <section>
                    <h3 className="mb-1 text-sm font-medium">Avisos do dia</h3>
                    <ul className="flex flex-col gap-1 text-xs text-texto-suave">
                      {(avisosPorDia.get(dia.data) ?? []).map((a, k) => (
                        <li key={k}>
                          <span className="font-medium text-texto">{NOMES_TIPO_AVISO[a.tipo]}:</span> {a.mensagem}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

function Grupo({ titulo, nomes }: { titulo: string; nomes: string[] }) {
  if (nomes.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 flex items-center justify-between text-sm font-medium">
        {titulo}
        <span className="numero font-mono text-xs">{nomes.length}</span>
      </h3>
      <p className="text-sm text-texto-suave">{nomes.join(", ")}</p>
    </section>
  );
}
