// Horas do dia (minutos desde a meia-noite) e faixas de trabalho (entrada, saída, intervalo).

import { ErroMotor } from "./erros";

/** Minutos em um dia. */
export const MINUTOS_DIA = 24 * 60;

/** Faixa de trabalho: se `fimMin <= inicioMin` a jornada atravessa a meia-noite. */
export interface Horario {
  /** Entrada, em minutos desde a meia-noite (0..1439). */
  inicioMin: number;
  /** Saída, em minutos desde a meia-noite (0..1439). */
  fimMin: number;
  /** Intervalo não remunerado, em minutos. */
  intervaloMin: number;
}

/** `"07:30"` a partir de minutos do dia (dá a volta após 24h). */
export function formatarHora(minutos: number): string {
  const m = ((Math.round(minutos) % MINUTOS_DIA) + MINUTOS_DIA) % MINUTOS_DIA;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Duração como `8h` ou `7h30` (`0h05` para menos de uma hora). */
export function formatarMinutos(minutos: number): string {
  const negativo = minutos < 0;
  const total = Math.abs(Math.round(minutos));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const texto = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
  return negativo ? `-${texto}` : texto;
}

/** `10:00–16:15` */
export function formatarHorario(h: Horario): string {
  return `${formatarHora(h.inicioMin)}–${formatarHora(h.fimMin)}`;
}

const PADRAO_HORA = /^(\d{1,2})[:h](\d{1,2})?(?::(\d{1,2}))?$/;

/**
 * Lê `HH:MM`, `H:MM`, `HH:MM:SS` (segundos só se zero), `HHhMM` e `HHh`; devolve minutos do dia.
 * Lança `ErroMotor` ("horaInvalida") se o texto não for uma hora entre 00:00 e 23:59.
 */
export function analisarHora(texto: string): number {
  const t = texto.trim().toLowerCase();
  if (t === "") throw new ErroMotor("horaInvalida", "Horário vazio.");
  const m = PADRAO_HORA.exec(t);
  if (!m) {
    throw new ErroMotor("horaInvalida", `Horário "${texto.trim()}" inválido; use o formato HH:MM (ex.: 07:30).`);
  }
  const hora = Number(m[1]);
  const minuto = m[2] === undefined ? 0 : Number(m[2]);
  const segundo = m[3] === undefined ? 0 : Number(m[3]);
  if (segundo !== 0) {
    throw new ErroMotor("horaInvalida", `Horário "${texto.trim()}" inválido; use o formato HH:MM (ex.: 07:30).`);
  }
  if (hora > 23 || minuto > 59) {
    throw new ErroMotor("horaInvalida", `Horário "${texto.trim()}" fora do intervalo 00:00–23:59.`);
  }
  return hora * 60 + minuto;
}

/** Igual a `analisarHora`, mas devolve `null` em vez de lançar. */
export function tentarAnalisarHora(texto: string): number | null {
  try {
    return analisarHora(texto);
  } catch {
    return null;
  }
}

/** `true` se a jornada termina no dia seguinte. */
export function atravessaMeiaNoite(h: Horario): boolean {
  return h.fimMin <= h.inicioMin;
}

/** Da entrada à saída, incluindo o intervalo. */
export function duracaoTotal(h: Horario): number {
  return atravessaMeiaNoite(h) ? MINUTOS_DIA - h.inicioMin + h.fimMin : h.fimMin - h.inicioMin;
}

/** Tempo efetivamente trabalhado (conta para a carga diária e semanal). */
export function minutosTrabalhados(h: Horario): number {
  return Math.max(0, duracaoTotal(h) - h.intervaloMin);
}

/** Cria um horário validando entrada, saída e intervalo. Lança `ErroMotor` se inválido. */
export function criarHorario(inicioMin: number, fimMin: number, intervaloMin = 0): Horario {
  const inteiro = (n: number) => Number.isInteger(n);
  if (!inteiro(inicioMin) || !inteiro(fimMin) || inicioMin < 0 || inicioMin >= MINUTOS_DIA || fimMin < 0 || fimMin >= MINUTOS_DIA) {
    throw new ErroMotor("horarioInvalido", "Entrada e saída devem estar entre 00:00 e 23:59.");
  }
  if (inicioMin === fimMin) {
    throw new ErroMotor("horarioInvalido", `Entrada e saída não podem ser iguais (${formatarHora(inicioMin)}).`);
  }
  if (!inteiro(intervaloMin) || intervaloMin < 0) {
    throw new ErroMotor("horarioInvalido", "O intervalo deve ser um número inteiro de minutos, zero ou mais.");
  }
  const horario: Horario = { inicioMin, fimMin, intervaloMin };
  const duracao = duracaoTotal(horario);
  if (intervaloMin >= duracao) {
    throw new ErroMotor("horarioInvalido", `Intervalo de ${intervaloMin} min não cabe em uma jornada de ${duracao} min.`);
  }
  return horario;
}

/** Como `criarHorario`, mas devolve `null` em vez de lançar. */
export function tentarCriarHorario(inicioMin: number, fimMin: number, intervaloMin = 0): Horario | null {
  try {
    return criarHorario(inicioMin, fimMin, intervaloMin);
  } catch {
    return null;
  }
}

export function horariosIguais(a: Horario, b: Horario): boolean {
  return a.inicioMin === b.inicioMin && a.fimMin === b.fimMin && a.intervaloMin === b.intervaloMin;
}
