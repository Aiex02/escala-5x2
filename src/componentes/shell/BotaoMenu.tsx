"use client";

import { Menu } from "lucide-react";
import { Button } from "@/componentes/ui/button";
import { EVENTO_ABRIR_MENU } from "./Sidebar";

/** Abre a sidebar em forma de Sheet (visível só abaixo de 1024px). */
export function BotaoMenu() {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="lg:hidden"
      aria-label="Abrir menu"
      onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_MENU))}
    >
      <Menu />
    </Button>
  );
}
