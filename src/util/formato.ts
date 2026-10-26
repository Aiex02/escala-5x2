// Formatação de durações, números e textos.

/** Minutos -> "8h" ou "7h30". */
export function formatarMinutos(minutos: number): string {
  const total = Math.max(0, Math.round(minutos));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/** Número com vírgula decimal e até `casas` casas: 37.5 -> "37,5". */
export function formatarNumero(n: number, casas = 2): string {
  const fator = 10 ** casas;
  return String(Math.round(n * fator) / fator).replace(".", ",");
}

/** Horas decimais -> "37,5h". */
export function formatarHoras(horas: number): string {
  return `${formatarNumero(horas)}h`;
}

/** "HH:MM" -> minutos desde a meia-noite (null se inválido). */
export function horaParaMinutos(hora: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hora.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Duração total do turno em minutos; fim <= início atravessa a meia-noite. */
export function duracaoTurnoMinutos(inicio: string, fim: string): number | null {
  const i = horaParaMinutos(inicio);
  const f = horaParaMinutos(fim);
  if (i === null || f === null) return null;
  return f <= i ? f + 1440 - i : f - i;
}

export function atravessaMeiaNoite(inicio: string, fim: string): boolean {
  const i = horaParaMinutos(inicio);
  const f = horaParaMinutos(fim);
  return i !== null && f !== null && f <= i;
}

/** Remove acentos e caixa para buscas e comparações. */
export function normalizarTexto(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function compararTexto(a: string, b: string): number {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}

export function pluralizar(n: number, singular: string, plural: string): string {
  return `${n} ${n === 1 ? singular : plural}`;
}

export function corHexValida(valor: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(valor.trim());
}
