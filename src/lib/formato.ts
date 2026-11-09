/** Duração em minutos → "6h30" (sem minutos quando zerados: "6h"). */
export function formatarMinutos(minutos: number): string {
  const total = Math.round(Math.abs(minutos));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Minutos do dia → "10:00". */
export function formatarHora(minutosDoDia: number): string {
  const h = Math.floor(minutosDoDia / 60);
  const m = minutosDoDia % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Saldo em minutos → "−2h", "+1h30" ou "0h" (usa o sinal de menos tipográfico). */
export function formatarSaldo(minutos: number): string {
  if (minutos === 0) return "0h";
  const sinal = minutos < 0 ? "−" : "+";
  return `${sinal}${formatarMinutos(minutos)}`;
}
