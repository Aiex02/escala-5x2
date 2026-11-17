import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { gerarModeloPlanilha, lerPlanilhaFuncionarios } from "@/excel";

async function paraBytes(pasta: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array(await pasta.xlsx.writeBuffer());
}

type Cel = string | number | Date | null;

function modelo(funcionarios: Cel[][], ausencias?: Cel[][], cabecalho?: string[]): Promise<Uint8Array> {
  const pasta = new ExcelJS.Workbook();
  const f = pasta.addWorksheet("Funcionarios");
  f.addRow(cabecalho ?? ["matricula", "nome", "cargo", "secao", "ctps", "preferencia", "carga_semanal"]);
  funcionarios.forEach((l) => f.addRow(l));
  if (ausencias) {
    const a = pasta.addWorksheet("Ausencias");
    a.addRow(["matricula", "inicio", "fim", "motivo", "justificada"]);
    ausencias.forEach((l) => a.addRow(l));
  }
  return paraBytes(pasta);
}

describe("planilha modelo", () => {
  it("lê 15 pessoas e ausências válidas", async () => {
    const cargos = ["Atendente", "Barista", "Cozinheiro"];
    const pessoas = Array.from({ length: 15 }, (_, i): Cel[] => [
      `M${100 + i}`,
      `Pessoa Fictícia ${i + 1}`,
      cargos[i % 3] ?? null,
      "Loja",
      String(900000 + i),
      ["Manhã", "TARDE", "noite", ""][i % 4] ?? "",
      i % 2 === 0 ? 36 : "37,5",
    ]);
    const r = await lerPlanilhaFuncionarios(
      await modelo(
        pessoas,
        [
          ["M100", "10/11/2026", "14/11/2026", "Férias", ""],
          ["M101", new Date(Date.UTC(2026, 10, 3)), null, "Atestado", "não"],
          ["M102", "2026-11-20", "2026-11-21", null, "Sim"],
        ],
      ),
    );
    expect(r.formato).toBe("modelo");
    expect(r.funcionarios).toHaveLength(15);
    expect(r.rejeitadas).toEqual([]);
    expect(r.funcionarios[0]).toMatchObject({ matricula: "M100", preferencia: "MANHA", cargaSemanalMin: 2160, cargo: "Atendente" });
    expect(r.funcionarios[1]).toMatchObject({ preferencia: "TARDE", cargaSemanalMin: 2250 });
    expect(r.funcionarios[3]?.preferencia).toBeUndefined();
    expect(r.ausencias).toHaveLength(3);
    expect(r.ausencias[0]).toMatchObject({ inicio: "2026-11-10", fim: "2026-11-14", justificada: true });
    expect(r.ausencias[1]).toMatchObject({ inicio: "2026-11-03", fim: "2026-11-03", justificada: false });
    expect(r.ausencias[2]).toMatchObject({ inicio: "2026-11-20", fim: "2026-11-21" });
  });

  it("reúne todos os erros da linha e segue com as válidas", async () => {
    const r = await lerPlanilhaFuncionarios(
      await modelo([
        ["1", "Ok Fictício", null, null, null, null, null],
        [null, null, null, null, null, "madrugada", "abc"],
        ["3", "Outro", null, null, null, null, "36h"],
      ]),
    );
    expect(r.funcionarios.map((f) => f.matricula)).toEqual(["1", "3"]);
    expect(r.funcionarios[1]?.cargaSemanalMin).toBe(2160);
    expect(r.rejeitadas).toHaveLength(1);
    const rej = r.rejeitadas[0];
    expect(rej?.linha).toBe(3);
    expect(rej?.erros).toHaveLength(4);
    expect(rej?.erros.join("|")).toMatch(/matricula não informado/);
    expect(rej?.erros.join("|")).toMatch(/nome não informado/);
    expect(rej?.erros.join("|")).toMatch(/preferencia/);
    expect(rej?.erros.join("|")).toMatch(/carga_semanal/);
  });

  it("rejeita matrícula repetida", async () => {
    const r = await lerPlanilhaFuncionarios(
      await modelo([
        ["7", "Primeiro", null, null, null, null, null],
        ["7", "Segundo", null, null, null, null, null],
      ]),
    );
    expect(r.funcionarios).toHaveLength(1);
    expect(r.rejeitadas[0]?.erros[0]).toMatch(/repetida.*linha 2/);
  });

  it("valida ausências: matrícula inexistente, datas inválidas e fim antes do início", async () => {
    const r = await lerPlanilhaFuncionarios(
      await modelo(
        [["1", "Fulano Fictício", null, null, null, null, null]],
        [
          ["999", "10/11/2026", null, null, null],
          ["1", "31/02/2026", null, null, null],
          ["1", "15/11/2026", "10/11/2026", null, null],
          ["1", null, null, null, "talvez"],
          ["1", "01/12/2026", null, "ok", null],
        ],
      ),
    );
    expect(r.ausencias).toHaveLength(1);
    expect(r.rejeitadas).toHaveLength(4);
    expect(r.rejeitadas[0]?.erros.join()).toMatch(/não existe na aba Funcionarios/);
    expect(r.rejeitadas[1]?.erros.join()).toMatch(/data "31\/02\/2026" inválida/);
    expect(r.rejeitadas[2]?.erros.join()).toMatch(/anterior ao início/);
    expect(r.rejeitadas[3]?.erros.length).toBeGreaterThanOrEqual(2);
    expect(r.rejeitadas[0]?.aba).toBe("Ausencias");
  });

  it("ignora colunas de horário e avisa; avisa de colunas desconhecidas", async () => {
    const r = await lerPlanilhaFuncionarios(
      await modelo(
        [["1", "Fulana Fictícia", "Caixa", "07:00", "15:00", "seg-sex", "xyz"]],
        undefined,
        ["Matrícula", "Nome", "Cargo", "Entrada", "Saída", "Dias disponíveis", "Hobby"],
      ),
    );
    expect(r.funcionarios).toHaveLength(1);
    expect(r.avisos.some((a) => a.includes("colunas de horário ignoradas"))).toBe(true);
    expect(r.avisos.some((a) => a.includes('"Hobby" não reconhecida'))).toBe(true);
  });

  it("aceita cabeçalhos com acento, caixa e underscore", async () => {
    const r = await lerPlanilhaFuncionarios(
      await modelo([["1", "Fulano", "Padeiro", null, null, null, null]], undefined, [
        " MATRÍCULA ", "Nome_Completo", "Função", "", "", "Preferência", "Carga Semanal",
      ]),
    );
    expect(r.funcionarios[0]).toMatchObject({ matricula: "1", cargo: "Padeiro" });
  });

  describe("coluna horas_nao_trabalhadas", () => {
    const CAB = ["matricula", "nome", "horas_nao_trabalhadas"];

    it("aceita 4, 4,5, 4h e decimal numérico, convertendo para minutos", async () => {
      const r = await lerPlanilhaFuncionarios(
        await modelo(
          [
            ["1", "A", 1],
            ["2", "B", "1,5"],
            ["3", "C", "1h"],
            ["4", "D", 1.5],
            ["5", "E", "1 h"],
            ["6", "F", 0],
            ["7", "G", 12],
          ],
          undefined,
          CAB,
        ),
      );
      expect(r.rejeitadas).toEqual([]);
      expect(r.funcionarios.map((f) => f.horasNaoTrabalhadasMin)).toEqual([60, 90, 60, 90, 60, 0, 12 * 60]);
    });

    it("célula vazia não define o campo (a importação mantém o valor cadastrado)", async () => {
      const r = await lerPlanilhaFuncionarios(await modelo([["1", "A", null], ["2", "B", "  "]], undefined, CAB));
      expect(r.rejeitadas).toEqual([]);
      expect(r.funcionarios).toHaveLength(2);
      for (const f of r.funcionarios) expect(f).not.toHaveProperty("horasNaoTrabalhadasMin");
    });

    it("sem a coluna, nenhum funcionário recebe o campo", async () => {
      const r = await lerPlanilhaFuncionarios(await modelo([["1", "A", null, null, null, null, 36]]));
      expect(r.funcionarios[0]).not.toHaveProperty("horasNaoTrabalhadasMin");
    });

    it("rejeita valores negativos, acima de 12 e texto inválido", async () => {
      const r = await lerPlanilhaFuncionarios(
        await modelo([["1", "A", -1], ["2", "B", 12.5], ["3", "C", "quatro"], ["4", "D", "1,5h"]], undefined, CAB),
      );
      expect(r.funcionarios.map((f) => f.matricula)).toEqual(["4"]);
      expect(r.funcionarios[0]?.horasNaoTrabalhadasMin).toBe(90);
      expect(r.rejeitadas.map((x) => x.matricula)).toEqual(["1", "2", "3"]);
      expect(r.rejeitadas[0]?.erros.join()).toMatch(/horas_nao_trabalhadas -1 fora do intervalo \(0 a 12 horas\)/);
      expect(r.rejeitadas[1]?.erros.join()).toMatch(/horas_nao_trabalhadas 12\.5 fora do intervalo/);
      expect(r.rejeitadas[2]?.erros.join()).toMatch(/horas_nao_trabalhadas: "quatro" não é um número/);
    });

    it("reconhece o cabeçalho com acento, espaços e caixa", async () => {
      const r = await lerPlanilhaFuncionarios(
        await modelo([["1", "A", "2,25"]], undefined, ["Matrícula", "Nome", " Horas Não Trabalhadas "]),
      );
      expect(r.avisos.join()).not.toMatch(/não reconhecida/);
      expect(r.funcionarios[0]?.horasNaoTrabalhadasMin).toBe(135);
    });
  });

  it("lança ErroPlanilha sem colunas obrigatórias ou com arquivo inválido", async () => {
    const pasta = new ExcelJS.Workbook();
    pasta.addWorksheet("Funcionarios").addRow(["foo", "bar"]);
    await expect(lerPlanilhaFuncionarios(await paraBytes(pasta))).rejects.toThrow(/obrigatórias ausentes/);
    await expect(lerPlanilhaFuncionarios(new Uint8Array([1, 2, 3]))).rejects.toThrow(/xlsx/);
  });

  it("relê com sucesso o modelo gerado", async () => {
    const r = await lerPlanilhaFuncionarios(await gerarModeloPlanilha());
    expect(r.formato).toBe("modelo");
    expect(r.funcionarios).toHaveLength(3);
    expect(r.rejeitadas).toEqual([]);
    expect(r.ausencias).toHaveLength(1);
    expect(r.funcionarios[1]?.cargaSemanalMin).toBe(2250);
    expect(r.funcionarios.map((f) => f.horasNaoTrabalhadasMin)).toEqual([60, 90, undefined]);
    const pasta = new ExcelJS.Workbook();
    await pasta.xlsx.load(Buffer.from(await gerarModeloPlanilha()) as never);
    expect(pasta.worksheets.map((a) => a.name)).toEqual(["Funcionarios", "Ausencias"]);
    expect(pasta.getWorksheet("Funcionarios")?.getRow(1).font?.bold).toBe(true);
  });
});

