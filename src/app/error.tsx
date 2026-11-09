"use client";

import { TriangleAlert } from "lucide-react";
import { Button } from "@/componentes/ui/button";

export default function Erro({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl p-6 pt-24">
      <div className="flex flex-col items-start gap-3 rounded-lg border border-critico/40 bg-critico/5 p-6">
        <TriangleAlert className="size-5 text-critico" aria-hidden />
        <h1 className="font-display text-lg font-semibold">Algo deu errado</h1>
        <p className="text-sm text-texto-suave">
          Não foi possível carregar esta página. Tente novamente.
        </p>
        <Button onClick={reset}>Tentar de novo</Button>
      </div>
    </main>
  );
}
