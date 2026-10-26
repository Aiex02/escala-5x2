// Funções (cargos) dos funcionários: chave normalizada, nome de exibição e agrupamento.
// A chave segue `chave_funcao` do backend (crates/escala-core/src/modelo.rs): "Farmacêutica (o)" e
// "farmaceutica" viram "farmaceutica". Ao alterar um lado, altere o outro.

import type { FuncionarioResumo } from "../api/types";
import { compararTexto } from "./formato";

const ACENTOS: readonly (readonly [RegExp, string])[] = [
  [/[áàâãä]/g, "a"],
  [/[éèêë]/g, "e"],
  [/[íìîï]/g, "i"],
  [/[óòôõö]/g, "o"],
  [/[úùûü]/g, "u"],
  [/ç/g, "c"],
];

/** Cargo normalizado: minúsculas, sem "(a)", "(o)", "(as)", "(os)", sem acentos e só letras e números. */
export function chaveFuncao(cargo: string): string {
  let texto = cargo.toLowerCase().replace(/\((?:as|os|a|o)\)/g, "");
  for (const [padrao, letra] of ACENTOS) texto = texto.replace(padrao, letra);
  return texto.replace(/[^\p{L}\p{N}]/gu, "");
}

/** Grafia mais usada entre os cargos; no empate vale a primeira em ordem alfabética (como no backend). */
export function nomeMaisComum(cargos: readonly string[]): string {
  const contagem = new Map<string, number>();
  for (const cargo of cargos) {
    const nome = cargo.trim();
    if (nome) contagem.set(nome, (contagem.get(nome) ?? 0) + 1);
  }
  let melhor = "";
  let melhorTotal = 0;
  for (const [nome, total] of contagem) {
    if (total > melhorTotal || (total === melhorTotal && nome < melhor)) {
      melhor = nome;
      melhorTotal = total;
    }
  }
  return melhor;
}

/** Função já existente no cadastro: uma por chave, com a grafia mais comum e quantas pessoas a têm. */
export interface FuncaoExistente {
  chave: string;
  nome: string;
  pessoas: number;
}

/** Agrupa os cargos do cadastro por chave (cargos vazios ficam de fora), em ordem alfabética. */
export function funcoesExistentes(cargos: readonly (string | null)[]): FuncaoExistente[] {
  const porChave = new Map<string, string[]>();
  for (const cargo of cargos) {
    const chave = cargo ? chaveFuncao(cargo) : "";
    if (chave) porChave.set(chave, [...(porChave.get(chave) ?? []), cargo ?? ""]);
  }
  return [...porChave]
    .map(([chave, lista]) => ({ chave, nome: nomeMaisComum(lista), pessoas: lista.length }))
    .sort((a, b) => compararTexto(a.nome, b.nome));
}

/** Pessoas de uma mesma função (ou sem função, com `chave` nula) no Quadro. */
export interface GrupoFuncao {
  chave: string | null;
  nome: string;
  membros: FuncionarioResumo[];
}

export const NOME_SEM_FUNCAO = "Sem função";

/**
 * Funcionários agrupados por função: grupos em ordem alfabética pelo nome da função e, dentro
 * deles, por nome; quem não tem cargo vem num último grupo "Sem função".
 */
export function agruparPorFuncao(funcionarios: readonly FuncionarioResumo[]): GrupoFuncao[] {
  const porChave = new Map<string | null, FuncionarioResumo[]>();
  for (const f of funcionarios) {
    const chave = f.funcao ?? null;
    porChave.set(chave, [...(porChave.get(chave) ?? []), f]);
  }
  const grupos: GrupoFuncao[] = [...porChave].map(([chave, membros]) => ({
    chave,
    nome: chave === null ? NOME_SEM_FUNCAO : nomeMaisComum(membros.flatMap((m) => (m.cargo ? [m.cargo] : []))) || chave,
    membros: [...membros].sort((a, b) => compararTexto(a.nome, b.nome)),
  }));
  return grupos.sort((a, b) => {
    if (a.chave === null || b.chave === null) return Number(a.chave === null) - Number(b.chave === null);
    return compararTexto(a.nome, b.nome);
  });
}
