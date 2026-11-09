/** URL e chave pública do projeto Supabase; erro claro se faltarem. */
export function configSupabase(): { url: string; chave: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const faltando = [
    !url && "NEXT_PUBLIC_SUPABASE_URL",
    !chave && "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  ].filter(Boolean);
  if (!url || !chave) {
    throw new Error(
      `Variáveis de ambiente ausentes: ${faltando.join(", ")}. Defina-as no .env (veja o .env.example).`,
    );
  }
  return { url, chave };
}
