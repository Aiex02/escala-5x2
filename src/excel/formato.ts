/** Minutos como `6h15` (negativos com sinal). */
export function formatarMinutos(minutos: number): string {
  const sinal = minutos < 0 ? "-" : "";
  const abs = Math.abs(Math.round(minutos));
  return `${sinal}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, "0")}`;
}

/** Saldo com sinal explícito: `+2h30`, `-1h00`, `0h00`. */
export function formatarSaldo(minutos: number): string {
  return minutos > 0 ? `+${formatarMinutos(minutos)}` : formatarMinutos(minutos);
}

/** Minutos do dia como `HH:MM` (24h = `24:00`). */
export function formatarHora(minutos: number): string {
  const m = ((Math.round(minutos) % 1440) + 1440) % 1440;
  const final = minutos === 1440 ? 1440 : m;
  return `${String(Math.floor(final / 60)).padStart(2, "0")}:${String(final % 60).padStart(2, "0")}`;
}

/** `AAAA-MM-DD` → `DD/MM/AAAA`. */
export function dataBR(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
