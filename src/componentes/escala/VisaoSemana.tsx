"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/componentes/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/componentes/ui/select";
import { nomeDiaCurto } from "@/lib/datas";
import { formatarMinutos } from "@/lib/formato";
import { cn } from "@/lib/utils";
import type { AgendaMesDto, CelulaDto } from "@/servicos/agendaDto";
import { classeSaldo, estiloTurno, faixaHorario, formatarDiaMesBR, textoSaldo } from "./util";

type Props = { agenda: AgendaMesDto; hoje: string };

export function VisaoSemana({ agenda, hoje }: Props) {
  const indiceInicial = Math.max(
    0,
    agenda.semanas.findIndex((s) => s.inicio <= hoje && hoje <= s.fim),
  );
  const [indice, setIndice] = useState(indiceInicial);
  const semana = agenda.semanas[indice] ?? agenda.semanas[0];
  const turnosPorId = useMemo(() => new Map(agenda.turnos.map((t) => [t.id, t])), [agenda.turnos]);
  const inicioMes = agenda.dias[0]?.data ?? "";
  const comExtras = semana ? Object.values(semana.porFuncionario).some((h) => h.horaExtraMin > 0) : false;

  if (!semana) return null;

  const celula = (funcionarioId: string, data: string): CelulaDto | undefined => {
    const noMes = data >= inicioMes && data <= (agenda.dias[agenda.dias.length - 1]?.data ?? "");
    if (noMes) {
      const i = agenda.dias.findIndex((d) => d.data === data);
      for (const g of agenda.grupos) {
        const l = g.linhas.find((x) => x.funcionarioId === funcionarioId);
        if (l) return l.celulas[i];
      }
      return undefined;
    }
    return semana.foraDoMes[funcionarioId]?.[data];
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={String(indice)} onValueChange={(v) => setIndice(Number(v))}>
          <SelectTrigger className="w-56" aria-label="Semana">
            <SelectValue>
              {semana ? `${formatarDiaMesBR(semana.inicio)} a ${formatarDiaMesBR(semana.fim)}${!semana.fechada ? " · aberta" : ""}` : "Semana"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {agenda.semanas.map((s, i) => (
              <SelectItem key={s.inicio} value={String(i)}>
                {formatarDiaMesBR(s.inicio)} a {formatarDiaMesBR(s.fim)}
                {!s.fechada ? " · aberta" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!semana.fechada && (
          <Badge variant="outline" title="A semana tem dias em um mês ainda não gerado; o saldo só conta quando todos os dias estão gerados.">
            Semana aberta: tem dias em mês não gerado
          </Badge>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-borda">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-borda bg-superficie text-xs text-texto-suave">
              <th scope="col" className="w-44 px-2 py-2 text-left font-medium">
                Funcionário
              </th>
              {semana.dias.map((d) => (
                <th key={d.data} scope="col" className={cn("px-1 py-2 text-center font-medium", !d.noMes && "opacity-60", d.data === hoje && "text-acento")}>
                  <span className="uppercase">{nomeDiaCurto(d.diaSemana)}</span> <span className="numero font-mono">{formatarDiaMesBR(d.data)}</span>
                </th>
              ))}
              <th scope="col" className="px-2 py-2 text-right font-medium">Feito</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Previsto</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Limite</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Saldo</th>
              {comExtras && <th scope="col" className="px-2 py-2 text-right font-medium">Extras</th>}
            </tr>
          </thead>
          <tbody>
            {agenda.grupos.map((g) => (
              <GrupoSemana key={g.chave || "sem"} nome={g.nome}>
                {g.linhas.map((l) => {
                  const h = semana.porFuncionario[l.funcionarioId];
                  return (
                    <tr key={l.funcionarioId} className="border-b border-borda/60 hover:bg-texto/[0.03]">
                      <th scope="row" className="truncate px-2 py-1.5 text-left font-normal">
                        {l.nome}
                      </th>
                      {semana.dias.map((d) => {
                        const c = celula(l.funcionarioId, d.data);
                        return (
                          <td key={d.data} className={cn("px-0.5 py-1 text-center", d.diaSemana >= 5 && "bg-texto/[0.04]")}>
                            <ConteudoCelula c={c} turnos={turnosPorId} />
                          </td>
                        );
                      })}
                      <td className="numero px-2 text-right font-mono text-xs">{h ? formatarMinutos(h.feitoMin) : "–"}</td>
                      <td className="numero px-2 text-right font-mono text-xs">{h ? formatarMinutos(h.previstoMin) : "–"}</td>
                      <td className="numero px-2 text-right font-mono text-xs text-texto-suave">{h ? formatarMinutos(h.limiteMin) : "–"}</td>
                      <td className={cn("numero px-2 text-right font-mono text-xs", h && semana.fechada ? classeSaldo(h.saldoMin) : "text-texto-suave")}>
                        {h ? (semana.fechada ? textoSaldo(h.saldoMin) : `(${textoSaldo(h.saldoMin)})`) : "–"}
                      </td>
                      {comExtras && (
                        <td className={cn("numero px-2 text-right font-mono text-xs", h && h.horaExtraMin > 0 ? "text-atencao" : "text-texto-suave")}>
                          {h && h.horaExtraMin > 0 ? `+${formatarMinutos(h.horaExtraMin)}` : "–"}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </GrupoSemana>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GrupoSemana({ nome, children }: { nome: string; children: React.ReactNode }) {
  return (
    <>
      <tr className="border-b border-borda bg-secondary/60">
        <th colSpan={13} scope="colgroup" className="px-2 py-1 text-left text-xs font-semibold tracking-wide uppercase">
          {nome}
        </th>
      </tr>
      {children}
    </>
  );
}

function ConteudoCelula({ c, turnos }: { c: CelulaDto | undefined; turnos: ReadonlyMap<string, { cor: string; nome: string }> }) {
  if (!c || c.tipo === "fechado") return <span className="text-texto-suave/50">–</span>;
  if (c.tipo === "turno") {
    const t = turnos.get(c.turnoId);
    return (
      <span className="inline-block rounded-md border px-1.5 py-0.5 font-mono text-xs whitespace-nowrap" style={t ? estiloTurno(t.cor) : undefined} title={t?.nome}>
        {faixaHorario(c.inicioMin, c.fimMin)}
        {c.origem === "horaExtra" && <span className="ml-0.5 font-bold text-atencao" title={`Hora extra: +${formatarMinutos(c.extraMin)}`}>+</span>}
        {c.compensada && <span className="ml-0.5" title="Jornada compensada">•</span>}
      </span>
    );
  }
  if (c.tipo === "folga") return <span className="text-xs text-texto-suave">Folga</span>;
  if (c.tipo === "falta") return <span className="rounded-md bg-critico/10 px-1.5 py-0.5 text-xs font-medium text-critico">Falta</span>;
  return (
    <span className="rounded-md bg-atencao/15 px-1.5 py-0.5 text-xs font-medium text-[color-mix(in_oklch,var(--atencao),var(--texto)_45%)]" title={c.motivo ?? undefined}>
      Justificada
    </span>
  );
}
