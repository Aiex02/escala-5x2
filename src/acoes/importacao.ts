"use server";

import { falha, type Resultado } from "@/lib/resultado";
import type { ResultadoImportacaoDto } from "@/servicos/dto";
import { importarPlanilha } from "@/servicos/importacao";
import { executarCadastro, revalidarCliente } from "./executarCadastro";

const LIMITE_BYTES = 10 * 1024 * 1024;

/**
 * Recebe o `FormData` com `arquivo` (.xlsx) e `modo` ("validar" só simula; "importar" grava).
 */
export async function importarPlanilhaAcao(clienteId: string, formulario: FormData): Promise<Resultado<ResultadoImportacaoDto>> {
  const arquivo = formulario.get("arquivo");
  const modo = formulario.get("modo");
  if (typeof clienteId !== "string" || clienteId === "") return falha("Cliente inválido.");
  if (!(arquivo instanceof File) || arquivo.size === 0) return falha("Escolha um arquivo .xlsx para continuar.");
  if (!arquivo.name.toLowerCase().endsWith(".xlsx")) return falha("O arquivo deve ser uma planilha .xlsx.");
  if (arquivo.size > LIMITE_BYTES) return falha("O arquivo passa de 10 MB.");
  const simular = modo !== "importar";

  const r = await executarCadastro(async () => {
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    return importarPlanilha(clienteId, bytes, simular);
  });
  if (r.ok && !simular) revalidarCliente();
  return r;
}
