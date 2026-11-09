import { z } from "zod";
import { revalidatePath } from "next/cache";
import { falha, ok, type Resultado } from "@/lib/resultado";
import { ErroMotor } from "@/motor";
import { ErroPlanilha } from "@/excel";
import { ErroCadastro } from "@/servicos/erroCadastro";

/** Roda a operação e converte qualquer erro em `Resultado` (Server Actions nunca lançam). */
export async function executarCadastro<T>(operacao: () => Promise<T>): Promise<Resultado<T>> {
  try {
    return ok(await operacao());
  } catch (erro) {
    if (erro instanceof ErroCadastro || erro instanceof ErroMotor || erro instanceof ErroPlanilha) {
      return falha(erro.message);
    }
    console.error(erro);
    return falha("Não foi possível concluir a operação. Tente novamente.");
  }
}

/** Valida a entrada com zod e devolve a primeira mensagem de erro em português. */
export function validar<S extends z.ZodType>(esquema: S, entrada: unknown): { ok: true; dados: z.output<S> } | { ok: false; erro: string } {
  const r = esquema.safeParse(entrada);
  if (r.success) return { ok: true, dados: r.data };
  return { ok: false, erro: r.error.issues[0]?.message ?? "Dados inválidos." };
}

/** Atualiza as telas do cliente (inclui a sidebar, que vive no layout). */
export function revalidarCliente(): void {
  revalidatePath("/clientes/[clienteId]", "layout");
}

/** Atualiza também a lista de clientes (sidebar de todas as telas). */
export function revalidarTudo(): void {
  revalidatePath("/", "layout");
}
