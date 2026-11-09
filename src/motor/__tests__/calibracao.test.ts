import { describe, expect, it } from "vitest";
import {
  type Alocacao,
  chaveFuncao,
  datasDoIntervalo,
  diaDaSemana,
  ehHoraExtra,
  encontrarViolacoes,
  etapasEc141,
  gerarEscala,
  minutosDaAlocacao,
  minutosExtras,
  resumoSemanal,
  semanaContendo,
  semanasCobrindo,
  somarDias,
} from "..";
import { assertSemViolacoes, comPreferencia, entrada, equipe, funcionario, horario, regras, Simulacao, turnosDaLoja, umTurno } from "./util";

const CONTRATUAL = 6 * 60;
const comExtra = (parcial: Parameters<typeof regras>[0] = {}) => regras({ jornadaContratualMin: CONTRATUAL, permitirHoraExtra: true, horaExtraDiariaMaxMin: 120, ...parcial });
const cozinheiro = chaveFuncao("Cozinheiro");

function cafeteria(permitirHoraExtra: boolean) {
  const e = entrada("2026-12-01", "2026-12-31", comExtra({ permitirHoraExtra }), turnosDaLoja(1), [
    funcionario("c1", { nome: "Ana", funcao: "Cozinheiro" }),
    funcionario("c2", { nome: "Bia", funcao: "Cozinheiro" }),
  ]);
  e.regime = etapasEc141();
  e.minimoPorFuncao = new Map([[cozinheiro, { nome: "Cozinheiro", minimo: 1 }]]);
  return e;
}

describe("cafeteria com 2 cozinheiros", () => {
  const e = cafeteria(true);
  const r = gerarEscala(e);

  it("nunca viola regras: descanso de 11h, folgas e jornada com extra", () => {
    assertSemViolacoes(e, r);
    expect(r.alocacoes.every((a) => minutosDaAlocacao(a) <= 10 * 60)).toBe(true);
  });

  it("estende jornadas com hora extra de até 2h e avisa", () => {
    const extras = r.alocacoes.filter((a) => a.origem === "horaExtra");
    expect(extras.length).toBeGreaterThan(0);
    for (const a of extras) {
      expect(minutosExtras(a, e.regras)).toBeLessThanOrEqual(120);
      expect(ehHoraExtra(a, e.regras)).toBe(true);
    }
    const avisos = r.avisos.filter((x) => x.tipo === "horaExtra");
    expect(avisos.length).toBe(extras.length);
    expect(avisos[0]?.mensagem).toMatch(/extra em \d\d\/\d\d \(\d\d:\d\d–\d\d:\d\d\) para cobrir Cozinheiro no turno/);
  });

  it("emite cobertura parcial com a janela descoberta", () => {
    const parciais = r.avisos.filter((x) => x.tipo === "coberturaParcial");
    expect(parciais.length).toBeGreaterThan(0);
    expect(parciais[0]?.mensagem).toMatch(/Cozinheiro: turno .* de \d\d\/\d\d descoberto das \d\d:\d\d às \d\d:\d\d\./);
  });

  it("não repete aviso de cobertura insuficiente no turno que recebeu hora extra", () => {
    const comExtraDia = new Set(r.avisos.filter((x) => x.tipo === "horaExtra").map((x) => `${x.data}|${x.turnoId}`));
    const duplicados = r.avisos.filter((x) => (x.tipo === "coberturaInsuficiente" || x.tipo === "funcaoDescoberta") && comExtraDia.has(`${x.data}|${x.turnoId}`));
    expect(duplicados).toEqual([]);
  });

  it("nunca 6 dias de trabalho por semana a partir de 16/12/2026", () => {
    const semanas = semanasCobrindo("2026-12-14", "2026-12-31", "segunda");
    for (const s of semanas) {
      if (s.inicio < "2026-12-14") continue;
      for (const id of ["c1", "c2"]) {
        const dias = new Set(r.alocacoes.filter((a) => a.funcionarioId === id && s.contem(a.data)).map((a) => a.data));
        // A semana de 14/12 já tem a regra de 2 folgas (vale o mais restritivo da semana).
        expect(dias.size, `${id} ${s.inicio}`).toBeLessThanOrEqual(5);
      }
    }
  });

  it("com hora extra desligada volta ao comportamento antigo (sem extensão)", () => {
    const sem = cafeteria(false);
    const rs = gerarEscala(sem);
    assertSemViolacoes(sem, rs);
    expect(rs.alocacoes.every((a) => a.origem !== "horaExtra")).toBe(true);
    expect(rs.avisos.some((x) => x.tipo === "horaExtra" || x.tipo === "coberturaParcial")).toBe(false);
    expect(rs.avisos.some((x) => x.tipo === "funcaoDescoberta" || x.tipo === "coberturaInsuficiente")).toBe(true);
    expect(rs.alocacoes.every((a) => minutosDaAlocacao(a) <= 8 * 60)).toBe(true);
  });

  it("é determinística", () => {
    expect(gerarEscala(cafeteria(true))).toEqual(r);
  });
});

