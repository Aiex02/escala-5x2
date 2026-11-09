"use client";

import { Scale } from "lucide-react";
import { Badge } from "@/componentes/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/componentes/ui/tooltip";
import type { FaseDto } from "@/servicos/agendaDto";

/** Selo com a fase da EC 141 em vigor no mês, com explicação ao passar o mouse ou focar. */
export function BadgeFase({ fase, regraDoMes }: { fase: FaseDto; regraDoMes: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="rounded-4xl outline-none focus-visible:ring-2 focus-visible:ring-acento" aria-label={`Regra do mês: ${fase.resumo}`}>
            <Badge variant="secondary" className="gap-1 font-mono">
              <Scale aria-hidden /> {fase.resumo}
            </Badge>
          </button>
        </TooltipTrigger>
        <TooltipContent className="flex-col items-start gap-1 py-2" side="bottom">
          <span className="font-medium">EC 141/2026 · {fase.nome}</span>
          <span>{fase.descricao} ({fase.periodo}).</span>
          <span className="opacity-80">Neste mês: {regraDoMes}.</span>
          <span className="opacity-80">Vale o mais restritivo entre a lei e as regras da empresa.</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
