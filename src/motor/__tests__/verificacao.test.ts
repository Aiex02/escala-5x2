import { describe, expect, it } from "vitest";
import { type Alocacao, encontrarViolacoes, etapasEc141, verificarEscala } from "..";
import { entrada, equipe, horario, mes, regras, tresTurnos, umTurno } from "./util";

const manha = horario("06:00", "14:00");
const noite = horario("22:00", "06:00");
const aloc = (funcionarioId: string, data: string, turnoId = "manha", h = manha): Alocacao => ({ funcionarioId, turnoId, data, horario: h });
const tipos = (v: ReturnType<typeof encontrarViolacoes>): string[] => v.map((x) => x.tipo);

describe("verificador independente", () => {
  const [ini, fim] = mes(2027, 3);
  const base = () => entrada(ini, fim, regras(), tresTurnos(0), equipe(2));

  it("não acusa nada numa escala válida", () => {
    const e = base();
    const dias = ["2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05"];
    expect(encontrarViolacoes(e, dias.map((d) => aloc("f01", d)))).toEqual([]);
  });

  it("acusa hora extra, dias seguidos e falta de folga", () => {
    const e = base();
    // 7 dias seguidos de 8h (56h): carga semanal, folgas e dias consecutivos.
    const dias = ["2027-03-01", "2027-03-02", "2027-03-03", "2027-03-04", "2027-03-05", "2027-03-06", "2027-03-07"];
    const v = encontrarViolacoes(e, dias.map((d) => aloc("f01", d)));
    expect(tipos(v)).toEqual(expect.arrayContaining(["cargaSemanal", "folgasSemanais", "diasConsecutivos"]));
    expect(v.find((x) => x.tipo === "cargaSemanal")).toMatchObject({ minutos: 56 * 60, limite: 40 * 60 });
    expect(verificarEscala(e, dias.map((d) => aloc("f01", d))).every((a) => a.tipo === "violacaoRegra" && a.funcionarioId === "f01")).toBe(true);
  });

  it("acusa descanso insuficiente entre jornadas", () => {
    const v = encontrarViolacoes(base(), [aloc("f01", "2027-03-02", "noite", noite), aloc("f01", "2027-03-03", "manha", manha)]);
    expect(tipos(v)).toEqual(["descanso"]);
    expect(v[0]).toMatchObject({ minutos: 0, minimo: 11 * 60 });
  });

  it("acusa jornada diária acima do máximo e mais de uma jornada no dia", () => {
    const longa = horario("06:00", "16:00");
    const v = encontrarViolacoes(base(), [aloc("f01", "2027-03-02", "manha", longa), aloc("f01", "2027-03-02", "tarde", horario("20:00", "22:00"))]);
    expect(tipos(v)).toEqual(expect.arrayContaining(["jornadaDiaria", "maisDeUmaJornadaNoDia"]));
  });

  it("acusa dia indisponível (ausência ou falta), turno inativo, fora do período e desconhecido", () => {
    const funcs = equipe(1).map((f) => ({ ...f, indisponivel: new Set(["2027-03-02"]), faltas: new Set(["2027-03-03"]) }));
    const e = entrada(ini, fim, regras(), [umTurno("util", "08:00", "16:00", 0, 0, 0b0011111)], funcs);
    const v = encontrarViolacoes(e, [
      aloc("f01", "2027-03-02", "util"),
      aloc("f01", "2027-03-03", "util"),
      aloc("f01", "2027-03-06", "util"), // sábado
      aloc("f01", "2027-04-02", "util"),
      aloc("zzz", "2027-03-04", "util"),
    ]);
    const t = tipos(v);
    expect(t.filter((x) => x === "diaIndisponivel")).toHaveLength(2);
    expect(t).toEqual(expect.arrayContaining(["turnoInativoNoDia", "foraDoPeriodo", "funcionarioDesconhecido"]));
  });

  it("acusa domingos seguidos acima do máximo", () => {
    const e = entrada(ini, fim, regras({ folgasSemanaisMin: 2, domingosSeguidosMax: 2 }), tresTurnos(0), equipe(1));
    const v = encontrarViolacoes(e, ["2027-03-07", "2027-03-14", "2027-03-21"].map((d) => aloc("f01", d)));
    expect(tipos(v)).toEqual(["domingosSeguidos"]);
    expect(v[0]).toMatchObject({ domingos: 3, maximo: 2 });
    // Dois domingos seguidos, um de intervalo, mais um: sem violação.
    expect(encontrarViolacoes(e, ["2027-03-07", "2027-03-14", "2027-03-28"].map((d) => aloc("f01", d)))).toEqual([]);
  });

  it("com o regime da EC 141, 6 dias na semana viola as 2 folgas; o isento pode", () => {
    const e = entrada("2027-01-04", "2027-01-10", regras({ cargaSemanalMaxMin: 44 * 60 }), [umTurno("c", "08:00", "15:20")], equipe(2).map((f, i) => ({ ...f, isentoRegime: i === 1 })));
    e.regime = etapasEc141("2026-10-16");
    const h = horario("08:00", "15:20");
    const seisDias = (id: string) => ["2027-01-04", "2027-01-05", "2027-01-06", "2027-01-07", "2027-01-08", "2027-01-09"].map((d) => aloc(id, d, "c", h));
    const v = encontrarViolacoes(e, [...seisDias("f01"), ...seisDias("f02")]);
    expect(v.filter((x) => x.funcionarioId === "f01").map((x) => x.tipo).sort()).toEqual(["cargaSemanal", "folgasSemanais"]);
    expect(v.filter((x) => x.funcionarioId === "f02")).toEqual([]);
  });

  it("soma a semana que atravessa o mês (alocações fixas)", () => {
    const e = entrada("2027-03-01", "2027-03-31", regras(), tresTurnos(0), equipe(1));
    // A semana 22–28/02 (5 × 8h = 40h fixas) não toca o período: uma jornada em 01/03 não gera violação.
    e.alocacoesFixas = ["2027-02-22", "2027-02-23", "2027-02-24", "2027-02-25", "2027-02-26"].map((d) => aloc("f01", d));
    expect(encontrarViolacoes(e, [aloc("f01", "2027-03-01")])).toEqual([]);
    // Já a semana 29/03–04/04, que cruza a virada: 3 dias fixos em abril e 3 no período somam 48h.
    const e2 = entrada("2027-03-01", "2027-03-31", regras(), tresTurnos(0), equipe(1));
    e2.alocacoesFixas = ["2027-04-01", "2027-04-02", "2027-04-03"].map((d) => aloc("f01", d));
    const v = encontrarViolacoes(e2, ["2027-03-29", "2027-03-30", "2027-03-31"].map((d) => aloc("f01", d)));
    expect(tipos(v)).toEqual(["cargaSemanal"]);
    expect(v[0]).toMatchObject({ minutos: 48 * 60 });
  });

  it("ordena as violações por data", () => {
    const v = encontrarViolacoes(base(), [aloc("f01", "2027-03-20", "manha", horario("06:00", "16:00")), aloc("f01", "2027-03-05", "manha", horario("06:00", "16:00"))]);
    expect(v.map((x) => x.data)).toEqual(["2027-03-05", "2027-03-20"]);
  });
});
