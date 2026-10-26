import { api } from "../api/client";
import type { ModeloFuncionamento } from "../api/types";
import { useCarregar } from "./useCarregar";

let lista: Promise<ModeloFuncionamento[]> | null = null;

/** Os modelos não mudam com o app aberto: busca uma vez e repete a resposta (uma falha não fica guardada). */
function carregarModelos(): Promise<ModeloFuncionamento[]> {
  lista ??= api.listarModelos().catch((erro: unknown) => {
    lista = null;
    throw erro;
  });
  return lista;
}

/** Modelos de funcionamento do backend, para a tela de Configurações e a criação de cliente. */
export function useModelos() {
  return useCarregar(carregarModelos, []);
}
