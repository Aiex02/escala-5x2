/** Retorno padrão das Server Actions: nunca lançam erro para o cliente. */
export type Resultado<T> = { ok: true; dados: T } | { ok: false; erro: string; codigo?: string };

export function ok<T>(dados: T): Resultado<T> {
  return { ok: true, dados };
}

export function falha<T = never>(erro: string, codigo?: string): Resultado<T> {
  return codigo ? { ok: false, erro, codigo } : { ok: false, erro };
}
