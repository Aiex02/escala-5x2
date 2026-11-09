/** Cores dos turnos, na ordem em que são distribuídas. */
export const CORES_TURNO = ["#E3B341", "#E8794A", "#5B6CFF", "#2BB3A3", "#C65B9E", "#8A9A3B"] as const;

/** Próxima cor da paleta que não está em `usadas`; se todas estiverem em uso, recomeça o ciclo. */
export function proximaCorLivre(usadas: readonly string[]): string {
  const emUso = new Set(usadas.map((c) => c.toUpperCase()));
  const livre = CORES_TURNO.find((c) => !emUso.has(c.toUpperCase()));
  return livre ?? CORES_TURNO[usadas.length % CORES_TURNO.length];
}
