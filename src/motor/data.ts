// Aritmética de datas do calendário civil, sem fuso: uma data é a string `AAAA-MM-DD`
// e os cálculos passam por "dias desde 1970-01-01" via Date.UTC (nunca depende do fuso local).

/** Data civil no formato ISO `AAAA-MM-DD`. */
export type DataISO = string;

const MS_DIA = 86_400_000;
/** Dias entre 0001-01-01 (dia 1 da era comum) e 1970-01-01. */
const DIAS_ATE_EPOCA = 719_163;

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})$/;

const dois = (n: number): string => String(n).padStart(2, "0");

/** Monta `AAAA-MM-DD` a partir de ano, mês (1–12) e dia, sem validar. */
export function montarData(ano: number, mes: number, dia: number): DataISO {
  return `${String(ano).padStart(4, "0")}-${dois(mes)}-${dois(dia)}`;
}

/** `true` se o texto é uma data real do calendário (ex.: 2027-02-29 não é). */
export function ehValida(texto: string): boolean {
  const m = FORMATO.exec(texto);
  if (!m) return false;
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  // Date.UTC trata anos 0–99 como 1900–1999; corrige para manter o ano exato.
  d.setUTCFullYear(ano);
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

const memoria = new Map<DataISO, number>();

/** Dias desde 1970-01-01 (negativo antes). Lança se a data for inválida. */
export function diasDesdeEpoca(data: DataISO): number {
  const guardado = memoria.get(data);
  if (guardado !== undefined) return guardado;
  if (!ehValida(data)) throw new RangeError(`data inválida: "${data}"`);
  const m = FORMATO.exec(data);
  const [ano, mes, dia] = [Number(m?.[1]), Number(m?.[2]), Number(m?.[3])];
  const d = new Date(Date.UTC(2000, mes - 1, dia));
  d.setUTCFullYear(ano);
  const dias = Math.round(d.getTime() / MS_DIA);
  if (memoria.size > 20_000) memoria.clear();
  memoria.set(data, dias);
  return dias;
}

/** Data a partir de "dias desde 1970-01-01". */
export function dataDeDias(dias: number): DataISO {
  const d = new Date(dias * MS_DIA);
  return montarData(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Dias desde 0001-01-01 (dia 1), referência estável para rodízios e sequências. */
export function diasDesdeEra(data: DataISO): number {
  return diasDesdeEpoca(data) + DIAS_ATE_EPOCA;
}

/** Dia da semana: 0 = segunda ... 6 = domingo. */
export function diaDaSemana(data: DataISO): number {
  // 1970-01-01 foi quinta-feira (índice 3).
  return (((diasDesdeEpoca(data) + 3) % 7) + 7) % 7;
}

export function somarDias(data: DataISO, dias: number): DataISO {
  return dataDeDias(diasDesdeEpoca(data) + dias);
}

/** -1, 0 ou 1 (datas ISO ordenam como texto). */
export function compararDatas(a: DataISO, b: DataISO): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Dias de `a` até `b` (positivo se `b` é depois). */
export function diasEntre(a: DataISO, b: DataISO): number {
  return diasDesdeEpoca(b) - diasDesdeEpoca(a);
}

export function ehBissexto(ano: number): boolean {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

/** Número de dias do mês (`mes` de 1 a 12). */
export function diasDoMes(ano: number, mes: number): number {
  if (mes === 2) return ehBissexto(ano) ? 29 : 28;
  return [4, 6, 9, 11].includes(mes) ? 30 : 31;
}

export function primeiroDiaDoMes(ano: number, mes: number): DataISO {
  return montarData(ano, mes, 1);
}

export function ultimoDiaDoMes(ano: number, mes: number): DataISO {
  return montarData(ano, mes, diasDoMes(ano, mes));
}

/** Soma meses; se o dia não existir no mês de destino, usa o último dia dele (31/12 + 2 = 28/02). */
export function somarMeses(data: DataISO, meses: number): DataISO {
  const m = FORMATO.exec(data);
  if (!m || !ehValida(data)) throw new RangeError(`data inválida: "${data}"`);
  const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const total = ano * 12 + (mes - 1) + meses;
  const anoNovo = Math.floor(total / 12);
  const mesNovo = (((total % 12) + 12) % 12) + 1;
  return montarData(anoNovo, mesNovo, Math.min(dia, diasDoMes(anoNovo, mesNovo)));
}

/** Todas as datas de `inicio` a `fim`, inclusive (vazio se `fim` < `inicio`). */
export function datasDoIntervalo(inicio: DataISO, fim: DataISO): DataISO[] {
  const a = diasDesdeEpoca(inicio);
  const b = diasDesdeEpoca(fim);
  const datas: DataISO[] = [];
  for (let d = a; d <= b; d++) datas.push(dataDeDias(d));
  return datas;
}

/** `dd/mm` */
export function formatarDiaMes(data: DataISO): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

/** `dd/mm/aaaa` */
export function formatarDataBR(data: DataISO): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}/${data.slice(0, 4)}`;
}
