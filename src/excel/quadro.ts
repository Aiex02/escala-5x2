import type { CellValue, Workbook } from "exceljs";
import * as celula from "./celula";
import type { LinhaPlanilha } from "./celula";
import { colapsarEspacos, normalizar } from "./texto";
import type { FuncionarioLido, LeituraPlanilha, LinhaRejeitada } from "./tipos";
import { ErroPlanilha } from "./tipos";

type Col = "cod" | "nome" | "funcao" | "secao" | "numero" | "serie" | "entrada" | "saida";
type Mapa = Partial<Record<Col, number>>;

/** Ordem fixa A..K do documento: Cód, Nome, Função, Seção, Número, Série, Ent., Intervalo, Saída, Des, Visto. */
const ORDEM_FIXA: Mapa = {
  cod: 0,
  nome: 1,
  funcao: 2,
  secao: 3,
  numero: 4,
  serie: 5,
  entrada: 6,
  saida: 8,
};

const APELIDOS: Record<Col, string[]> = {
  cod: ["cod", "codigo"],
  nome: ["nomedofuncionario", "nomefuncionario", "nome", "funcionario"],
  funcao: ["funcao", "nomedafuncao", "nomedofuncao", "cargo"],
  secao: ["secao", "setor"],
  numero: ["numero", "num", "nctps", "ctps", "numeroctps", "numerodactps"],
  serie: ["serie", "seriectps"],
  entrada: ["ent", "entrada"],
  saida: ["saida"],
};

const LINHAS_DETECCAO = 10;

function textosDaLinha(linha: LinhaPlanilha): string[] {
  return linha.celulas.map(celula.texto).filter((t): t is string => t !== null);
}

function mapaPorTitulos(linha: LinhaPlanilha): Mapa {
  const mapa: Mapa = {};
  linha.celulas.forEach((v, i) => {
    const t = celula.texto(v);
    if (!t) return;
    const k = normalizar(t);
    for (const col of Object.keys(APELIDOS) as Col[]) {
      if (mapa[col] === undefined && APELIDOS[col].includes(k)) mapa[col] = i;
    }
  });
  return mapa;
}

/** Cabeçalho de colunas: célula única com o texto inteiro (PDF convertido) ou células separadas. */
function cabecalhoDeColunas(linha: LinhaPlanilha): Mapa | null {
  const unico = textosDaLinha(linha).some((t) => {
    const n = normalizar(t);
    return n.includes("nomedofuncionario") && n.includes("saida");
  });
  if (unico) return { ...ORDEM_FIXA };
  const mapa = mapaPorTitulos(linha);
  return mapa.nome !== undefined && mapa.entrada !== undefined && mapa.saida !== undefined
    ? mapa
    : null;
}

function ehTituloOuEmpregador(texto: string): boolean {
  const n = normalizar(texto);
  return (
    n.startsWith("horariodetrabalho") ||
    n.startsWith("quadrodehorario") ||
    n.startsWith("empregador")
  );
}

/** Heurística: a aba traz o título do quadro, "Nome do Funcionário" ou cabeçalho Função + CTPS sem Matrícula. */
function pareceQuadro(linhas: LinhaPlanilha[]): boolean {
  for (const linha of linhas.slice(0, LINHAS_DETECCAO)) {
    const chaves = textosDaLinha(linha).map(normalizar);
    if (chaves.some((k) => k.includes("horariodetrabalho") || k.includes("nomedofuncionario"))) {
      return true;
    }
    const tem = (...nomes: string[]) => chaves.some((k) => nomes.includes(k));
    if (
      tem("funcao") &&
      tem("ctps", "numero", "numeroctps", "nctps") &&
      !tem("matricula", "registro", "cracha")
    ) {
      return true;
    }
  }
  return false;
}

/** Nome da primeira aba com cara de quadro de horário, ou `null`. */
export function abaDoQuadro(pasta: Workbook): string | null {
  for (const aba of pasta.worksheets) {
    if (pareceQuadro(celula.linhasDaAba(aba))) return aba.name;
  }
  return null;
}

