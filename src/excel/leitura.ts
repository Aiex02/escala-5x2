import ExcelJS from "exceljs";
import type { CellValue } from "exceljs";
import * as celula from "./celula";
import type { LinhaPlanilha } from "./celula";
import { abaDoQuadro, lerQuadro } from "./quadro";
import { dataBR } from "./formato";
import { normalizar } from "./texto";
import type {
  AusenciaLida,
  FuncionarioLido,
  LeituraPlanilha,
  LinhaRejeitada,
  Preferencia,
} from "./tipos";
import { ErroPlanilha } from "./tipos";

export const ABA_FUNCIONARIOS = "Funcionarios";
export const ABA_AUSENCIAS = "Ausencias";

type Uso = "obrigatoria" | "opcional" | "ignorada";

type DefColuna<C extends string> = { col: C; rotulo: string; uso: Uso; apelidos: string[] };

type ColFunc = "matricula" | "nome" | "cargo" | "secao" | "ctps" | "preferencia" | "carga" | "horario";
type ColAus = "matricula" | "inicio" | "fim" | "motivo" | "justificada";

const MATRICULA = ["matricula", "registro", "codigo", "cracha"];

const COLUNAS_FUNCIONARIOS: DefColuna<ColFunc>[] = [
  { col: "matricula", rotulo: "matricula", uso: "obrigatoria", apelidos: MATRICULA },
  {
    col: "nome",
    rotulo: "nome",
    uso: "obrigatoria",
    apelidos: ["nome", "funcionario", "colaborador", "nomecompleto"],
  },
  { col: "cargo", rotulo: "cargo", uso: "opcional", apelidos: ["cargo", "funcao"] },
  { col: "secao", rotulo: "secao", uso: "opcional", apelidos: ["secao", "setor"] },
  {
    col: "ctps",
    rotulo: "ctps",
    uso: "opcional",
    apelidos: ["ctps", "numeroctps", "nctps", "carteiradetrabalho"],
  },
  {
    col: "preferencia",
    rotulo: "preferencia",
    uso: "opcional",
    apelidos: ["preferencia", "periodo", "periodopreferido", "preferenciadeperiodo"],
  },
  {
    col: "carga",
    rotulo: "carga_semanal",
    uso: "opcional",
    apelidos: ["cargasemanal", "carga", "horassemanais", "cargahoraria"],
  },
  { col: "horario", rotulo: "turno", uso: "ignorada", apelidos: ["turno", "turnos"] },
  { col: "horario", rotulo: "entrada", uso: "ignorada", apelidos: ["entrada", "horaentrada", "horainicio"] },
  { col: "horario", rotulo: "saida", uso: "ignorada", apelidos: ["saida", "horasaida", "horafim"] },
  {
    col: "horario",
    rotulo: "intervalo_min",
    uso: "ignorada",
    apelidos: ["intervalomin", "intervalo", "intervalominutos", "pausa"],
  },
  {
    col: "horario",
    rotulo: "dias_disponiveis",
    uso: "ignorada",
    apelidos: ["diasdisponiveis", "dias", "disponibilidade", "diasdetrabalho"],
  },
];

const COLUNAS_AUSENCIAS: DefColuna<ColAus>[] = [
  { col: "matricula", rotulo: "matricula", uso: "obrigatoria", apelidos: MATRICULA },
  { col: "inicio", rotulo: "inicio", uso: "obrigatoria", apelidos: ["inicio", "datainicio", "de"] },
  { col: "fim", rotulo: "fim", uso: "opcional", apelidos: ["fim", "datafim", "ate"] },
  { col: "motivo", rotulo: "motivo", uso: "opcional", apelidos: ["motivo", "tipo", "observacao"] },
  {
    col: "justificada",
    rotulo: "justificada",
    uso: "opcional",
    apelidos: ["justificada", "justificado", "abonada", "abonado", "ausenciajustificada"],
  },
];

type AbaPreparada<C extends string> = {
  nome: string;
  colunas: Partial<Record<C, number>>;
  linhas: LinhaPlanilha[];
};

