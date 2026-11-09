import type { ReactNode } from "react";
import { BotaoMenu } from "./BotaoMenu";

type Props = {
  titulo: string;
  /** Slot de ações primárias, alinhado à direita. */
  acoes?: ReactNode;
};

export function Cabecalho({ titulo, acoes }: Props) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-borda bg-fundo/90 px-4 backdrop-blur sm:px-6">
      <BotaoMenu />
      <h1 className="truncate font-display text-xl font-semibold">{titulo}</h1>
      {acoes && <div className="ml-auto flex items-center gap-2">{acoes}</div>}
    </header>
  );
}
