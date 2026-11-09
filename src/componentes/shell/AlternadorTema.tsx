"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/componentes/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/componentes/ui/dropdown-menu";

type Tema = "claro" | "escuro" | "sistema";

const CHAVE = "tema";
const EVENTO = "tema-alterado";

function lerTema(): Tema {
  try {
    const valor = localStorage.getItem(CHAVE);
    if (valor === "claro" || valor === "escuro") return valor;
  } catch {
    // armazenamento indisponível: segue o sistema
  }
  return "sistema";
}

function aplicarTema(tema: Tema) {
  const escuro =
    tema === "escuro" ||
    (tema === "sistema" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", escuro);
}

function assinar(aoMudar: () => void) {
  const consulta = window.matchMedia("(prefers-color-scheme: dark)");
  const aoMudarSistema = () => {
    if (lerTema() === "sistema") aplicarTema("sistema");
    aoMudar();
  };
  consulta.addEventListener("change", aoMudarSistema);
  window.addEventListener(EVENTO, aoMudar);
  window.addEventListener("storage", aoMudar);
  return () => {
    consulta.removeEventListener("change", aoMudarSistema);
    window.removeEventListener(EVENTO, aoMudar);
    window.removeEventListener("storage", aoMudar);
  };
}

const OPCOES: { valor: Tema; rotulo: string; Icone: typeof Sun }[] = [
  { valor: "claro", rotulo: "Claro", Icone: Sun },
  { valor: "escuro", rotulo: "Escuro", Icone: Moon },
  { valor: "sistema", rotulo: "Sistema", Icone: Monitor },
];

export function AlternadorTema() {
  const tema = useSyncExternalStore<Tema>(assinar, lerTema, () => "sistema");

  function escolher(novo: Tema) {
    try {
      localStorage.setItem(CHAVE, novo);
    } catch {
      // sem persistência, mas o tema ainda é aplicado nesta sessão
    }
    aplicarTema(novo);
    window.dispatchEvent(new Event(EVENTO));
  }

  const atual = OPCOES.find((o) => o.valor === tema) ?? OPCOES[2];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Alterar tema">
          <atual.Icone />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPCOES.map(({ valor, rotulo, Icone }) => (
          <DropdownMenuItem key={valor} onSelect={() => escolher(valor)}>
            <Icone />
            {rotulo}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
