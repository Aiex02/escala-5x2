"use client";

import { useEffect, useState } from "react";
import { CalendarRange } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/componentes/ui/sheet";
import { ScrollArea } from "@/componentes/ui/scroll-area";
import { BotaoSair } from "@/componentes/autenticacao/BotaoSair";
import { AlternadorTema } from "./AlternadorTema";
import { AnosEMeses } from "./AnosEMeses";
import { NavegacaoCliente } from "./NavegacaoCliente";
import { SeletorCliente } from "./SeletorCliente";

/** Evento disparado pelo botão de menu do cabeçalho (telas < 1024px). */
export const EVENTO_ABRIR_MENU = "abrir-menu-lateral";

type Props = {
  clientes: { id: string; nome: string }[];
  clienteId: string;
  meses: { ano: number; mes: number }[];
  hoje: { ano: number; mes: number };
  usuarioEmail?: string | null;
};

function Conteudo({
  clientes,
  clienteId,
  meses,
  hoje,
  usuarioEmail,
  aoNavegar,
}: Props & { aoNavegar?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <span className="grid size-7 place-items-center rounded-md bg-acento text-acento-texto">
          <CalendarRange className="size-4" aria-hidden />
        </span>
        <span className="font-display text-lg font-semibold tracking-tight">Escalas</span>
      </div>
      <div className="px-3 pb-3">
        <SeletorCliente clientes={clientes} clienteId={clienteId} aoNavegar={aoNavegar} />
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className="px-3 pb-4">
          <h2 className="px-2.5 pb-2 text-[0.7rem] font-medium uppercase tracking-wide text-texto-suave">Escalas</h2>
          <AnosEMeses clienteId={clienteId} meses={meses} hoje={hoje} aoNavegar={aoNavegar} />
        </div>
      </ScrollArea>
      <div className="border-t border-borda px-3 py-2">
        <NavegacaoCliente clienteId={clienteId} aoNavegar={aoNavegar} />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-borda px-4 py-2">
        {usuarioEmail && (
          <span className="truncate text-xs text-texto-suave" title={usuarioEmail}>
            {usuarioEmail}
          </span>
        )}
        <BotaoSair className="ml-auto" />
      </div>
      <div className="flex items-center justify-between border-t border-borda px-4 py-2">
        <span className="text-xs text-texto-suave">Tema</span>
        <AlternadorTema />
      </div>
    </div>
  );
}

export function Sidebar(props: Props) {
  const [aberta, setAberta] = useState(false);

  useEffect(() => {
    const abrir = () => setAberta(true);
    window.addEventListener(EVENTO_ABRIR_MENU, abrir);
    return () => window.removeEventListener(EVENTO_ABRIR_MENU, abrir);
  }, []);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-borda bg-superficie lg:block">
        <Conteudo {...props} />
      </aside>
      <Sheet open={aberta} onOpenChange={setAberta}>
        <SheetContent side="left" className="w-60 gap-0 p-0 sm:max-w-60" showCloseButton={false}>
          <SheetTitle className="sr-only">Menu</SheetTitle>
          <SheetDescription className="sr-only">
            Cliente, escalas por ano e navegação
          </SheetDescription>
          <Conteudo {...props} aoNavegar={() => setAberta(false)} />
        </SheetContent>
      </Sheet>
    </>
  );
}
