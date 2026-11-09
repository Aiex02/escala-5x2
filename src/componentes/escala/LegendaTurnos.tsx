import { formatarHora } from "@/lib/formato";
import type { TurnoAgendaDto } from "@/servicos/agendaDto";
import { estiloTurno } from "./util";

export function LegendaTurnos({ turnos }: { turnos: TurnoAgendaDto[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-texto-suave" aria-label="Legenda do quadro">
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {turnos.map((t) => (
          <li key={t.id} className="flex items-center gap-1.5">
            <span
              className="grid size-6 place-items-center rounded-md border font-mono text-[11px] font-semibold"
              style={estiloTurno(t.cor)}
              aria-hidden
            >
              {t.sigla}
            </span>
            <span className="text-texto">{t.nome}</span>
            <span className="font-mono">
              {formatarHora(t.inicioMin)}–{formatarHora(t.fimMin)}
            </span>
            {t.arquivado && <span>(arquivado)</span>}
          </li>
        ))}
      </ul>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <li className="flex items-center gap-1.5">
          <span className="grid size-6 place-items-center rounded-md border border-dashed border-borda font-mono text-[11px] opacity-70" aria-hidden>
            F
          </span>
          Folga
        </li>
        <li className="flex items-center gap-1.5">
          <span className="grid size-6 place-items-center rounded-md border border-critico/50 bg-critico/10 font-mono text-[11px] font-semibold text-critico" aria-hidden>
            A
          </span>
          Falta
        </li>
        <li className="flex items-center gap-1.5">
          <span className="grid size-6 place-items-center rounded-md border border-atencao/50 bg-atencao/15 font-mono text-[11px] font-semibold text-[color-mix(in_oklch,var(--atencao),var(--texto)_45%)]" aria-hidden>
            J
          </span>
          Justificada
        </li>
        <li className="flex items-center gap-1.5">
          <span className="relative grid size-6 place-items-center rounded-md border border-borda" aria-hidden>
            <span className="size-1.5 rounded-full bg-texto-suave" />
          </span>
          Jornada compensada
        </li>
        <li className="flex items-center gap-1.5">
          <span className="relative grid size-6 place-items-center rounded-md border border-atencao ring-1 ring-atencao" aria-hidden>
            <span className="absolute top-px left-[3px] font-mono text-[10px] leading-none font-bold text-atencao">+</span>
          </span>
          Hora extra (compensa nos meses seguintes)
        </li>
        <li className="flex items-center gap-1.5">
          <span
            className="size-6 rounded-md border border-borda/60"
            style={{ backgroundImage: "repeating-linear-gradient(135deg, transparent 0 4px, color-mix(in oklch, var(--texto) 22%, transparent) 4px 5px)" }}
            aria-hidden
          />
          Dia fechado
        </li>
        <li className="flex items-center gap-1.5">
          <span className="relative size-6 overflow-hidden rounded-md border border-borda" aria-hidden>
            <span className="absolute top-0 right-0 border-t-[9px] border-l-[9px] border-t-acento border-l-transparent" />
          </span>
          Ajustado à mão (fica como está ao reequilibrar)
        </li>
      </ul>
    </div>
  );
}
