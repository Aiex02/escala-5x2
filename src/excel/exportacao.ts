import ExcelJS from "exceljs";
import { dataBR, formatarHora, formatarMinutos, formatarSaldo } from "./formato";
import type { CelulaExportavel, EscalaExportavel, OpcoesExportacao } from "./tipos";

const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
const DIAS_CURTOS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

const COR_TITULO = "FF1F5F66";
const COR_FIM_DE_SEMANA = "FFE9ECEE";
const COR_GRUPO = "FFD7E3E5";
const COR_FALTA = "FFF4C7C3";
const COR_JUSTIFICADA = "FFCFE2F3";
const BORDA: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFB0B7BB" } },
  left: { style: "thin", color: { argb: "FFB0B7BB" } },
  bottom: { style: "thin", color: { argb: "FFB0B7BB" } },
  right: { style: "thin", color: { argb: "FFB0B7BB" } },
};

function preenchimento(argb: string): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb } };
}

/** `#RRGGBB` / `#RGB` → `FFRRGGBB`; inválido vira cinza. */
function argbDeHex(hex: string): string {
  let h = hex.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split("").map((c) => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(h) ? `FF${h.toUpperCase()}` : "FFCCCCCC";
}

/** Texto preto ou branco conforme a luminância do fundo. */
function corDoTexto(argb: string): string {
  const r = parseInt(argb.slice(2, 4), 16);
  const g = parseInt(argb.slice(4, 6), 16);
  const b = parseInt(argb.slice(6, 8), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "FF1A1A1A" : "FFFFFFFF";
}

function fimDeSemana(diaSemana: number): boolean {
  return diaSemana >= 5;
}

function faixa(inicioMin: number, fimMin: number): string {
  return `${formatarHora(inicioMin)}-${formatarHora(fimMin)}`;
}

function configurarImpressao(aba: ExcelJS.Worksheet, titulos: string): void {
  aba.pageSetup = {
    paperSize: 9,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: true,
    printTitlesRow: titulos,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
}

function titulo(aba: ExcelJS.Worksheet, texto: string, ultimaColuna: number): void {
  aba.mergeCells(1, 1, 1, ultimaColuna);
  const c = aba.getCell(1, 1);
  c.value = texto;
  c.font = { bold: true, size: 14, color: { argb: COR_TITULO } };
  c.alignment = { vertical: "middle", horizontal: "left" };
  aba.getRow(1).height = 24;
}

function cabecalhoCelula(c: ExcelJS.Cell, fundo: string = COR_TITULO): void {
  c.font = { bold: true, color: { argb: corDoTexto(fundo) } };
  c.fill = preenchimento(fundo);
  c.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  c.border = BORDA;
}

export async function exportarEscala(
  escala: EscalaExportavel,
  opcoes: OpcoesExportacao = {},
): Promise<Uint8Array> {
  const pasta = new ExcelJS.Workbook();
  pasta.creator = "Organizador de Escalas";
  const nomeMes = MESES[escala.mes - 1] ?? String(escala.mes);
  const rotuloMes = `${nomeMes.charAt(0).toUpperCase()}${nomeMes.slice(1)}/${escala.ano}`;

  montarEscala(pasta, escala, opcoes, rotuloMes);
  montarHorasSemana(pasta, escala, rotuloMes);

  return new Uint8Array(await pasta.xlsx.writeBuffer());
}

function montarEscala(
  pasta: ExcelJS.Workbook,
  escala: EscalaExportavel,
  opcoes: OpcoesExportacao,
  rotuloMes: string,
): void {
  const aba = pasta.addWorksheet("Escala", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 4 }],
  });
  const nDias = escala.dias.length;
  const colPrimeiroDia = 2;
  const colHoras = colPrimeiroDia + nDias;
  const ultima = colHoras + 2;
  const turnos = new Map(escala.turnos.map((t) => [t.id, t]));
  const horarioNaCelula = opcoes.horarioNaCelula === true;

  aba.getColumn(1).width = 30;
  for (let i = 0; i < nDias; i++) aba.getColumn(colPrimeiroDia + i).width = horarioNaCelula ? 7.5 : 5;
  for (let i = 0; i < 3; i++) aba.getColumn(colHoras + i).width = 13;

  titulo(aba, `Escala de trabalho — ${escala.cliente} — ${rotuloMes}`, ultima);

  // Cabeçalho em duas linhas: dia da semana e número do dia.
  aba.mergeCells(3, 1, 4, 1);
  aba.getCell(3, 1).value = "Funcionário";
  cabecalhoCelula(aba.getCell(3, 1));
  aba.getCell(3, 1).alignment = { horizontal: "left", vertical: "middle" };
  escala.dias.forEach((d, i) => {
    const col = colPrimeiroDia + i;
    const fundo = fimDeSemana(d.diaSemana) ? "FF5E7378" : COR_TITULO;
    const sem = aba.getCell(3, col);
    sem.value = DIAS_CURTOS[d.diaSemana] ?? "";
    cabecalhoCelula(sem, fundo);
    const num = aba.getCell(4, col);
    num.value = Number(d.data.slice(8, 10));
    cabecalhoCelula(num, fundo);
  });
  ["Horas no mês", "Saldo", "Acumulado"].forEach((rotulo, i) => {
    aba.mergeCells(3, colHoras + i, 4, colHoras + i);
    aba.getCell(3, colHoras + i).value = rotulo;
    cabecalhoCelula(aba.getCell(3, colHoras + i));
  });

  // Linhas agrupadas por função.
  const grupos = new Map<string, EscalaExportavel["linhas"]>();
  for (const l of escala.linhas) {
    const chave = l.cargo?.trim() || "Sem função";
    const g = grupos.get(chave);
    if (g) g.push(l);
    else grupos.set(chave, [l]);
  }
  let linhaAtual = 5;
  for (const [cargo, membros] of grupos) {
    aba.mergeCells(linhaAtual, 1, linhaAtual, ultima);
    const g = aba.getCell(linhaAtual, 1);
    g.value = cargo;
    g.font = { bold: true };
    g.fill = preenchimento(COR_GRUPO);
    linhaAtual++;
    for (const membro of membros) {
      const nome = aba.getCell(linhaAtual, 1);
      nome.value = membro.funcionario;
      nome.border = BORDA;
      nome.alignment = { vertical: "middle", indent: 1 };
      membro.dias.forEach((c, i) => {
        const dia = escala.dias[i];
        escreverCelulaDia(aba.getCell(linhaAtual, colPrimeiroDia + i), c, turnos, horarioNaCelula, dia ? fimDeSemana(dia.diaSemana) : false);
      });
      const stats: [string, boolean][] = [
        [formatarMinutos(membro.horasMesMin), false],
        [formatarSaldo(membro.saldoMin), membro.saldoMin < 0],
        [formatarSaldo(membro.acumuladoMin), membro.acumuladoMin < 0],
      ];
      stats.forEach(([texto, negativo], i) => {
        const c = aba.getCell(linhaAtual, colHoras + i);
        c.value = texto;
        c.border = BORDA;
        c.alignment = { horizontal: "right", vertical: "middle" };
        if (negativo) c.font = { color: { argb: "FFB00020" } };
      });
      aba.getRow(linhaAtual).height = horarioNaCelula ? 44 : 18;
      linhaAtual++;
    }
  }
  const ultimaLinhaDados = linhaAtual - 1;

  // Totais por turno por dia.
  linhaAtual++;
  aba.mergeCells(linhaAtual, 1, linhaAtual, ultima);
  aba.getCell(linhaAtual, 1).value = "Pessoas por turno em cada dia";
  aba.getCell(linhaAtual, 1).font = { bold: true };
  linhaAtual++;
  for (const t of escala.turnos) {
    const fundo = argbDeHex(t.cor);
    const rotulo = aba.getCell(linhaAtual, 1);
    rotulo.value = `${t.sigla} — ${t.nome}`;
    rotulo.fill = preenchimento(fundo);
    rotulo.font = { bold: true, color: { argb: corDoTexto(fundo) } };
    rotulo.border = BORDA;
    escala.dias.forEach((d, i) => {
      const n = escala.linhas.reduce((acc, l) => {
        const c = l.dias[i];
        return acc + (c?.tipo === "turno" && c.turnoId === t.id ? 1 : 0);
      }, 0);
      const c = aba.getCell(linhaAtual, colPrimeiroDia + i);
      c.value = n;
      c.alignment = { horizontal: "center" };
      c.border = BORDA;
      if (fimDeSemana(d.diaSemana)) c.fill = preenchimento(COR_FIM_DE_SEMANA);
      if (n === 0) c.font = { color: { argb: "FF9AA3A7" } };
    });
    linhaAtual++;
  }
  const total = aba.getCell(linhaAtual, 1);
  total.value = "Total trabalhando";
  total.font = { bold: true };
  total.border = BORDA;
  escala.dias.forEach((_, i) => {
    const n = escala.linhas.reduce((acc, l) => acc + (l.dias[i]?.tipo === "turno" ? 1 : 0), 0);
    const c = aba.getCell(linhaAtual, colPrimeiroDia + i);
    c.value = n;
    c.font = { bold: true };
    c.alignment = { horizontal: "center" };
    c.border = BORDA;
  });
  linhaAtual += 2;

  // Legenda.
  aba.getCell(linhaAtual, 1).value = "Legenda";
  aba.getCell(linhaAtual, 1).font = { bold: true };
  linhaAtual++;
  for (const t of escala.turnos) {
    const fundo = argbDeHex(t.cor);
    const sigla = aba.getCell(linhaAtual, 1);
    sigla.value = `${t.sigla} — ${t.nome}`;
    sigla.fill = preenchimento(fundo);
    sigla.font = { bold: true, color: { argb: corDoTexto(fundo) } };
    aba.getCell(linhaAtual, 2).value =
      `${faixa(t.inicioMin, t.fimMin)}, intervalo de ${t.intervaloMin} min`;
    linhaAtual++;
  }
  const outros = ["F — Folga", "A — Falta", "J — Ausência justificada", "* — Jornada compensada", "+ — Hora extra"];
  for (const r of outros) {
    aba.getCell(linhaAtual, 1).value = r;
    linhaAtual++;
  }

  configurarImpressao(aba, "3:4");
  aba.pageSetup.printArea = `A1:${aba.getColumn(ultima).letter}${Math.max(linhaAtual, ultimaLinhaDados)}`;
}

