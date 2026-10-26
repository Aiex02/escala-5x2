// Helpers de data. Todas as datas são strings "YYYY-MM-DD" e a aritmética é
// feita em UTC, para nunca sofrer deslocamento de fuso horário.

import type { InicioSemana } from "../api/types";

export const NOMES_MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const;

/** Índice 0 = segunda ... 6 = domingo. */
export const DIAS_SEMANA_CURTO = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;
export const DIAS_SEMANA_LONGO = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
] as const;
export const LETRAS_DIAS = ["S", "T", "Q", "Q", "S", "S", "D"] as const;

const MS_POR_DIA = 86_400_000;

function dois(n: number): string {
  return String(n).padStart(2, "0");
}

export function nomeMes(mes: number): string {
  return NOMES_MESES[mes - 1] ?? "";
}

/** "Março de 2026" */
export function tituloMes(ano: number, mes: number): string {
  return `${nomeMes(mes)} de ${ano}`;
}

export function montarData(ano: number, mes: number, dia: number): string {
  return `${String(ano).padStart(4, "0")}-${dois(mes)}-${dois(dia)}`;
}

export function separarData(data: string): { ano: number; mes: number; dia: number } {
  const [a = "0", m = "1", d = "1"] = data.slice(0, 10).split("-");
  return { ano: Number(a), mes: Number(m), dia: Number(d) };
}

/** Número de dias desde 1970-01-01 (UTC). */
export function dataParaDias(data: string): number {
  const { ano, mes, dia } = separarData(data);
  return Math.round(Date.UTC(ano, mes - 1, dia) / MS_POR_DIA);
}

export function diasParaData(dias: number): string {
  const d = new Date(dias * MS_POR_DIA);
  return montarData(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function adicionarDias(data: string, n: number): string {
  return diasParaData(dataParaDias(data) + n);
}

/** 0 = segunda ... 6 = domingo (1970-01-01 foi uma quinta-feira). */
export function diaDaSemana(data: string): number {
  return (((dataParaDias(data) + 3) % 7) + 7) % 7;
}

export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

export function ultimoDiaDoMes(ano: number, mes: number): string {
  return montarData(ano, mes, diasNoMes(ano, mes));
}

export function chaveMes(ano: number, mes: number): string {
  return `${ano}-${dois(mes)}`;
}

export function dataNoMes(data: string, ano: number, mes: number): boolean {
  const d = separarData(data);
  return d.ano === ano && d.mes === mes;
}

/** Dia da semana (0 = segunda) em que a semana de apuração começa. */
export function indiceInicioSemana(inicio: InicioSemana): number {
  return inicio === "domingo" ? 6 : 0;
}

/** Índices dos dias (0 = segunda ... 6 = domingo) na ordem de exibição das colunas. */
export function ordemDiasSemana(inicio: InicioSemana): number[] {
  const base = indiceInicioSemana(inicio);
  return Array.from({ length: 7 }, (_, i) => (base + i) % 7);
}

/** Primeiro dia da semana de apuração que contém `data`. */
export function inicioDaSemana(data: string, inicio: InicioSemana): string {
  const recuo = (diaDaSemana(data) - indiceInicioSemana(inicio) + 7) % 7;
  return adicionarDias(data, -recuo);
}

/** Todas as datas da grade do calendário: semanas completas cobrindo o mês. */
export function celulasCalendario(ano: number, mes: number, inicio: InicioSemana): string[] {
  const primeira = inicioDaSemana(montarData(ano, mes, 1), inicio);
  const ultima = adicionarDias(inicioDaSemana(ultimoDiaDoMes(ano, mes), inicio), 6);
  const total = dataParaDias(ultima) - dataParaDias(primeira) + 1;
  return Array.from({ length: total }, (_, i) => adicionarDias(primeira, i));
}

/** Data local de hoje, "YYYY-MM-DD". */
export function hojeISO(): string {
  const d = new Date();
  return montarData(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

/** "2026-03-09" -> "09/03" */
export function formatarDiaMes(data: string): string {
  const { mes, dia } = separarData(data);
  return `${dois(dia)}/${dois(mes)}`;
}

/** "2026-03-09" -> "09/03/2026" */
export function formatarData(data: string): string {
  const { ano, mes, dia } = separarData(data);
  return `${dois(dia)}/${dois(mes)}/${ano}`;
}

/** "2026-03-09" -> "9 de março de 2026" */
export function formatarDataExtenso(data: string): string {
  const { ano, mes, dia } = separarData(data);
  return `${dia} de ${nomeMes(mes).toLowerCase()} de ${ano}`;
}

/** "2026-03-09 14:05:33" -> "09/03/2026 às 14:05" */
export function formatarGeradoEm(valor: string): string {
  const [data = "", hora = ""] = valor.split(/[ T]/);
  const hhmm = hora.slice(0, 5);
  return hhmm ? `${formatarData(data)} às ${hhmm}` : formatarData(data);
}

export function formatarPeriodo(inicio: string, fim: string): string {
  return inicio === fim ? formatarData(inicio) : `${formatarData(inicio)} a ${formatarData(fim)}`;
}