function quadro(): Promise<Uint8Array> {
  const pasta = new ExcelJS.Workbook();
  const a = pasta.addWorksheet("Table 1");
  const cab = "Cód Nome do Funcionário Função Seção Número CTPS Série Ent. Intervalo Saída Des Visto";
  a.addRow(["QUADRO DE HORÁRIO DE TRABALHO (Art. 74 da CLT)"]);
  a.mergeCells("A1:K1");
  a.addRow(["Empregador: EMPRESA FICTÍCIA LTDA Rua Inventada, 1"]);
  a.mergeCells("A2:K2");
  a.addRow([cab]);
  a.mergeCells("A3:K3");
  a.addRow(["1", "Ana   Fictícia", "Atendente", "Loja", 12345, "0001", "07:00", ": A :", "15:20", "Dom", ""]);
  a.addRow([null, null, null, null, null, null, "07:00", ": A :", "13:00", null, null]);
  a.addRow(["2", "Bruno Fictício", "Barista", "Loja", "0099887", "0002", "13:00", "17:00 : A : 18:00", "21:20", "Dom", ""]);
  a.addRow([null, null, null, null, null, null, "08:00", null, "14:00", null, null]);
  // cabeçalho de página repetido
  a.addRow(["QUADRO DE HORÁRIO DE TRABALHO (Art. 74 da CLT)"]);
  a.addRow(["Empregador: EMPRESA FICTÍCIA LTDA"]);
  a.addRow([cab]);
  a.addRow(["3", "Carla Fictícia", "Atendente", "Loja", null, null, "07:00", null, "15:20", "Dom", ""]);
  a.addRow(["Observação: horários sujeitos a alteração."]);
  return paraBytes(pasta);
}

