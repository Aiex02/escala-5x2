import { Moon, Sun, Sunrise, type LucideIcon } from "lucide-react";
import type { Periodo } from "../api/types";
import { NOME_PERIODO } from "../util/funcionamento";

const ICONES: Record<Periodo, LucideIcon> = { manha: Sunrise, tarde: Sun, noite: Moon };

/** Etiqueta do período do dia (manhã, tarde ou noite), usada na preferência do funcionário e no turno. */
export function ChipPeriodo({ periodo, dica }: { periodo: Periodo; dica?: string }) {
  const Icone = ICONES[periodo];
  return (
    <span className="selo selo-destaque chip-periodo" data-dica={dica} tabIndex={dica ? 0 : undefined}>
      <Icone size={13} strokeWidth={2} aria-hidden="true" />
      {NOME_PERIODO[periodo]}
    </span>
  );
}
