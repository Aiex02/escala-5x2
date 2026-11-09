import Link from "next/link";
import { TriangleAlert, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FaltaPessoalDto } from "@/servicos/agendaDto";

type Props = { clienteId: string; faltas: FaltaPessoalDto[] };

/** "Cozinheiro +2, Barista +1". */
export function resumoFaltas(faltas: readonly FaltaPessoalDto[]): string {
  return faltas.map((f) => `${f.geral ? "Pessoas (efetivo geral)" : f.nome} +${f.faltamPessoas}`).join(", ");
}

/** Faixa no topo da escala: faltam pessoas para cobrir o mínimo (diagnóstico do dimensionamento). */
export function BannerFaltaPessoal({ clienteId, faltas }: Props) {
  if (faltas.length === 0) return null;
  // Crítico quando nem a hora extra legal dá conta; senão, só atenção.
  const critico = faltas.some((f) => !f.cobrivelComHoraExtra);
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border px-3 py-2 text-sm",
        critico ? "border-critico/50 bg-critico/10 text-critico" : "border-atencao/50 bg-atencao/10",
      )}
    >
      {critico ? <UserPlus className="size-4 shrink-0" aria-hidden /> : <TriangleAlert className="size-4 shrink-0 text-atencao" aria-hidden />}
      <span className="font-medium">Faltam pessoas para cobrir o mínimo: {resumoFaltas(faltas)}</span>
      <Link href={`/clientes/${clienteId}/configuracoes?aba=funcoes`} className="ml-auto text-xs underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-acento">
        ver dimensionamento
      </Link>
    </div>
  );
}
