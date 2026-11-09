import ExcelJS from "exceljs";
import { ABA_AUSENCIAS, ABA_FUNCIONARIOS } from "./leitura";

const FORMATO_DATA = "dd/mm/yyyy";

function cabecalho(aba: ExcelJS.Worksheet, titulos: string[], larguras: number[]): void {
  const linha = aba.addRow(titulos);
  linha.font = { bold: true, color: { argb: "FFFFFFFF" } };
  linha.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F5F66" } };
  linha.alignment = { vertical: "middle" };
  larguras.forEach((w, i) => {
    aba.getColumn(i + 1).width = w;
  });
  aba.views = [{ state: "frozen", ySplit: 1 }];
}

/** Planilha modelo do app, com exemplos fictícios, comentários e validação de dados. */
export async function gerarModeloPlanilha(): Promise<Uint8Array> {
  const pasta = new ExcelJS.Workbook();
  pasta.creator = "Organizador de Escalas";

  const func = pasta.addWorksheet(ABA_FUNCIONARIOS);
  cabecalho(
    func,
    ["matricula", "nome", "cargo", "secao", "ctps", "preferencia", "carga_semanal"],
    [14, 32, 18, 16, 14, 16, 16],
  );
  func.addRow(["1001", "Ana Exemplo", "Atendente", "Loja", "123456", "Manhã", 36]);
  func.addRow(["1002", "Bruno Exemplo", "Barista", "Loja", "234567", "Tarde", "37,5"]);
  func.addRow(["1003", "Carla Exemplo", "Cozinheira", "Cozinha", "", "", ""]);
  const notas: [string, string][] = [
    ["A1", "Obrigatória. Identificador único do funcionário."],
    ["B1", "Obrigatória. Nome completo."],
    ["C1", "Opcional. A escala é agrupada por cargo (função)."],
    ["F1", "Opcional: Manhã, Tarde ou Noite. Vazio = sem preferência."],
    ["G1", "Opcional. Horas por semana (36, 37,5 ou 36h)."],
  ];
  for (const [endereco, texto] of notas) func.getCell(endereco).note = texto;
  for (let l = 2; l <= 500; l++) {
    func.getCell(`F${l}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Manhã,Tarde,Noite"'],
      showErrorMessage: true,
      errorTitle: "Preferência inválida",
      error: "Use Manhã, Tarde ou Noite (ou deixe vazio).",
    };
  }

  const aus = pasta.addWorksheet(ABA_AUSENCIAS);
  cabecalho(aus, ["matricula", "inicio", "fim", "motivo", "justificada"], [14, 14, 14, 28, 14]);
  const exemplo = aus.addRow([
    "1001",
    new Date(Date.UTC(2026, 10, 10)),
    new Date(Date.UTC(2026, 10, 14)),
    "Férias",
    "Sim",
  ]);
  exemplo.getCell(2).numFmt = FORMATO_DATA;
  exemplo.getCell(3).numFmt = FORMATO_DATA;
  aus.getColumn(2).numFmt = FORMATO_DATA;
  aus.getColumn(3).numFmt = FORMATO_DATA;
  aus.getCell("A1").note = "Obrigatória. Deve existir na aba Funcionarios.";
  aus.getCell("B1").note = "Obrigatória. Formato dd/mm/aaaa.";
  aus.getCell("C1").note = "Opcional. Vazio = só o dia de início.";
  aus.getCell("E1").note = "Sim (padrão) = justificada/abonada. Não = falta.";
  for (let l = 2; l <= 500; l++) {
    aus.getCell(`E${l}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"Sim,Não"'],
    };
  }

  return new Uint8Array(await pasta.xlsx.writeBuffer());
}