describe("efetivo mínimo sem função", () => {
  it("estende a jornada de quem já trabalha para cobrir o turno e avisa a janela que sobrou", () => {
    const e = entrada("2027-03-01", "2027-03-14", comExtra({ folgasSemanaisMin: 2, cargaSemanalMaxMin: 40 * 60 }), turnosDaLoja(1), equipe(2));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    expect(r.avisos.some((x) => x.tipo === "horaExtra")).toBe(true);
    expect(r.avisos.filter((x) => x.tipo === "coberturaParcial").every((x) => /^Turno .* de \d\d\/\d\d descoberto das \d\d:\d\d às \d\d:\d\d\.$/.test(x.mensagem))).toBe(true);
    // Cada pessoa estende no máximo 2h por jornada e fica no teto de 10h.
    for (const a of r.alocacoes) expect(minutosExtras(a, e.regras)).toBeLessThanOrEqual(120);
  });
});

describe("equipes apertadas", () => {
  it("nunca violam regras (folgas, descanso, teto de 10h) em equipes de 2 a 8 pessoas", () => {
    for (let n = 2; n <= 8; n++) {
      for (const minimo of [1, 2]) {
        const e = entrada("2026-11-23", "2027-01-31", comExtra({ folgasSemanaisMin: 1 }), turnosDaLoja(minimo), equipe(n));
        e.regime = etapasEc141();
        const r = gerarEscala(e);
        assertSemViolacoes(e, r);
        expect(r.alocacoes.every((a) => minutosDaAlocacao(a) <= 10 * 60), `n=${n} min=${minimo}`).toBe(true);
        expect(gerarEscala(e), `determinismo n=${n} min=${minimo}`).toEqual(r);
      }
    }
  });
});

describe("preferência é só desempate", () => {
  it("6 pessoas preferem manhã, 1 tarde: a tarde fica com o efetivo mínimo todos os dias", () => {
    const turnos = turnosDaLoja(0);
    const tarde = turnos[1];
    if (!tarde) throw new Error("turno");
    tarde.efetivoMinimo = 3;
    const equipeP = [...[1, 2, 3, 4, 5, 6].map((i) => comPreferencia(`m${i}`, "manha")), comPreferencia("t1", "tarde")];
    const e = entrada("2027-03-01", "2027-03-31", regras({ folgasSemanaisMin: 2, cargaSemanalMaxMin: 40 * 60 }), turnos, equipeP);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    for (const d of datasDoIntervalo(e.inicio, e.fim)) {
      const n = r.alocacoes.filter((a) => a.data === d && a.turnoId === tarde.id).length;
      expect(n, d).toBeGreaterThanOrEqual(3);
    }
    expect(r.avisos.filter((x) => x.tipo === "coberturaInsuficiente")).toEqual([]);
  });
});

describe("hora extra por limite semanal", () => {
  it("chama quem passou do limite semanal mas tem folga sobrando; o excedente vira hora extra", () => {
    // 2 pessoas, turno de 8h, mínimo 2 por dia, de segunda a sábado (6 dias): 40h = 5 jornadas.
    const turno = umTurno("t", "08:00", "17:00", 60, 2, 0b0111111);
    const reg = regras({ cargaSemanalMaxMin: 40 * 60, folgasSemanaisMin: 1, jornadaContratualMin: 8 * 60 });
    const e = entrada("2027-03-01", "2027-03-07", reg, [turno], equipe(2));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    // Cada pessoa trabalha os 6 dias (48h): 8h extra por semana, e todos os dias ficam com 2.
    expect(r.avisos.filter((x) => x.tipo === "coberturaInsuficiente")).toEqual([]);
    expect(r.alocacoes.filter((a) => a.origem === "horaExtra").length).toBeGreaterThan(0);
    const linha = resumoSemanal({ semana: semanaContendo("2027-03-01", "segunda"), funcionarios: e.funcionarios, turnos: e.turnos, regras: reg, regime: [], alocacoes: r.alocacoes });
    expect(linha.every((l) => l.horaExtraMin > 0)).toBe(true);
  });
});

