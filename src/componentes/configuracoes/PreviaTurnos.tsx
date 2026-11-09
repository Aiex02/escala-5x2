import { formatarHora } from "@/motor";
import { descreverMascaraDias, type TurnoParaExibir } from "./utilFuncionamento";

/** Lista de turnos com a cor, o horário e os dias em que funcionam. */
export function PreviaTurnos({ turnos, compacta = false }: { turnos: readonly TurnoParaExibir[]; compacta?: boolean }) {
  if (turnos.length === 0) return <p className="text-sm text-texto-suave">Nenhum turno.</p>;
  return (
    <ul className={compacta ? "flex flex-col gap-1" : "grid gap-2 sm:grid-cols-2"}>
      {turnos.map((t, i) => (
        <li
          key={`${t.nome}-${i}`}
          className="flex items-center gap-2.5 rounded-md border border-borda bg-superficie px-2.5 py-1.5 text-sm"
        >
          <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: t.cor }} aria-hidden />
          <span className="font-medium">{t.nome}</span>
          <span className="numero font-mono text-xs text-texto-suave">
            {formatarHora(t.inicioMin)}–{formatarHora(t.fimMin)}
            {t.intervaloMin > 0 && ` · int. ${t.intervaloMin} min`}
          </span>
          {!compacta && <span className="ml-auto text-xs text-texto-suave">{descreverMascaraDias(t.diasSemana)}</span>}
        </li>
      ))}
    </ul>
  );
}
