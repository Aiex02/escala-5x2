import { describe, expect, it } from "vitest";
import {
  analisarPeriodo,
  avisosFuncionamento,
  descreverJornada,
  distanciaPeriodo,
  type DiasSemana,
  ErroMotor,
  etapasEc141,
  formatarHora,
  gerarTurnos,
  indicesDias,
  intervaloPadrao,
  type JanelaDia,
  minutosTrabalhados,
  nomePeriodo,
  periodoDeInicio,
  TODOS_OS_DIAS,
} from "..";
import { h, regras } from "./util";

const todos = (abre: string, fecha: string): JanelaDia[] => [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abreMin: h(abre), fechaMin: h(fecha) }));
const inicios = (t: ReturnType<typeof gerarTurnos>): string[] => t.map((x) => formatarHora(x.horario.inicioMin));

describe("gerarTurnos", () => {
  it("loja de shopping 10–22 com 6h + 15 min: Manhã 10:00–16:15 e Tarde 15:45–22:00", () => {
    const t = gerarTurnos(todos("10:00", "22:00"), 6 * 60, 15);
    expect(t).toHaveLength(2);
    expect([t[0]?.horario.inicioMin, t[0]?.horario.fimMin]).toEqual([h("10:00"), h("16:15")]);
    expect([t[1]?.horario.inicioMin, t[1]?.horario.fimMin]).toEqual([h("15:45"), h("22:00")]);
    expect(t.map((x) => minutosTrabalhados(x.horario))).toEqual([360, 360]);
    expect(t.map((x) => x.nome)).toEqual(["Manhã", "Tarde"]);
    expect(t.every((x) => x.dias === TODOS_OS_DIAS)).toBe(true);
  });

  it("janela longa (09–22) ganha turno intermediário: 09:00, 12:15 e 15:45", () => {
    const t = gerarTurnos(todos("09:00", "22:00"), 6 * 60, 15);
    expect(inicios(t)).toEqual(["09:00", "12:15", "15:45"]);
    expect(t[2]?.horario.fimMin).toBe(h("22:00"));
    expect(t.every((x) => x.horario.fimMin <= h("22:00"))).toBe(true);
  });

  it("domingo com horário menor tem turno próprio", () => {
    const janelas = [...[0, 1, 2, 3, 4, 5].map((dia) => ({ dia, abreMin: h("10:00"), fechaMin: h("22:00") })), { dia: 6, abreMin: h("14:00"), fechaMin: h("20:00") }];
    const t = gerarTurnos(janelas, 6 * 60, 15);
    const domingo = t.filter((x) => indicesDias(x.dias).includes(6));
    expect(domingo).toHaveLength(1);
    // Janela de 6h: turno do abre ao fecha, com o intervalo (5h45 trabalhadas).
    expect([domingo[0]?.horario.inicioMin, domingo[0]?.horario.fimMin]).toEqual([h("14:00"), h("20:00")]);
    expect(minutosTrabalhados(domingo[0]?.horario ?? { inicioMin: 0, fimMin: 1, intervaloMin: 0 })).toBe(345);
    // "Tarde" aparece duas vezes (15:45 e 14:00): ganham o horário no nome.
    const nomes = t.map((x) => x.nome);
    expect(nomes).toContain("Tarde 14:00");
    expect(nomes).toContain("Tarde 15:45");
  });

  it("mesmo início com fins diferentes tem nomes distintos", () => {
    const janelas = [...[0, 1, 2, 3, 4].map((dia) => ({ dia, abreMin: h("10:00"), fechaMin: h("22:00") })), { dia: 5, abreMin: h("10:00"), fechaMin: h("16:00") }];
    const t = gerarTurnos(janelas, 6 * 60, 15);
    const nomes = t.map((x) => x.nome);
    expect(new Set(nomes).size).toBe(t.length);
    expect(nomes).toContain("Manhã 10:00–16:15");
    expect(nomes).toContain("Manhã 10:00–16:00");
  });

  it("junta janelas iguais de dias diferentes num turno só", () => {
    const t = gerarTurnos([...[0, 1, 2].map((dia) => ({ dia, abreMin: h("08:00"), fechaMin: h("17:00") })), { dia: 4, abreMin: h("08:00"), fechaMin: h("17:00") }], 8 * 60, 60);
    expect(t).toHaveLength(1);
    const dias: DiasSemana = t[0]?.dias ?? 0;
    expect(indicesDias(dias)).toEqual([0, 1, 2, 4]);
  });

  it("24 horas viram 3 turnos de 8h + 1h; abre e fecha às 06:00", () => {
    const t = gerarTurnos(todos("06:00", "06:00"), 8 * 60, 60);
    expect(inicios(t)).toEqual(["06:00", "13:30", "21:00"]);
    expect(t[2]?.horario.fimMin).toBe(h("06:00"));
    const seis = gerarTurnos(todos("06:00", "06:00"), 360, 15);
    expect(seis).toHaveLength(4);
    expect(seis[0]?.horario.inicioMin).toBe(h("06:00"));
    expect(seis[3]?.horario.fimMin).toBe(h("06:00"));
  });

  it("valida a entrada com ErroMotor", () => {
    expect(() => gerarTurnos([], 360, 15)).toThrow(ErroMotor);
    expect(() => gerarTurnos(todos("10:00", "22:00"), 30, 15)).toThrow(ErroMotor);
    expect(() => gerarTurnos(todos("10:00", "22:00"), 13 * 60, 15)).toThrow(ErroMotor);
    expect(() => gerarTurnos(todos("10:00", "22:00"), 360, 121)).toThrow(ErroMotor);
    expect(() => gerarTurnos([{ dia: 7, abreMin: 0, fechaMin: 600 }], 360, 15)).toThrow(ErroMotor);
  });

  it("janela mais curta que a jornada gera turno curto", () => {
    const t = gerarTurnos([{ dia: 0, abreMin: h("08:00"), fechaMin: h("14:00") }], 8 * 60, 60);
    expect(t).toHaveLength(1);
    expect(minutosTrabalhados(t[0]?.horario ?? { inicioMin: 0, fimMin: 1, intervaloMin: 0 })).toBe(5 * 60);
  });
});

