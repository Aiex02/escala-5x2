import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { exportarEscala, type EscalaExportavel } from "@/excel";

function escala(): EscalaExportavel {
  const dias = Array.from({ length: 30 }, (_, i) => ({
    data: `2026-11-${String(i + 1).padStart(2, "0")}`,
    // 2026-11-01 é domingo
    diaSemana: (6 + i) % 7,
  }));
  const manha = { tipo: "turno", turnoId: "m", inicioMin: 420, fimMin: 920, intervaloMin: 60 } as const;
  const tarde = { tipo: "turno", turnoId: "t", inicioMin: 780, fimMin: 1280, intervaloMin: 60, compensada: true } as const;
  const linha = (nome: string, cargo: string | undefined, base: number) => ({
    funcionario: nome,
    cargo,
    dias: dias.map((_, i) => {
      if (i % 7 === 6) return { tipo: "folga" } as const;
      if (i === 3) return { tipo: "falta" } as const;
      if (i === 4) return { tipo: "justificada", motivo: "Atestado" } as const;
      return base === 0 ? manha : tarde;
    }),
    horasMesMin: 9600,
    saldoMin: base === 0 ? 90 : -30,
    acumuladoMin: 120,
  });
  return {
    cliente: "Cliente Fictício",
    ano: 2026,
    mes: 11,
    dias,
    turnos: [
      { id: "m", nome: "Manhã", sigla: "M", cor: "#F2D27A", inicioMin: 420, fimMin: 920, intervaloMin: 60 },
      { id: "t", nome: "Tarde", sigla: "T", cor: "#E8896B", inicioMin: 780, fimMin: 1280, intervaloMin: 60 },
    ],
    linhas: [linha("Ana Fictícia", "Atendente", 0), linha("Bruno Fictício", "Atendente", 1), linha("Carla Fictícia", undefined, 0)],
    semanas: [
      { inicio: "2026-11-01", fim: "2026-11-07" },
      { inicio: "2026-11-08", fim: "2026-11-14" },
    ],
    horasSemana: [
      { funcionario: "Ana Fictícia", semanas: [{ feitoMin: 2400, previstoMin: 2400 }, { feitoMin: 2300, previstoMin: 2400 }] },
      { funcionario: "Bruno Fictício", semanas: [{ feitoMin: 2400, previstoMin: 2400 }, { feitoMin: 2400, previstoMin: 2400 }] },
    ],
  };
}

async function reler(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const p = new ExcelJS.Workbook();
  await p.xlsx.load(Buffer.from(bytes) as never);
  return p;
}

describe("exportarEscala", () => {
  it("gera abas, título, colunas e células esperadas", async () => {
    const p = await reler(await exportarEscala(escala()));
    expect(p.worksheets.map((a) => a.name)).toEqual(["Escala", "Horas por semana"]);
    const aba = p.getWorksheet("Escala");
    if (!aba) throw new Error("aba Escala ausente");
    expect(String(aba.getCell("A1").value)).toBe("Escala de trabalho — Cliente Fictício — Novembro/2026");
    // 1 nome + 30 dias + 3 estatísticas
    expect(aba.columnCount).toBe(34);
    expect(aba.getCell(3, 2).value).toBe("dom");
    expect(aba.getCell(4, 2).value).toBe(1);
    expect(aba.getCell(3, 32).value).toBe("Horas no mês");
    expect(aba.pageSetup.orientation).toBe("landscape");
    expect(aba.pageSetup.fitToWidth).toBe(1);
    expect(aba.views[0]).toMatchObject({ state: "frozen", xSplit: 1, ySplit: 4 });
    // grupo "Atendente", depois Ana
    expect(aba.getCell("A5").value).toBe("Atendente");
    expect(aba.getCell("A6").value).toBe("Ana Fictícia");
    expect(aba.getCell(6, 3).value).toBe("M");
    expect(aba.getCell(6, 8).value).toBe("F");
    expect(aba.getCell(7, 3).value).toBe("T*");
    expect(aba.getCell(6, 5).value).toBe("A");
    expect(aba.getCell(6, 6).value).toBe("J");
    expect(aba.getCell(6, 32).value).toBe("160h00");
    expect(aba.getCell(6, 33).value).toBe("+1h30");
    const fill = aba.getCell(6, 3).fill;
    expect(fill.type === "pattern" && fill.fgColor?.argb).toBe("FFF2D27A");
    const textos: string[] = [];
    aba.eachRow((l) => l.eachCell((c) => { if (typeof c.value === "string") textos.push(c.value); }));
    expect(textos).toContain("Sem função");
    expect(textos).toContain("Legenda");
    expect(textos.some((t) => t.startsWith("M — Manhã"))).toBe(true);
  });

  it("mantém altura fixa e sem quebra de linha no modo compacto", async () => {
    const p = await reler(await exportarEscala(escala()));
    const aba = p.getWorksheet("Escala");
    if (!aba) throw new Error("aba Escala ausente");
    // Linhas de dados (6, 7 e 9): mesma altura, mesmo com "T*" nas células.
    expect(aba.getRow(6).height).toBe(18);
    expect(aba.getRow(7).height).toBe(18);
    expect(aba.getRow(9).height).toBe(18);
    expect(aba.getCell(7, 3).alignment?.wrapText).toBeFalsy();
    // "Acumulado" precisa caber sem quebrar no meio da palavra.
    expect(aba.getColumn(34).width).toBeGreaterThanOrEqual(13);
  });

  it("escreve o horário na célula quando pedido", async () => {
    const p = await reler(await exportarEscala(escala(), { horarioNaCelula: true }));
    const aba = p.getWorksheet("Escala");
    expect(aba?.getCell(6, 3).value).toBe("M\n07:00\n15:20");
    expect(aba?.getCell(6, 3).alignment?.wrapText).toBe(true);
    expect(aba?.getRow(6).height).toBe(44);
  });

  it("monta a aba de horas por semana", async () => {
    const p = await reler(await exportarEscala(escala()));
    const aba = p.getWorksheet("Horas por semana");
    if (!aba) throw new Error("aba ausente");
    expect(String(aba.getCell("A1").value)).toContain("Horas por semana");
    // 1 + (2 semanas + mês) * 3 colunas
    expect(aba.columnCount).toBe(10);
    expect(aba.getCell(2, 2).value).toBe("01/11 a 07/11");
    expect(aba.getCell(4, 1).value).toBe("Ana Fictícia");
    expect(aba.getCell(4, 7).value).toBe("-1h40");
  });
});