describe("quadro de horário", () => {
  it("detecta o formato, ignora sábado, cabeçalho repetido e rodapé", async () => {
    const r = await lerPlanilhaFuncionarios(await quadro());
    expect(r.formato).toBe("quadro");
    expect(r.rejeitadas).toEqual([]);
    expect(r.funcionarios.map((f) => f.nome)).toEqual(["Ana Fictícia", "Bruno Fictício", "Carla Fictícia"]);
    expect(r.funcionarios[0]).toMatchObject({ matricula: "12345", cargo: "Atendente", secao: "Loja", ctpsSerie: "0001" });
    expect(r.funcionarios[1]?.matricula).toBe("0099887");
    expect(r.funcionarios[2]?.matricula).toBe("3");
    expect(r.avisos.some((a) => a.includes("sem número de CTPS"))).toBe(true);
  });

  it("rejeita matrícula repetida no quadro e linha sem nome", async () => {
    const pasta = new ExcelJS.Workbook();
    const a = pasta.addWorksheet("Table 1");
    a.addRow(["Cód", "Nome do Funcionário", "Função", "Seção", "Número", "Série", "Ent.", "Intervalo", "Saída", "Des", "Visto"]);
    a.addRow(["1", "Dup Um", "X", "Y", 555, "1", "07:00", null, "15:00"]);
    a.addRow(["2", "Dup Dois", "X", "Y", 555, "1", "07:00", null, "15:00"]);
    a.addRow(["3", null, "X", "Y", 777, "1", "07:00", null, "15:00"]);
    const r = await lerPlanilhaFuncionarios(await paraBytes(pasta));
    expect(r.formato).toBe("quadro");
    expect(r.funcionarios).toHaveLength(1);
    expect(r.rejeitadas.map((x) => x.linha)).toEqual([3, 4]);
  });
});
