"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { entrarAcao } from "@/acoes/autenticacao";
import { Button } from "@/componentes/ui/button";
import { Input } from "@/componentes/ui/input";
import { Label } from "@/componentes/ui/label";

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginForm() {
  const router = useRouter();
  const parametros = useSearchParams();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erroEmail, setErroEmail] = useState<string | null>(null);
  const [erroSenha, setErroSenha] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    const emailLimpo = email.trim();
    const eEmail = emailLimpo === "" ? "Informe o e-mail." : !REGEX_EMAIL.test(emailLimpo) ? "Informe um e-mail válido." : null;
    const eSenha = senha === "" ? "Informe a senha." : null;
    setErroEmail(eEmail);
    setErroSenha(eSenha);
    setErroGeral(null);
    if (eEmail || eSenha) return;

    iniciar(async () => {
      const r = await entrarAcao({ email: emailLimpo, senha, proximo: parametros.get("proximo") });
      if (!r.ok) {
        setErroGeral(r.erro);
        toast.error(r.erro);
        return;
      }
      router.push(r.dados.destino);
      router.refresh();
    });
  }

  return (
    <form onSubmit={enviar} className="space-y-4" noValidate>
      <div className="space-y-1.5">
        <Label htmlFor="email">E-mail</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setErroEmail(null);
          }}
          aria-invalid={erroEmail !== null}
          aria-describedby={erroEmail ? "erro-email" : undefined}
        />
        {erroEmail && (
          <p id="erro-email" className="text-sm text-critico">
            {erroEmail}
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="senha">Senha</Label>
        <Input
          id="senha"
          type="password"
          autoComplete="current-password"
          value={senha}
          onChange={(e) => {
            setSenha(e.target.value);
            setErroSenha(null);
          }}
          aria-invalid={erroSenha !== null}
          aria-describedby={erroSenha ? "erro-senha" : undefined}
        />
        {erroSenha && (
          <p id="erro-senha" className="text-sm text-critico">
            {erroSenha}
          </p>
        )}
      </div>
      <Button type="submit" className="w-full" disabled={pendente}>
        {pendente && <Loader2 className="animate-spin" aria-hidden />}
        Entrar
      </Button>
      {erroGeral && (
        <p role="alert" className="text-sm text-critico">
          {erroGeral}
        </p>
      )}
    </form>
  );
}
