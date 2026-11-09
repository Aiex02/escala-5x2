import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { configSupabase } from "@/lib/env";

/** Cliente Supabase do servidor, ligado aos cookies da requisição. */
export async function criarClienteServidor(): Promise<SupabaseClient> {
  const store = await cookies();
  const { url, chave } = configSupabase();
  return createServerClient(url, chave, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (lista) => {
        try {
          lista.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Chamado de Server Component: o proxy renova a sessão.
        }
      },
    },
  });
}

export type Usuario = { id: string; email: string | null };

/** Usuário autenticado pelos cookies da requisição, ou null. Só chame dentro de Suspense/ação. */
export async function obterUsuario(): Promise<Usuario | null> {
  try {
    const supabase = await criarClienteServidor();
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (error || !claims?.sub) return null;
    return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
  } catch (erro) {
    console.error(erro);
    return null;
  }
}
