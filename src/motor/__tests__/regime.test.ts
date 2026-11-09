import { describe, expect, it } from "vitest";
import {
  descreverRegraDasSemanas,
  diasTrabalhoMax,
  etapaEm,
  etapasEc141,
  faseVigenteEm,
  fasesParaExibicao,
  limitesDaSemana,
  limitesDoFuncionarioNaSemana,
  PUBLICACAO_EC141_PADRAO,
  semanaContendo,
  semanasCobrindo,
} from "..";
import { funcionario, regras } from "./util";

describe("etapas da EC 141", () => {
  it("têm 3 etapas contadas da publicação", () => {
    expect(PUBLICACAO_EC141_PADRAO).toBe("2026-10-16");
    const etapas = etapasEc141("2026-10-16");
    expect(etapas).toHaveLength(3);
    expect(etapas[1]?.vigencia).toBe("2026-12-16");
    expect(etapas[2]?.vigencia).toBe("2027-12-16");
    expect(etapaEm(etapas, "2026-11-01")).toMatchObject({ cargaSemanalMaxMin: 44 * 60, folgasSemanaisMin: 1 });
    expect(etapaEm(etapas, "2026-12-15")).toMatchObject({ cargaSemanalMaxMin: 44 * 60 });
    expect(etapaEm(etapas, "2026-12-16")).toMatchObject({ cargaSemanalMaxMin: 42 * 60, folgasSemanaisMin: 2 });
    expect(etapaEm(etapas, "2027-12-15")).toMatchObject({ cargaSemanalMaxMin: 42 * 60 });
    expect(etapaEm(etapas, "2027-12-16")).toMatchObject({ cargaSemanalMaxMin: 40 * 60, folgasSemanaisMin: 2 });
    expect(etapaEm(etapas, "2028-01-01")).toMatchObject({ cargaSemanalMaxMin: 40 * 60 });
  });

  it("acompanham uma publicação diferente (com fim de mês)", () => {
    const etapas = etapasEc141("2026-12-31");
    expect(etapas[1]?.vigencia).toBe("2027-02-28");
    expect(etapas[2]?.vigencia).toBe("2028-02-29");
  });
});

describe("limites da semana", () => {
  const etapas = etapasEc141("2026-10-16");

  it("a semana da virada (14–20/12/2026) usa a regra nova inteira", () => {
    const r = regras({ cargaSemanalMaxMin: 44 * 60 });
    const semana = semanaContendo("2026-12-16", "segunda");
    expect(limitesDaSemana(r, etapas, semana)).toEqual({ cargaMaxMin: 42 * 60, folgasMin: 2 });
    const anterior = semanaContendo("2026-12-10", "segunda");
    expect(limitesDaSemana(r, etapas, anterior)).toEqual({ cargaMaxMin: 44 * 60, folgasMin: 1 });
  });

  it("a semana da virada de 16/12/2027 passa a 40h", () => {
    const r = regras({ cargaSemanalMaxMin: 44 * 60 });
    expect(limitesDaSemana(r, etapas, semanaContendo("2027-12-16", "segunda"))).toEqual({ cargaMaxMin: 40 * 60, folgasMin: 2 });
    expect(limitesDaSemana(r, etapas, semanaContendo("2027-12-10", "segunda"))).toEqual({ cargaMaxMin: 42 * 60, folgasMin: 2 });
  });

  it("antes da transição vale a CLT anterior, limitada pela empresa", () => {
    const empresa40 = regras({ cargaSemanalMaxMin: 40 * 60 });
    expect(limitesDaSemana(empresa40, etapas, semanaContendo("2026-11-04", "segunda"))).toEqual({ cargaMaxMin: 40 * 60, folgasMin: 1 });
  });

  it("sem regime legal vale só a empresa", () => {
    const r = regras({ cargaSemanalMaxMin: 44 * 60 });
    expect(limitesDaSemana(r, [], semanaContendo("2026-12-16", "segunda"))).toEqual({ cargaMaxMin: 44 * 60, folgasMin: 1 });
  });

  it("quem é isento do regime segue só a empresa", () => {
    const r = regras({ cargaSemanalMaxMin: 44 * 60 });
    const semana = semanaContendo("2027-01-05", "segunda");
    expect(limitesDoFuncionarioNaSemana(funcionario("a"), r, etapas, semana)).toEqual({ cargaMaxMin: 42 * 60, folgasMin: 2 });
    expect(limitesDoFuncionarioNaSemana(funcionario("b", { isentoRegime: true }), r, etapas, semana)).toEqual({ cargaMaxMin: 44 * 60, folgasMin: 1 });
  });

  it("dias de trabalho = 7 menos as folgas", () => {
    expect(diasTrabalhoMax({ cargaMaxMin: 0, folgasMin: 2 })).toBe(5);
    expect(diasTrabalhoMax({ cargaMaxMin: 0, folgasMin: 1 })).toBe(6);
  });

  it("descreve a regra das semanas de um mês", () => {
    const r = regras({ cargaSemanalMaxMin: 44 * 60 });
    const semanas = semanasCobrindo("2026-12-01", "2026-12-31", "segunda");
    expect(descreverRegraDasSemanas(r, etapas, semanas)).toBe("Até 44h e 1 folga por semana; a partir da semana de 14/12, até 42h e 2 folgas por semana");
  });
});

describe("fases para exibição", () => {
  it("lista as 3 fases com período e descrição legíveis", () => {
    const fases = fasesParaExibicao("2026-10-16");
    expect(fases.map((f) => f.periodo)).toEqual(["Até 15/12/2026", "De 16/12/2026 a 15/12/2027", "A partir de 16/12/2027"]);
    expect(fases.map((f) => f.descricao)).toEqual(["Até 44h e 1 folga por semana", "Até 42h e 2 folgas por semana", "Até 40h e 2 folgas por semana"]);
    expect(fases.map((f) => [f.inicio, f.fim])).toEqual([
      [null, "2026-12-15"],
      ["2026-12-16", "2027-12-15"],
      ["2027-12-16", null],
    ]);
  });

  it("combina com as regras da empresa quando informadas", () => {
    const fases = fasesParaExibicao("2026-10-16", regras({ cargaSemanalMaxMin: 40 * 60 }));
    expect(fases.map((f) => f.descricao)).toEqual(["Até 40h e 1 folga por semana", "Até 40h e 2 folgas por semana", "Até 40h e 2 folgas por semana"]);
  });

  it("indica a fase em vigor numa data", () => {
    expect(faseVigenteEm("2026-10-16", "2026-10-28").numero).toBe(1);
    expect(faseVigenteEm("2026-10-16", "2026-12-16").numero).toBe(2);
    expect(faseVigenteEm("2026-10-16", "2027-12-15").numero).toBe(2);
    expect(faseVigenteEm("2026-10-16", "2027-12-16").numero).toBe(3);
    expect(faseVigenteEm("2026-10-16", "2000-01-01").numero).toBe(1);
  });
});
