"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/componentes/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/componentes/ui/command";
import { cn } from "@/lib/utils";

type Props = {
  clientes: { id: string; nome: string }[];
  clienteId: string;
  aoNavegar?: () => void;
};

export function SeletorCliente({ clientes, clienteId, aoNavegar }: Props) {
  const [aberto, setAberto] = useState(false);
  const roteador = useRouter();
  const atual = clientes.find((c) => c.id === clienteId);

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={aberto}
          aria-label="Selecionar cliente"
          className="flex w-full items-center justify-between gap-2 rounded-md border border-borda bg-superficie-elevada px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
        >
          <span className="min-w-0">
            <span className="block text-[0.7rem] uppercase tracking-wide text-texto-suave">
              Cliente
            </span>
            <span className="block truncate font-medium">{atual?.nome ?? "Selecionar"}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-texto-suave" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[--radix-popover-trigger-width] min-w-56 p-0">
        <Command>
          <CommandInput placeholder="Buscar cliente…" />
          <CommandList>
            <CommandEmpty>Nenhum cliente encontrado.</CommandEmpty>
            <CommandGroup>
              {clientes.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.nome}
                  onSelect={() => {
                    setAberto(false);
                    aoNavegar?.();
                    roteador.push(`/clientes/${c.id}`);
                  }}
                >
                  <span className="truncate">{c.nome}</span>
                  <Check className={cn("ml-auto size-4", c.id === clienteId ? "opacity-100" : "opacity-0")} aria-hidden />
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup>
              <CommandItem
                value="__novo_cliente__"
                onSelect={() => {
                  setAberto(false);
                  aoNavegar?.();
                  roteador.push("/clientes/novo");
                }}
              >
                <Plus className="size-4" aria-hidden />
                Novo cliente
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
