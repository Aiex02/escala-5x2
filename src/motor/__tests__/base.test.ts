import { describe, expect, it } from "vitest";
import {
  analisarHora,
  atravessaMeiaNoite,
  chaveFuncao,
  compararDatas,
  contemDia,
  criarHorario,
  datasDoIntervalo,
  diaDaSemana,
  diasDeIndices,
  diasEntre,
  disponivelEm,
  duracaoTotal,
  ehValida,
  ErroMotor,
  errosDasRegras,
  formatarHora,
  formatarHorario,
  formatarMinutos,
  indicesDias,
  limiteDoFuncionario,
  MINUTOS_DIA,
  minutosTrabalhados,
  REGRAS_PADRAO,
  semanaContendo,
  semanasCobrindo,
  somarDias,
  somarMeses,
  TODOS_OS_DIAS,
  tentarAnalisarHora,
  ultimoDiaDoMes,
  uniaoDias,
  validarRegras,
} from "..";
import { funcionario, h } from "./util";

describe("data", () => {
  it("dia da semana (0 = segunda ... 6 = domingo)", () => {
    expect(diaDaSemana("2025-10-01")).toBe(2); // quarta
    expect(diaDaSemana("2026-03-02")).toBe(0); // segunda
    expect(diaDaSemana("2027-02-28")).toBe(6); // domingo
    expect(diaDaSemana("1970-01-01")).toBe(3); // quinta
    expect(diaDaSemana("1969-12-31")).toBe(2);
  });

  it("soma dias atravessando meses, anos e anos bissextos", () => {
    expect(somarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(somarDias("2024-02-28", 1)).toBe("2024-02-29");
    expect(somarDias("2025-02-28", 1)).toBe("2025-03-01");
    expect(somarDias("2026-03-01", -1)).toBe("2026-02-28");
    expect(somarDias("2026-03-01", 366)).toBe("2027-03-02");
  });

  it("compara e mede intervalos", () => {
    expect(compararDatas("2026-01-01", "2026-01-02")).toBe(-1);
    expect(compararDatas("2026-01-02", "2026-01-02")).toBe(0);
    expect(compararDatas("2027-01-01", "2026-12-31")).toBe(1);
    expect(diasEntre("2026-01-01", "2026-03-01")).toBe(59);
    expect(diasEntre("2026-03-01", "2026-01-01")).toBe(-59);
  });

  it("soma meses com fim de mês", () => {
    expect(somarMeses("2026-10-16", 2)).toBe("2026-12-16");
    expect(somarMeses("2026-10-16", 14)).toBe("2027-12-16");
    expect(somarMeses("2026-12-31", 2)).toBe("2027-02-28");
    expect(somarMeses("2027-12-31", 2)).toBe("2028-02-29");
    expect(somarMeses("2026-01-31", -2)).toBe("2025-11-30");
  });

  it("último dia do mês e validade", () => {
    expect(ultimoDiaDoMes(2024, 2)).toBe("2024-02-29");
    expect(ultimoDiaDoMes(2025, 2)).toBe("2025-02-28");
    expect(ultimoDiaDoMes(2025, 12)).toBe("2025-12-31");
    expect(ehValida("2027-02-29")).toBe(false);
    expect(ehValida("2028-02-29")).toBe(true);
    expect(ehValida("2026-13-01")).toBe(false);
    expect(ehValida("26-01-01")).toBe(false);
    expect(ehValida("2026-1-1")).toBe(false);
  });

  it("lista as datas de um intervalo", () => {
    expect(datasDoIntervalo("2026-02-27", "2026-03-02")).toEqual(["2026-02-27", "2026-02-28", "2026-03-01", "2026-03-02"]);
    expect(datasDoIntervalo("2026-03-02", "2026-03-02")).toEqual(["2026-03-02"]);
    expect(datasDoIntervalo("2026-03-03", "2026-03-02")).toEqual([]);
  });
});

describe("hora", () => {
  it("interpreta os formatos aceitos", () => {
    expect(analisarHora("07:30")).toBe(450);
    expect(analisarHora("7:30")).toBe(450);
    expect(analisarHora("07:30:00")).toBe(450);
    expect(analisarHora("07h30")).toBe(450);
    expect(analisarHora("22h")).toBe(22 * 60);
    expect(analisarHora(" 00:00 ")).toBe(0);
    expect(formatarHora(analisarHora("23:59"))).toBe("23:59");
  });

  it("rejeita formatos inválidos", () => {
    for (const t of ["", "  ", "24:00", "12:60", "abc", "7", "07:3a", "1:2:3:4", "123:00", "07:30:15"]) {
      expect(() => analisarHora(t), t).toThrow(ErroMotor);
      expect(tentarAnalisarHora(t)).toBeNull();
    }
  });

  it("duração de turno noturno", () => {
    const noite = criarHorario(h("22:00"), h("06:00"), 60);
    expect(atravessaMeiaNoite(noite)).toBe(true);
    expect(duracaoTotal(noite)).toBe(480);
    expect(minutosTrabalhados(noite)).toBe(420);
    expect(duracaoTotal(criarHorario(h("06:00"), h("14:00")))).toBe(480);
  });

  it("valida o horário", () => {
    expect(() => criarHorario(h("08:00"), h("08:00"), 0)).toThrow(ErroMotor);
    expect(() => criarHorario(h("08:00"), h("09:00"), 60)).toThrow(ErroMotor);
    expect(() => criarHorario(-1, 10, 0)).toThrow(ErroMotor);
    expect(() => criarHorario(0, MINUTOS_DIA, 0)).toThrow(ErroMotor);
  });

  it("formata minutos e horários", () => {
    expect(formatarMinutos(480)).toBe("8h");
    expect(formatarMinutos(450)).toBe("7h30");
    expect(formatarMinutos(5)).toBe("0h05");
    expect(formatarHora(450)).toBe("07:30");
    expect(formatarHorario(criarHorario(h("10:00"), h("16:15"), 15))).toBe("10:00–16:15");
  });
});

describe("calendário", () => {
  it("a semana começa na segunda ou no domingo", () => {
    // 2025-10-01 é quarta-feira.
    const s = semanaContendo("2025-10-01", "segunda");
    expect([s.inicio, s.fim]).toEqual(["2025-09-29", "2025-10-05"]);
    const d = semanaContendo("2025-10-01", "domingo");
    expect([d.inicio, d.fim]).toEqual(["2025-09-28", "2025-10-04"]);
    // O próprio dia inicial pertence à semana que ele abre.
    expect(semanaContendo("2025-09-29", "segunda").inicio).toBe("2025-09-29");
    expect(semanaContendo("2025-10-05", "segunda").inicio).toBe("2025-09-29");
    expect(s.dias()).toHaveLength(7);
    expect(s.contem("2025-10-05")).toBe(true);
    expect(s.contem("2025-10-06")).toBe(false);
  });

  it("mês que começa e termina no meio da semana", () => {
    const semanas = semanasCobrindo("2025-10-01", "2025-10-31", "segunda");
    expect(semanas).toHaveLength(5);
    expect(semanas[0]?.inicio).toBe("2025-09-29");
    expect(semanas[4]?.fim).toBe("2025-11-02");
  });

  it("fevereiro de 2027 tem exatamente 4 semanas", () => {
    const semanas = semanasCobrindo("2027-02-01", "2027-02-28", "segunda");
    expect(semanas).toHaveLength(4);
    expect(semanas[0]?.inicio).toBe("2027-02-01");
    expect(semanas[3]?.fim).toBe("2027-02-28");
    expect(semanasCobrindo("2027-02-02", "2027-02-01", "segunda")).toEqual([]);
  });
});

describe("modelo", () => {
  it("dias da semana em bits", () => {
    const d = diasDeIndices([0, 2, 6, 9, -1]);
    expect(indicesDias(d)).toEqual([0, 2, 6]);
    expect(contemDia(d, 0)).toBe(true);
    expect(contemDia(d, 1)).toBe(false);
    expect(contemDia(d, 6)).toBe(true);
    expect(indicesDias(uniaoDias(diasDeIndices([0, 2]), diasDeIndices([1])))).toEqual([0, 1, 2]);
    expect(indicesDias(TODOS_OS_DIAS)).toHaveLength(7);
  });

  it("as regras padrão são válidas e as inválidas são recusadas", () => {
    expect(errosDasRegras(REGRAS_PADRAO)).toEqual([]);
    expect(() => validarRegras(REGRAS_PADRAO)).not.toThrow();
    const invalidas = [
      { ...REGRAS_PADRAO, cargaSemanalMaxMin: 0 },
      { ...REGRAS_PADRAO, jornadaDiariaMaxMin: 0 },
      { ...REGRAS_PADRAO, jornadaDiariaMaxMin: 10 * 60, cargaSemanalMaxMin: 6 * 60 },
      { ...REGRAS_PADRAO, maxDiasConsecutivos: 0 },
      { ...REGRAS_PADRAO, descansoEntreJornadasMin: 3 * MINUTOS_DIA },
      { ...REGRAS_PADRAO, folgasSemanaisMin: 7 },
      { ...REGRAS_PADRAO, domingosSeguidosMax: 53 },
    ];
    for (const r of invalidas) {
      expect(errosDasRegras(r).length, JSON.stringify(r)).toBeGreaterThan(0);
      expect(() => validarRegras(r)).toThrow(ErroMotor);
    }
  });

  it("normaliza a chave da função", () => {
    expect(chaveFuncao("Farmacêutica (o)")).toBe("farmaceutica");
    expect(chaveFuncao("farmaceutica")).toBe("farmaceutica");
    expect(chaveFuncao("Atendente (as)")).toBe("atendente");
    expect(chaveFuncao("Auxiliar de Cozinha")).toBe("auxiliardecozinha");
    expect(chaveFuncao(chaveFuncao("Açougueiro (a)"))).toBe("acougueiro");
  });

  it("o limite individual nunca supera o do regime", () => {
    const limites = { cargaMaxMin: 40 * 60, folgasMin: 1 };
    expect(limiteDoFuncionario({ cargaSemanalMin: 44 * 60 }, limites)).toBe(40 * 60);
    expect(limiteDoFuncionario({ cargaSemanalMin: 30 * 60 }, limites)).toBe(30 * 60);
    expect(limiteDoFuncionario({}, limites)).toBe(40 * 60);
  });

  it("disponibilidade: ausência e falta tiram o dia", () => {
    const f = funcionario("x", { indisponivel: new Set(["2026-03-02"]), faltas: new Set(["2026-03-03"]) });
    expect(disponivelEm(f, "2026-03-01")).toBe(true);
    expect(disponivelEm(f, "2026-03-02")).toBe(false);
    expect(disponivelEm(f, "2026-03-03")).toBe(false);
  });
});