/** Lê só os dados das pessoas do quadro; horários, sábados e rodapés são ignorados. */
export function lerQuadro(pasta: Workbook, nomeAba: string): LeituraPlanilha {
  const aba = pasta.getWorksheet(nomeAba);
  if (!aba) throw new ErroPlanilha(`Aba "${nomeAba}" não encontrada.`);
  const resultado: LeituraPlanilha = {
    formato: "quadro",
    funcionarios: [],
    ausencias: [],
    rejeitadas: [],
    avisos: [
      "Formato \"Quadro de Horário de Trabalho\" detectado: só os dados das pessoas foram lidos; os horários vêm do funcionamento do cliente.",
    ],
    totalLinhas: 0,
  };
  let mapa: Mapa | null = null;
  let emObservacao = false;
  const matriculas = new Map<string, number>();

  const cel = (linha: LinhaPlanilha, col: Col): CellValue | undefined => {
    const i = mapa?.[col];
    return i === undefined ? undefined : linha.celulas[i];
  };
  const txt = (linha: LinhaPlanilha, col: Col): string | null => {
    const t = celula.texto(cel(linha, col));
    return t === null ? null : colapsarEspacos(t) || null;
  };

  for (const linha of celula.linhasDaAba(aba)) {
    if (mapa === null) {
      mapa = cabecalhoDeColunas(linha);
      continue;
    }
    // Cabeçalho de página repetido (título, empregador, colunas): reinicia a leitura.
    if (cabecalhoDeColunas(linha) !== null || textosDaLinha(linha).some(ehTituloOuEmpregador)) {
      emObservacao = false;
      continue;
    }
    if (textosDaLinha(linha).some((t) => normalizar(t).startsWith("observac"))) {
      emObservacao = true;
    }
    if (emObservacao) continue;

    const nome = txt(linha, "nome");
    const cod = txt(linha, "cod");
    const ctps = txt(linha, "numero");
    const funcao = txt(linha, "funcao");
    const temHorario = !celula.vazia(cel(linha, "entrada")) || !celula.vazia(cel(linha, "saida"));

    // Sem Cód nem Nome: 2ª linha do funcionário (sábado) ou lixo de página.
    if (nome === null && cod === null) continue;
    if (nome !== null && cod === null && ctps === null && funcao === null && !temHorario) {
      resultado.avisos.push(`Linha ${linha.numero}: ignorada, não parece funcionário.`);
      continue;
    }

    resultado.totalLinhas++;
    const erros: string[] = [];
    if (nome === null) erros.push("nome do funcionário não informado");
    const matricula = ctps ?? cod;
    if (matricula === null) {
      erros.push("sem número de CTPS nem código (Cód) para identificar o funcionário");
    } else {
      const anterior = matriculas.get(matricula);
      if (anterior !== undefined) {
        erros.push(`matrícula ${matricula} repetida (já aparece na linha ${anterior})`);
      } else {
        matriculas.set(matricula, linha.numero);
      }
    }
    if (ctps === null && matricula !== null && nome !== null) {
      resultado.avisos.push(
        `Linha ${linha.numero} (${nome}): sem número de CTPS; usado o código ${matricula} como matrícula.`,
      );
    }

    if (erros.length > 0 || nome === null || matricula === null) {
      const rej: LinhaRejeitada = { aba: aba.name, linha: linha.numero, erros };
      if (matricula !== null) rej.matricula = matricula;
      resultado.rejeitadas.push(rej);
      continue;
    }
    const f: FuncionarioLido = { linha: linha.numero, matricula, nome };
    if (funcao) f.cargo = funcao;
    const secao = txt(linha, "secao");
    if (secao) f.secao = secao;
    if (ctps) f.ctps = ctps;
    const serie = txt(linha, "serie");
    if (serie) f.ctpsSerie = serie;
    resultado.funcionarios.push(f);
  }

  if (mapa === null) {
    throw new ErroPlanilha(
      `Aba "${aba.name}": cabeçalho do Quadro de Horário (Nome do Funcionário ... Saída) não encontrado.`,
    );
  }
  return resultado;
}