describe("compensação da hora extra", () => {
  it("saldo de +6h é consumido em até dois meses, sem violar regras nem gerar hora extra", () => {
    const funcs = equipe(8);
    const primeiro = funcs[0];
    if (!primeiro) throw new Error("equipe");
    primeiro.saldoAnteriorMin = 6 * 60;
    const sim = new Simulacao(comExtra({ folgasSemanaisMin: 2, cargaSemanalMaxMin: 40 * 60 }), turnosDaLoja(2), funcs);
    sim.gerar(2026, 12);
    sim.gerar(2027, 1);
    sim.gerar(2027, 2);
    sim.verificarTudo();
    expect(sim.todas().some((a) => a.origem === "horaExtra")).toBe(false);
    // Saldo acumulado até o fim de fevereiro (semanas fechadas).
    const todas: Alocacao[] = sim.todas();
    let saldo = 6 * 60;
    for (const semana of semanasCobrindo("2026-12-01", "2027-02-28", "segunda")) {
      if (!semana.dias().every((d) => d >= "2026-12-01" && d <= "2027-02-28")) continue;
      const l = resumoSemanal({ semana, funcionarios: [primeiro], turnos: sim.turnos, regras: sim.regras, regime: [], alocacoes: todas })[0];
      saldo += l?.saldoMin ?? 0;
    }
    expect(saldo).toBe(0);
  });
});

describe("verificador com hora extra", () => {
  const dia = "2027-03-02";
  const base = (parcial: Parameters<typeof regras>[0] = {}) => entrada("2027-03-01", "2027-03-31", comExtra(parcial), [umTurno("t", "08:00", "20:00", 60)], equipe(1));
  const aloc = (ini: string, fim: string, d = dia): Alocacao => ({ funcionarioId: "f01", turnoId: "t", data: d, horario: horario(ini, fim, 60) });

  it("8h com contratual de 6h e extra permitida: sem violação", () => {
    expect(encontrarViolacoes(base(), [aloc("08:00", "17:00")])).toEqual([]);
  });

  it("10h30 trabalhadas: violação de jornada", () => {
    const v = encontrarViolacoes(base(), [aloc("08:00", "19:30")]);
    expect(v.map((x) => x.tipo)).toEqual(["jornadaDiaria"]);
  });

  it("sem hora extra permitida, 8h com contratual de 6h continua válida só dentro da jornada diária máxima", () => {
    expect(encontrarViolacoes(base({ permitirHoraExtra: false }), [aloc("08:00", "17:00")])).toEqual([]);
    expect(encontrarViolacoes(base({ permitirHoraExtra: false, jornadaDiariaMaxMin: 7 * 60 }), [aloc("08:00", "17:00")]).map((x) => x.tipo)).toEqual(["jornadaDiaria"]);
  });

  it("6º dia na semana de 2 folgas é violação mesmo com extra permitida", () => {
    const e = base({ folgasSemanaisMin: 2 });
    const dias = [0, 1, 2, 3, 4, 5].map((i) => somarDias("2027-03-01", i));
    const v = encontrarViolacoes(e, dias.map((d) => aloc("08:00", "14:00", d)));
    expect(v.map((x) => x.tipo)).toEqual(["folgasSemanais"]);
    expect(diaDaSemana(dias[5] ?? "")).toBe(5);
  });

  it("carga semanal acima do limite deixa de ser violação com extra permitida", () => {
    const e = base({ cargaSemanalMaxMin: 20 * 60 });
    const dias = [0, 1, 2, 3, 4].map((i) => somarDias("2027-03-01", i));
    const alocs = dias.map((d) => aloc("08:00", "17:00", d));
    expect(encontrarViolacoes(e, alocs)).toEqual([]);
    const sem = base({ cargaSemanalMaxMin: 20 * 60, permitirHoraExtra: false });
    expect(encontrarViolacoes(sem, alocs).map((x) => x.tipo)).toEqual(expect.arrayContaining(["cargaSemanal"]));
  });
});