function escreverCelulaDia(
  c: ExcelJS.Cell,
  dado: CelulaExportavel,
  turnos: Map<string, EscalaExportavel["turnos"][number]>,
  horarioNaCelula: boolean,
  fds: boolean,
): void {
  c.border = BORDA;
  c.alignment = { horizontal: "center", vertical: "middle", wrapText: horarioNaCelula };
  if (fds) c.fill = preenchimento(COR_FIM_DE_SEMANA);
  switch (dado.tipo) {
    case "turno": {
      const t = turnos.get(dado.turnoId);
      const fundo = argbDeHex(t?.cor ?? "#CCCCCC");
      const sigla = `${t?.sigla ?? "?"}${dado.compensada ? "*" : ""}${dado.horaExtra ? "+" : ""}`;
      const horario = faixa(dado.inicioMin, dado.fimMin);
      c.value = horarioNaCelula
        ? `${sigla}\n${formatarHora(dado.inicioMin)}\n${formatarHora(dado.fimMin)}`
        : sigla;
      c.fill = preenchimento(fundo);
      c.font = { bold: true, color: { argb: corDoTexto(fundo) } };
      c.note = `${t?.nome ?? "Turno"} ${horario}, intervalo de ${dado.intervaloMin} min${dado.compensada ? " (jornada compensada)" : ""}${dado.horaExtra ? " (hora extra)" : ""}`;
      break;
    }
    case "folga":
      c.value = "F";
      c.font = { color: { argb: "FF7A858A" } };
      break;
    case "falta":
      c.value = "A";
      c.font = { bold: true, color: { argb: "FFB00020" } };
      c.fill = preenchimento(COR_FALTA);
      break;
    case "justificada":
      c.value = "J";
      c.font = { bold: true, color: { argb: "FF1F4E79" } };
      c.fill = preenchimento(COR_JUSTIFICADA);
      if (dado.motivo) c.note = dado.motivo;
      break;
    case "vazio":
      break;
  }
}

