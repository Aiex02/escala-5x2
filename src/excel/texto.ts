/** Minúsculas, sem acento e só letras/dígitos: "Matrícula " → "matricula", "intervalo_min" → "intervalomin". */
export function normalizar(texto: string): string {
  return semAcentos(texto).replace(/[^a-z0-9]/g, "");
}

/** Minúsculas e sem acento, preservando o resto. */
export function semAcentos(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Colapsa espaços repetidos (inclusive quebras de linha) em um só. */
export function colapsarEspacos(texto: string): string {
  return texto.replace(/\s+/g, " ").trim();
}