function prepararAba<C extends string>(
  nome: string,
  linhas: LinhaPlanilha[],
  defs: DefColuna<C>[],
  avisos: string[],
): AbaPreparada<C> {
  const [cabecalho, ...dados] = linhas;
  if (!cabecalho) throw new ErroPlanilha(`Aba "${nome}" está vazia.`);
  const colunas: Partial<Record<C, number>> = {};
  const ignoradas: string[] = [];
  const encontradas: string[] = [];
  cabecalho.celulas.forEach((v, i) => {
    const titulo = celula.texto(v);
    if (!titulo) return;
    encontradas.push(titulo);
    const k = normalizar(titulo);
    const def = defs.find((d) => d.apelidos.includes(k));
    if (!def) {
      avisos.push(`Aba ${nome}: coluna "${titulo}" não reconhecida e ignorada.`);
    } else if (def.uso === "ignorada") {
      if (!ignoradas.includes(def.rotulo)) ignoradas.push(def.rotulo);
    } else if (colunas[def.col] === undefined) {
      colunas[def.col] = i;
    } else {
      avisos.push(`Aba ${nome}: coluna "${titulo}" repetida para ${def.rotulo}; usada a primeira.`);
    }
  });
  if (ignoradas.length > 0) {
    avisos.push(
      `Aba ${nome}: colunas de horário ignoradas (${ignoradas.join(", ")}); os horários vêm do funcionamento do cliente.`,
    );
  }
  const faltando = defs
    .filter((d) => d.uso === "obrigatoria" && colunas[d.col] === undefined)
    .map((d) => d.rotulo);
  if (faltando.length > 0) {
    throw new ErroPlanilha(
      `Aba "${nome}": colunas obrigatórias ausentes (${faltando.join(", ")}). Colunas encontradas: ${encontradas.join(", ") || "nenhuma"}.`,
    );
  }
  return { nome, colunas, linhas: dados };
}

function valor<C extends string>(aba: AbaPreparada<C>, linha: LinhaPlanilha, col: C): CellValue | undefined {
  const i = aba.colunas[col];
  return i === undefined ? undefined : linha.celulas[i];
}

function obrigatorio<C extends string>(
  aba: AbaPreparada<C>,
  linha: LinhaPlanilha,
  col: C,
  rotulo: string,
  erros: string[],
): string | null {
  const v = valor(aba, linha, col);
  const e = celula.erroExcel(v);
  if (e) {
    erros.push(`${rotulo}: ${e}`);
    return null;
  }
  const t = celula.texto(v);
  if (t === null) erros.push(`${rotulo} não informado(a)`);
  return t;
}

function coletar<T>(leitura: celula.Leitura<T>, campo: string, erros: string[]): T | null {
  if (leitura.erro) erros.push(`${campo}: ${leitura.erro}`);
  return leitura.valor;
}

function lerPreferencia(texto: string): Preferencia | null {
  switch (normalizar(texto)) {
    case "manha":
    case "m":
      return "MANHA";
    case "tarde":
    case "t":
      return "TARDE";
    case "noite":
    case "n":
      return "NOITE";
    default:
      return null;
  }
}

function lerFuncionarios(aba: AbaPreparada<ColFunc>, r: LeituraPlanilha): void {
  const primeira = new Map<string, number>();
  for (const linha of aba.linhas) {
    r.totalLinhas++;
    const erros: string[] = [];
    const matricula = obrigatorio(aba, linha, "matricula", "matricula", erros);
    const nome = obrigatorio(aba, linha, "nome", "nome", erros);
    if (matricula !== null) {
      const anterior = primeira.get(matricula);
      if (anterior !== undefined) {
        erros.push(`matrícula ${matricula} repetida (já aparece na linha ${anterior})`);
      }
    }

    let preferencia: Preferencia | null = null;
    const vp = valor(aba, linha, "preferencia");
    const ep = celula.erroExcel(vp);
    const tp = celula.texto(vp);
    if (ep) erros.push(`preferencia: ${ep}`);
    else if (tp !== null) {
      preferencia = lerPreferencia(tp);
      if (preferencia === null) {
        erros.push(`preferencia: "${tp}" inválida; use Manhã, Tarde ou Noite (ou deixe vazia)`);
      }
    }

    let cargaMin: number | null = null;
    const horas = coletar(celula.numero(valor(aba, linha, "carga")), "carga_semanal", erros);
    if (horas !== null) {
      if (horas <= 0 || horas > 168) {
        erros.push(`carga_semanal ${horas} fora do intervalo (0 a 168 horas)`);
      } else {
        cargaMin = Math.round(horas * 60);
      }
    }

    if (matricula !== null && !primeira.has(matricula)) primeira.set(matricula, linha.numero);

    if (erros.length > 0 || matricula === null || nome === null) {
      const rej: LinhaRejeitada = { aba: aba.nome, linha: linha.numero, erros };
      if (matricula !== null) rej.matricula = matricula;
      r.rejeitadas.push(rej);
      continue;
    }
    const f: FuncionarioLido = { linha: linha.numero, matricula, nome };
    const cargo = celula.texto(valor(aba, linha, "cargo"));
    if (cargo) f.cargo = cargo;
    const secao = celula.texto(valor(aba, linha, "secao"));
    if (secao) f.secao = secao;
    const ctps = celula.texto(valor(aba, linha, "ctps"));
    if (ctps) f.ctps = ctps;
    if (preferencia) f.preferencia = preferencia;
    if (cargaMin !== null) f.cargaSemanalMin = cargaMin;
    r.funcionarios.push(f);
  }
}