function montarHorasSemana(pasta: ExcelJS.Workbook, escala: EscalaExportavel, rotuloMes: string): void {
  const aba = pasta.addWorksheet("Horas por semana", {
    views: [{ state: "frozen", xSplit: 1, ySplit: 3 }],
  });
  const nSem = escala.semanas.length;
  const ultima = 1 + (nSem + 1) * 3;
  aba.getColumn(1).width = 30;
  for (let c = 2; c <= ultima; c++) aba.getColumn(c).width = 10;
  titulo(aba, `Horas por semana — ${escala.cliente} — ${rotuloMes}`, ultima);

  aba.mergeCells(2, 1, 3, 1);
  aba.getCell(2, 1).value = "Funcionário";
  cabecalhoCelula(aba.getCell(2, 1));
  aba.getCell(2, 1).alignment = { horizontal: "left", vertical: "middle" };
  const rotulos = [
    ...escala.semanas.map((s) => `${dataBR(s.inicio).slice(0, 5)} a ${dataBR(s.fim).slice(0, 5)}`),
    "Mês",
  ];
  rotulos.forEach((r, i) => {
    const c0 = 2 + i * 3;
    aba.mergeCells(2, c0, 2, c0 + 2);
    aba.getCell(2, c0).value = r;
    cabecalhoCelula(aba.getCell(2, c0));
    ["Feito", "Previsto", "Saldo"].forEach((sub, j) => {
      const c = aba.getCell(3, c0 + j);
      c.value = sub;
      cabecalhoCelula(c, "FF3E7F86");
    });
  });

  let linha = 4;
  for (const f of escala.horasSemana) {
    const nome = aba.getCell(linha, 1);
    nome.value = f.funcionario;
    nome.border = BORDA;
    let feitoTotal = 0;
    let previstoTotal = 0;
    const escrever = (c0: number, feito: number, previsto: number): void => {
      const saldo = feito - previsto;
      const valores: [string, boolean][] = [
        [formatarMinutos(feito), false],
        [formatarMinutos(previsto), false],
        [formatarSaldo(saldo), saldo < 0],
      ];
      valores.forEach(([texto, neg], j) => {
        const c = aba.getCell(linha, c0 + j);
        c.value = texto;
        c.border = BORDA;
        c.alignment = { horizontal: "right" };
        if (neg) {
          c.font = { color: { argb: "FFB00020" } };
          c.fill = preenchimento(COR_FALTA);
        }
      });
    };
    for (let i = 0; i < nSem; i++) {
      const s = f.semanas[i] ?? { feitoMin: 0, previstoMin: 0 };
      feitoTotal += s.feitoMin;
      previstoTotal += s.previstoMin;
      escrever(2 + i * 3, s.feitoMin, s.previstoMin);
    }
    escrever(2 + nSem * 3, feitoTotal, previstoTotal);
    linha++;
  }
  configurarImpressao(aba, "2:3");
}
