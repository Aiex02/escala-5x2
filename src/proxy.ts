import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { configSupabase } from "@/lib/env";
import { decidirAcesso } from "@/lib/autenticacao/rotas";

/** Renova a sessão do Supabase e protege todas as rotas (só `/login` é pública). */
export async function proxy(request: NextRequest) {
  let resposta = NextResponse.next({ request });
  const { url, chave } = configSupabase();

  const supabase = createServerClient(url, chave, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (lista) => {
        lista.forEach(({ name, value }) => request.cookies.set(name, value));
        resposta = NextResponse.next({ request });
        lista.forEach(({ name, value, options }) => resposta.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const autenticado = Boolean(data?.claims);

  const decisao = decidirAcesso(request.nextUrl.pathname, autenticado, request.nextUrl.search);
  if (decisao.tipo === "naoAutorizado") {
    return NextResponse.json({ erro: "Faça login para continuar." }, { status: 401 });
  }
  if (decisao.tipo === "redirecionar") {
    const redirecionamento = NextResponse.redirect(new URL(decisao.destino, request.url));
    resposta.cookies.getAll().forEach((c) => redirecionamento.cookies.set(c));
    return redirecionamento;
  }
  return resposta;
}

// Só ficam de fora os assets estáticos. `/api` e Server Actions (POSTs nas páginas)
// passam pelo proxy de propósito, para também exigirem login.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
