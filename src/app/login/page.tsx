import { Suspense } from "react";
import { CalendarRange } from "lucide-react";
import { LoginForm } from "@/componentes/autenticacao/LoginForm";

export const metadata = { title: "Entrar — Escalas" };

export default function PaginaLogin() {
  return (
    <main className="grid min-h-screen place-items-center bg-fundo p-4">
      <div className="w-full max-w-sm space-y-6 rounded-lg border border-borda bg-superficie p-6">
        <div className="flex items-center gap-2">
          <span className="grid size-7 place-items-center rounded-md bg-acento text-acento-texto">
            <CalendarRange className="size-4" aria-hidden />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight">Escalas</span>
        </div>
        <div>
          <h1 className="font-display text-xl font-semibold">Entrar</h1>
          <p className="text-sm text-texto-suave">Acesse o organizador de escalas.</p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
