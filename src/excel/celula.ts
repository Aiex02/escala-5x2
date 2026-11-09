import type { CellValue, Worksheet } from "exceljs";
import { semAcentos } from "./texto";
import type { DataISO } from "./tipos";

/** Resultado de uma leitura tipada: `valor` nulo = célula vazia; `erro` = conteúdo inválido. */
export type Leitura<T> = { valor: T | null; erro?: string };

type Simples = string | number | boolean | Date | { erro: string } | null;

/** Reduz o `CellValue` variado do exceljs (rich text, fórmula, link, erro) a um valor simples. */
function simplificar(valor: CellValue | undefined): Simples {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === "string" || typeof valor === "number" || typeof valor === "boolean") {
    return valor;
  }
  if (valor instanceof Date) return valor;
  if ("error" in valor) return { erro: String(valor.error) };
  if ("richText" in valor) return valor.richText.map((p) => p.text).join("");
  if ("formula" in valor || "sharedFormula" in valor) {
    return simplificar(valor.result as CellValue | undefined);
  }
  if ("hyperlink" in valor) return typeof valor.text === "string" ? valor.text : valor.hyperlink;
  return null;
}

function dataParaISO(d: Date): DataISO | null {
  if (Number.isNaN(d.getTime())) return null;
  const a = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const dia = d.getUTCDate();
  return `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Texto aparado da célula, ou `null` se vazia (ou erro do Excel). */
export function texto(valor: CellValue | undefined): string | null {
  const s = simplificar(valor);
  if (s === null) return null;
  let t: string;
  if (typeof s === "string") t = s.trim();
  else if (typeof s === "number") t = String(s);
  else if (typeof s === "boolean") t = s ? "sim" : "não";
  else if (s instanceof Date) t = dataParaISO(s) ?? "";
  else return null;
  return t === "" ? null : t;
}

export function erroExcel(valor: CellValue | undefined): string | null {
  const s = simplificar(valor);
  if (s !== null && typeof s === "object" && !(s instanceof Date)) {
    return `célula com erro do Excel (${s.erro})`;
  }
  return null;
}

export function vazia(valor: CellValue | undefined): boolean {
  return texto(valor) === null && erroExcel(valor) === null;
}

/** Número; aceita `37,5`, `36h` e `36 h`. */
export function numero(valor: CellValue | undefined): Leitura<number> {
  const erro = erroExcel(valor);
  if (erro) return { valor: null, erro };
  const s = simplificar(valor);
  if (s === null) return { valor: null };
  if (typeof s === "number") {
    return Number.isFinite(s) ? { valor: s } : { valor: null, erro: `"${s}" não é um número` };
  }
  if (typeof s === "string") {
    const t = s.trim().toLowerCase();
    if (t === "") return { valor: null };
    const limpo = t.replace(/\s*h$/, "").replace(",", ".");
    const n = /^[+-]?\d+(\.\d+)?$/.test(limpo) ? Number(limpo) : Number.NaN;
    return Number.isFinite(n) ? { valor: n } : { valor: null, erro: `"${s.trim()}" não é um número` };
  }
  return { valor: null, erro: `"${texto(valor) ?? ""}" não é um número` };
}

export function simNao(valor: CellValue | undefined): Leitura<boolean> {
  const erro = erroExcel(valor);
  if (erro) return { valor: null, erro };
  const t = texto(valor);
  if (t === null) return { valor: null };
  switch (semAcentos(t)) {
    case "sim":
    case "s":
    case "x":
    case "true":
    case "verdadeiro":
    case "1":
      return { valor: true };
    case "nao":
    case "n":
    case "false":
    case "falso":
    case "0":
      return { valor: false };
    default:
      return { valor: null, erro: `"${t}" inválida; use Sim ou Não (ou deixe vazia)` };
  }
}

/** Monta `AAAA-MM-DD` validando o calendário (rejeita 31/02). */
function montarData(a: number, m: number, d: number): DataISO | null {
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dataParaISO(dt);
}

/** Data de célula de data, serial do Excel ou texto `dd/mm/aaaa`, `dd-mm-aaaa`, `dd.mm.aaaa`, `aaaa-mm-dd`. */
export function data(valor: CellValue | undefined): Leitura<DataISO> {
  const erro = erroExcel(valor);
  if (erro) return { valor: null, erro };
  const invalida = (v: string): Leitura<DataISO> => ({
    valor: null,
    erro: `data "${v}" inválida; use dd/mm/aaaa`,
  });
  const s = simplificar(valor);
  if (s === null) return { valor: null };
  if (s instanceof Date) {
    const iso = dataParaISO(s);
    return iso ? { valor: iso } : invalida(String(s));
  }
  if (typeof s === "number") {
    if (s < 1 || s > 100000) return invalida(String(s));
    const iso = dataParaISO(new Date(Date.UTC(1899, 11, 30) + Math.floor(s) * 86_400_000));
    return iso ? { valor: iso } : invalida(String(s));
  }
  if (typeof s === "string") {
    const t = s.trim();
    if (t === "") return { valor: null };
    let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
    if (m) {
      const iso = montarData(Number(m[3]), Number(m[2]), Number(m[1]));
      return iso ? { valor: iso } : invalida(t);
    }
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(t);
    if (m) {
      const iso = montarData(Number(m[1]), Number(m[2]), Number(m[3]));
      return iso ? { valor: iso } : invalida(t);
    }
    return invalida(t);
  }
  return invalida(texto(valor) ?? "");
}

export type LinhaPlanilha = {
  /** Número da linha no Excel (1 = primeira). */
  numero: number;
  /** Índice 0 = coluna A. Células mescladas "escravas" vêm como `null`. */
  celulas: CellValue[];
};

/** Linhas não vazias da aba com os valores por coluna absoluta. */
export function linhasDaAba(aba: Worksheet): LinhaPlanilha[] {
  const linhas: LinhaPlanilha[] = [];
  const colunas = aba.columnCount;
  aba.eachRow({ includeEmpty: false }, (linha, numero) => {
    const celulas: CellValue[] = [];
    for (let c = 1; c <= colunas; c++) {
      const cel = linha.getCell(c);
      celulas.push(cel.isMerged && cel.master !== cel ? null : cel.value);
    }
    if (celulas.some((v) => !vazia(v))) linhas.push({ numero, celulas });
  });
  return linhas;
}
