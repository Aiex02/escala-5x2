// Máscaras de dias de uma semana de apuração, usadas no planejamento das folgas.
//
// Cada semana tem 7 posições (bit 0 = primeiro dia da semana de apuração). Uma máscara diz
// quais posições entram num conjunto (dias de trabalho, dias de folga...). Uso interno do motor.

/** Conjunto de posições da semana de apuração (bit 0 = primeiro dia). */
export type MascaraSemana = number;

export const SEMANA_TODA: MascaraSemana = 0b111_1111;

/** Posições (0 a 6) presentes na máscara, em ordem. */
export function posicoes(m: MascaraSemana): number[] {
  return [0, 1, 2, 3, 4, 5, 6].filter((i) => (m & (1 << i)) !== 0);
}

export function contarPosicoes(m: MascaraSemana): number {
  return posicoes(m).length;
}

const cacheEscolhas = new Map<number, MascaraSemana[]>();

/** Todas as máscaras com exatamente `k` posições escolhidas entre as de `livres` (em cache). */
export function escolhas(livres: MascaraSemana, k: number): readonly MascaraSemana[] {
  const chave = livres * 8 + k;
  const guardado = cacheEscolhas.get(chave);
  if (guardado) return guardado;
  const calculado = gerarEscolhas(livres, k);
  cacheEscolhas.set(chave, calculado);
  return calculado;
}

function gerarEscolhas(livres: MascaraSemana, k: number): MascaraSemana[] {
  const pos = posicoes(livres);
  const resultado: MascaraSemana[] = [];
  if (k < 0 || k > pos.length) return resultado;
  const rec = (i: number, faltam: number, acc: MascaraSemana): void => {
    if (faltam === 0) {
      resultado.push(acc);
      return;
    }
    if (pos.length - i < faltam) return;
    const p = pos[i] ?? 0;
    rec(i + 1, faltam - 1, acc | (1 << p));
    rec(i + 1, faltam, acc);
  };
  rec(0, k, 0);
  return resultado;
}

/** Quantos blocos de dias seguidos há na máscara (2 folgas juntas = 1 bloco). */
export function contarBlocos(m: MascaraSemana): number {
  let blocos = 0;
  for (let i = 0; i < 7; i++) {
    if ((m & (1 << i)) !== 0 && (i === 0 || (m & (1 << (i - 1))) === 0)) blocos++;
  }
  return blocos;
}

export interface CorridaDaSemana {
  /** Maior sequência de dias trabalhados que toca a semana (inclusive os dias antes e depois dela). */
  maxima: number;
  /** Dias trabalhados seguidos até o fim da semana (inclusive os de antes, se a semana toda foi trabalhada). */
  final: number;
}

/**
 * Sequências de dias trabalhados de uma semana: `trabalho` é a máscara dos dias trabalhados,
 * `antes` os dias seguidos trabalhados logo antes da semana e `depois` os logo depois dela.
 */
export function corridaDaSemana(trabalho: MascaraSemana, antes: number, depois: number): CorridaDaSemana {
  let corrida = antes;
  let maxima = antes;
  for (let i = 0; i < 7; i++) {
    corrida = (trabalho & (1 << i)) !== 0 ? corrida + 1 : 0;
    maxima = Math.max(maxima, corrida);
  }
  if (corrida > 0) maxima = Math.max(maxima, corrida + depois);
  return { maxima, final: corrida };
}
