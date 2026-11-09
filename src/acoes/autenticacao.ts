"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { falha, ok, type Resultado } from "@/lib/resultado";
import { criarClienteServidor } from "@/lib/supabase/servidor";
import { ROTA_LOGIN, destinoSeguro } from "@/lib/autenticacao/rotas";
import { validar } from "./executarCadastro";

const esquemaEntrar = z.object({
  email: z.email("Informe um e-mail válido."),
  senha: z.string().min(1, "Informe a senha."),
  proximo: z.string().nullish(),
});

/** Entra com e-mail e senha pelo Supabase Auth. */
export async function entrarAcao(entrada: {
  email: string;
  senha: string;
  proximo?: string | null;
}): Promise<Resultado<{ destino: string }>> {
  const v = validar(esquemaEntrar, entrada);
  if (!v.ok) return falha(v.erro);
  try {
    const supabase = await criarClienteServidor();
    const { error } = await supabase.auth.signInWithPassword({
      email: v.dados.email,
      password: v.dados.senha,
    });
    if (error) {
      if (error.code === "invalid_credentials" || error.message === "Invalid login credentials") {
        return falha("E-mail ou senha incorretos.");
      }
      if (error.code === "email_not_confirmed") return falha("Confirme seu e-mail antes de entrar.");
      console.error(error);
      return falha("Não foi possível entrar. Tente novamente.");
    }
    return ok({ destino: destinoSeguro(v.dados.proximo) });
  } catch (erro) {
    console.error(erro);
    return falha("Não foi possível entrar. Tente novamente.");
  }
}

/** Encerra a sessão e volta para o login. */
export async function sairAcao(): Promise<never> {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect(ROTA_LOGIN);
}
