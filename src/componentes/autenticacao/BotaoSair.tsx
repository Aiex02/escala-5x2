"use client";

import { useTransition } from "react";
import { Loader2, LogOut } from "lucide-react";
import { sairAcao } from "@/acoes/autenticacao";
import { Button } from "@/componentes/ui/button";

export function BotaoSair({ className }: { className?: string }) {
  const [pendente, iniciar] = useTransition();

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={className}
      disabled={pendente}
      onClick={() =>
        iniciar(async () => {
          await sairAcao();
        })
      }
    >
      {pendente ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
      Sair
    </Button>
  );
}
