import { CalendarCheck } from "lucide-react";
import { formatarDataBR, formatarMinutos, faseVigenteEm, fasesParaExibicao, type RegrasCarga } from "@/motor";
import { cn } from "@/lib/utils";

type Props = {
  /** Data de publicação da EC 141 (ISO). */
  publicacao: string;
  regras: RegrasCarga;
  /** Hoje (ISO), para marcar a fase vigente. */
  hoje: string;
  /** `false` = regime desligado: a linha do tempo aparece esmaecida. */
  ativo?: boolean;
};

/** As 3 fases da EC 141/2026 em linha horizontal, com a fase vigente destacada e o marcador "hoje". */
export function LinhaDoTempoEc141({ publicacao, regras, hoje, ativo = true }: Props) {
  const fases = fasesParaExibicao(publicacao, regras);
  const vigente = faseVigenteEm(publicacao, hoje, regras).numero;

  return (
    <div className={cn(!ativo && "opacity-50")}>
      <ol className="grid gap-3 md:grid-cols-3" aria-label="Fases da EC 141">
        {fases.map((fase) => {
          const atual = fase.numero === vigente;
          return (
            <li
              key={fase.numero}
              aria-current={atual && ativo ? "step" : undefined}
              className={cn(
                "relative flex flex-col gap-1.5 rounded-lg border bg-superficie p-3.5",
                atual ? "border-acento ring-1 ring-acento" : "border-borda",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "numero grid size-5 place-items-center rounded-full text-xs font-medium",
                    atual ? "bg-acento text-acento-texto" : "bg-muted text-texto-suave",
                  )}
                >
                  {fase.numero}
                </span>
                <span className="font-display font-semibold">{fase.nome}</span>
                {atual && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-acento/12 px-2 py-0.5 text-xs font-medium text-acento">
                    <CalendarCheck className="size-3" aria-hidden />
                    Hoje · {formatarDataBR(hoje)}
                  </span>
                )}
              </div>
              <p className="numero font-mono text-xs text-texto-suave">{fase.periodo}</p>
              <p className="text-sm">
                <span className="numero font-mono font-medium">{formatarMinutos(fase.cargaSemanalMaxMin)}</span> por semana
                {" · "}
                <span className="numero font-mono font-medium">{fase.folgasSemanaisMin}</span>{" "}
                {fase.folgasSemanaisMin === 1 ? "folga" : "folgas"}
              </p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
