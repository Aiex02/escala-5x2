"use server";

import { z } from "zod";
import { falha, type Resultado } from "@/lib/resultado";
import { criarCliente, excluirCliente, renomearCliente } from "@/servicos/clientes";
import { executarCadastro, revalidarTudo, validar } from "./executarCadastro";

const esquemaCriar = z.object({
  nome: z.string().trim().min(2, "Informe o nome do cliente (ao menos 2 letras).").max(80, "O nome deve ter até 80 caracteres."),
  /** Id do modelo pronto ou `null` para personalizado. */
  modelo: z.string().min(1).nullable(),
});

/** Cria o cliente com o modelo escolhido. Devolve o id para o redirecionamento. */
export async function criarClienteAcao(entrada: { nome: string; modelo: string | null }): Promise<Resultado<{ id: string }>> {
  const v = validar(esquemaCriar, entrada);
  if (!v.ok) return falha(v.erro);
  const r = await executarCadastro(() => criarCliente(v.dados));
  if (r.ok) revalidarTudo();
  return r;
}

const esquemaId = z.string().min(1);

export async function renomearClienteAcao(clienteId: string, nome: string): Promise<Resultado<null>> {
  const v = validar(z.object({ clienteId: esquemaId, nome: esquemaCriar.shape.nome }), { clienteId, nome });
  if (!v.ok) return falha(v.erro);
  const r = await executarCadastro(async () => {
    await renomearCliente(v.dados.clienteId, v.dados.nome);
    return null;
  });
  if (r.ok) revalidarTudo();
  return r;
}

export async function excluirClienteAcao(clienteId: string): Promise<Resultado<null>> {
  const v = validar(esquemaId, clienteId);
  if (!v.ok) return falha(v.erro);
  const r = await executarCadastro(async () => {
    await excluirCliente(v.dados);
    return null;
  });
  if (r.ok) revalidarTudo();
  return r;
}