describe("períodos e intervalos", () => {
  it("período pela hora de início", () => {
    expect(periodoDeInicio(h("11:59"))).toBe("manha");
    expect(periodoDeInicio(h("12:00"))).toBe("tarde");
    expect(periodoDeInicio(h("18:00"))).toBe("noite");
    expect(periodoDeInicio(h("01:00"))).toBe("noite");
    expect(periodoDeInicio(h("05:00"))).toBe("manha");
    expect(nomePeriodo("manha")).toBe("Manhã");
    expect(analisarPeriodo("Manhã")).toBe("manha");
    expect(analisarPeriodo(" TARDE ")).toBe("tarde");
    expect(analisarPeriodo("n")).toBe("noite");
    expect(analisarPeriodo("madrugada")).toBeNull();
    expect(distanciaPeriodo("manha", "noite")).toBe(2);
    expect(distanciaPeriodo("tarde", "manha")).toBe(1);
  });

  it("intervalo padrão da CLT", () => {
    expect(intervaloPadrao(4 * 60)).toBe(0);
    expect(intervaloPadrao(6 * 60)).toBe(15);
    expect(intervaloPadrao(8 * 60)).toBe(60);
    expect(descreverJornada(6 * 60, 15)).toBe("6h com 15 min de intervalo");
    expect(descreverJornada(4 * 60, 0)).toBe("4h");
  });
});

describe("avisosFuncionamento", () => {
  const base = {
    regras: regras({ cargaSemanalMaxMin: 44 * 60, domingosSeguidosMax: 2 }),
    regime: etapasEc141(),
    janelas: todos("10:00", "22:00"),
    jornadaMin: 6 * 60,
    intervaloMin: 15,
  };

  it("um modelo conforme não gera avisos", () => {
    expect(avisosFuncionamento(base)).toEqual([]);
  });

  it("avisa o que foge da lei ou da CLT", () => {
    const campos = avisosFuncionamento({
      ...base,
      regras: regras({ cargaSemanalMaxMin: 48 * 60, jornadaDiariaMaxMin: 10 * 60, descansoEntreJornadasMin: 10 * 60, maxDiasConsecutivos: 7, folgasSemanaisMin: 0, domingosSeguidosMax: 0 }),
      regime: [],
    }).map((a) => a.campo);
    for (const c of ["regime", "carga", "jornadaMax", "folgas", "descanso", "diasSeguidos", "domingos"]) expect(campos).toContain(c);
  });

  it("avisa quando o limite final corta dias da jornada e quando há turno curto", () => {
    const avisos = avisosFuncionamento({
      ...base,
      janelas: [...[0, 1, 2, 3, 4, 5].map((dia) => ({ dia, abreMin: h("08:00"), fechaMin: h("17:00") })), { dia: 6, abreMin: h("08:00"), fechaMin: h("14:00") }],
      jornadaMin: 8 * 60,
      intervaloMin: 60,
    });
    expect(avisos.some((a) => a.campo === "turnos" && a.texto.includes("menos horas que a jornada"))).toBe(true);
    const corta = avisosFuncionamento({ ...base, jornadaMin: 9 * 60, intervaloMin: 60 });
    expect(corta.some((a) => a.campo === "jornada")).toBe(true);
  });

  it("avisa intervalo fora da CLT", () => {
    expect(avisosFuncionamento({ ...base, jornadaMin: 8 * 60, intervaloMin: 30 }).some((a) => a.campo === "intervalo")).toBe(true);
    expect(avisosFuncionamento({ ...base, jornadaMin: 5 * 60, intervaloMin: 0 }).some((a) => a.campo === "intervalo")).toBe(true);
  });
});