function lerAusencias(aba: AbaPreparada<ColAus>, r: LeituraPlanilha): void {
  const validas = new Set(r.funcionarios.map((f) => f.matricula));
  const rejeitados = new Map(
    r.rejeitadas
      .filter((x) => x.matricula !== undefined && x.aba !== aba.nome)
      .map((x) => [x.matricula as string, x.linha]),
  );
  for (const linha of aba.linhas) {
    const erros: string[] = [];
    const matricula = obrigatorio(aba, linha, "matricula", "matricula", erros);
    const inicio = coletar(celula.data(valor(aba, linha, "inicio")), "inicio", erros);
    let fim = coletar(celula.data(valor(aba, linha, "fim")), "fim", erros);
    const motivo = celula.texto(valor(aba, linha, "motivo"));
    // Vazia = justificada (férias, atestados); a falta precisa ser marcada com "não".
    const justificada =
      coletar(celula.simNao(valor(aba, linha, "justificada")), "justificada", erros) ?? true;
    if (inicio === null && !erros.some((e) => e.startsWith("inicio"))) {
      erros.push("inicio não informado");
    }
    fim = fim ?? inicio;
    if (inicio !== null && fim !== null) {
      if (fim < inicio) {
        erros.push(`fim (${dataBR(fim)}) anterior ao início (${dataBR(inicio)})`);
      } else if ((Date.parse(fim) - Date.parse(inicio)) / 86_400_000 > 366) {
        erros.push("ausência maior que 366 dias");
      }
    }
    if (matricula !== null && !validas.has(matricula)) {
      const l = rejeitados.get(matricula);
      erros.push(
        l !== undefined
          ? `matrícula ${matricula} refere-se a funcionário rejeitado (linha ${l} da aba Funcionarios)`
          : `matrícula ${matricula} não existe na aba Funcionarios`,
      );
    }
    if (erros.length > 0 || matricula === null || inicio === null || fim === null) {
      const rej: LinhaRejeitada = { aba: aba.nome, linha: linha.numero, erros };
      if (matricula !== null) rej.matricula = matricula;
      r.rejeitadas.push(rej);
      continue;
    }
    const a: AusenciaLida = {
      aba: aba.nome,
      linha: linha.numero,
      matricula,
      inicio,
      fim,
      justificada,
    };
    if (motivo) a.motivo = motivo;
    r.ausencias.push(a);
  }
}

/**
 * Lê funcionários (e ausências) de um `.xlsx`, detectando se é a planilha modelo do app
 * ou o Quadro de Horário de Trabalho. Erros de linha vão para `rejeitadas`; só arquivo
 * ilegível ou sem colunas obrigatórias lança `ErroPlanilha`.
 */
export async function lerPlanilhaFuncionarios(arquivo: Uint8Array): Promise<LeituraPlanilha> {
  const pasta = new ExcelJS.Workbook();
  try {
    await pasta.xlsx.load(Buffer.from(arquivo) as never);
  } catch (e) {
    // A mensagem da biblioteca vem em inglês; para o usuário basta dizer o que fazer.
    void e;
    throw new ErroPlanilha(
      "Não foi possível abrir o arquivo. Confira se é uma planilha .xlsx válida (não .xls, .csv ou PDF) e tente de novo.",
    );
  }

  const nomeQuadro = abaDoQuadro(pasta);
  if (nomeQuadro !== null) return lerQuadro(pasta, nomeQuadro);

  const abaFunc =
    pasta.worksheets.find((a) => normalizar(a.name) === normalizar(ABA_FUNCIONARIOS)) ??
    pasta.worksheets.find((a) => !["ausencias", "instrucoes"].includes(normalizar(a.name)));
  if (!abaFunc) throw new ErroPlanilha("A planilha não tem nenhuma aba de funcionários.");

  const r: LeituraPlanilha = {
    formato: "modelo",
    funcionarios: [],
    ausencias: [],
    rejeitadas: [],
    avisos: [],
    totalLinhas: 0,
  };
  lerFuncionarios(
    prepararAba(abaFunc.name, celula.linhasDaAba(abaFunc), COLUNAS_FUNCIONARIOS, r.avisos),
    r,
  );

  const abaAus = pasta.worksheets.find((a) => normalizar(a.name) === normalizar(ABA_AUSENCIAS));
  if (abaAus) {
    const linhas = celula.linhasDaAba(abaAus);
    // Aba de ausências vazia (só o modelo) é ignorada sem erro.
    if (linhas.length > 0) {
      lerAusencias(prepararAba(abaAus.name, linhas, COLUNAS_AUSENCIAS, r.avisos), r);
    }
  }
  return r;
}
