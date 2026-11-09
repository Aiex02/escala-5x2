/**
 * Datas do domínio são strings ISO `AAAA-MM-DD` (`DataISO`).
 *
 * Colunas `@db.Date` do Prisma são lidas/escritas como `Date` em UTC à meia-noite:
 * use `deISO` ao gravar e `paraISO` ao ler. Nunca use fuso local no domínio.
 */
export type DataISO = string;

const MS_DIA = 86_400_000;

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const DIAS_CURTOS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

const dois = (n: number) => String(n).padStart(2, "0");

/** `Date` (UTC) → "AAAA-MM-DD". */
export function paraISO(d: Date): DataISO {
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

/** "AAAA-MM-DD" → `Date` em UTC à meia-noite. */
export function deISO(iso: DataISO): Date {
  const [a, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d));
}

/** Todas as datas do mês (`mes` de 1 a 12). */
export function diasDoMes(ano: number, mes: number): DataISO[] {
  const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${ano}-${dois(mes)}-${dois(i + 1)}`);
}

/** Dia da semana: 0 = segunda … 6 = domingo. */
export function diaDaSemana(iso: DataISO): number {
  return (deISO(iso).getUTCDay() + 6) % 7;
}

export function somarDias(iso: DataISO, dias: number): DataISO {
  return paraISO(new Date(deISO(iso).getTime() + dias * MS_DIA));
}

/** Nome do mês por extenso (`mes` de 1 a 12). */
export function nomeMes(mes: number): string {
  return MESES[mes - 1] ?? "";
}

/** Sigla do dia da semana (0 = segunda … 6 = domingo). */
export function nomeDiaCurto(dia: number): string {
  return DIAS_CURTOS[dia] ?? "";
}

/** Data de hoje (fuso local do servidor/navegador) em ISO. */
export function hojeISO(): DataISO {
  const agora = new Date();
  return `${agora.getFullYear()}-${dois(agora.getMonth() + 1)}-${dois(agora.getDate())}`;
}
