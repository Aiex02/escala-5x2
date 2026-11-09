import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/componentes/ui/button";

type Props = {
  icone: LucideIcon;
  titulo: string;
  descricao?: string;
  acao?: { rotulo: string; href: string };
  children?: ReactNode;
};

export function EstadoVazio({ icone: Icone, titulo, descricao, acao, children }: Props) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-borda px-6 py-10 sm:items-center sm:text-center">
      <span className="grid size-11 place-items-center rounded-lg bg-acento/12 text-acento">
        <Icone className="size-5" aria-hidden />
      </span>
      <div className="max-w-md space-y-1">
        <h2 className="font-display text-lg font-semibold">{titulo}</h2>
        {descricao && <p className="text-sm text-texto-suave">{descricao}</p>}
      </div>
      {acao && (
        <Button asChild>
          <Link href={acao.href}>{acao.rotulo}</Link>
        </Button>
      )}
      {children}
    </div>
  );
}
