// Qualidade da escala: folgas estruturais sem compensação, folgas em bloco e no fim de semana,
// equidade de sábados, descanso de 35h, hora extra, dias fechados, contrato parcial e dimensionamento.

import { describe, expect, it } from "vitest";
import {
  type Alocacao,
  type DataISO,
  chaveFuncao,
  datasDoIntervalo,
  dimensionar,
  encontrarViolacoes,
  etapasEc141,
  funcionamentoDoModelo,
  funcoesDescobertas,
  gerarEscala,
  gerarTurnos,
  pessoasPorTurnoDia,
  previstoDaSemana,
  regrasDoModelo,
  resumoSemanal,
  semanaContendo,
  somarDias,
  turnoFuncionaEm,
  type Turno,
  verificarEscala,
  minutosDaAlocacao,
  limitesDaSemana,
  type FuncionarioPlano,
} from "..";
import { assertSemViolacoes, entrada, equipe, funcionario, horario, minimos, regras, Simulacao, tresTurnos, turnosDaLoja, umTurno } from "./util";

/** Escala de um modelo (shopping, comércio...) gerada mês a mês, como o app faz. */
function cenario(modeloId: string, pessoas: number, efetivoMinimo = 1) {
  const f = funcionamentoDoModelo(modeloId);
  const turnos: Turno[] = gerarTurnos(f.janelas, f.jornadaMin, f.intervaloMin).map((g, i) => ({
    id: `t${i + 1}`,
    nome: g.nome,
    horario: g.horario,
    efetivoMinimo,
    ordem: i,
    dias: g.dias,
  }));
  const funcionarios = equipe(pessoas);
  const sim = new Simulacao(regrasDoModelo(modeloId), turnos, funcionarios);
  sim.regime = etapasEc141();
  return { sim, turnos, funcionarios };
}

function gerarMeses(sim: Simulacao, meses: Array<[number, number]>): void {
  for (const [ano, mes] of meses) sim.gerar(ano, mes);
}

const NOV_A_MAR: Array<[number, number]> = [
  [2026, 11],
  [2026, 12],
  [2027, 1],
  [2027, 2],
  [2027, 3],
];

/** Furos: dias e turnos abertos com menos gente que o efetivo mínimo. */
function contarFuros(alocacoes: readonly Alocacao[], turnos: readonly Turno[], de: DataISO, ate: DataISO): number {
  let furos = 0;
  for (const d of datasDoIntervalo(de, ate)) {
    for (const t of turnos) {
      if (!turnoFuncionaEm(t, d)) continue;
      if (alocacoes.filter((a) => a.data === d && a.turnoId === t.id).length < t.efetivoMinimo) furos++;
    }
  }
  return furos;
}

describe("folga do rodízio de domingo antes da EC 141", () => {
  const { sim, turnos } = cenario("shopping", 10);
  gerarMeses(sim, [
    [2026, 11],
    [2026, 12],
  ]);
  const todas = sim.todas();

  it("a folga do domingo é a folga semanal: nada de esticar jornadas para 'pagar' folga estrutural", () => {
    // Antes eram 54 jornadas esticadas (10:00–19:00, 13:00–22:00) em 3 meses.
    expect(todas.filter((a) => a.origem === "compensacao").length).toBeLessThanOrEqual(2);
    const horarios = new Set(todas.map((a) => `${a.horario.inicioMin}-${a.horario.fimMin}`));
    expect(horarios).toEqual(new Set(turnos.map((t) => `${t.horario.inicioMin}-${t.horario.fimMin}`)));
  });

  it("quando o máximo de dias consecutivos obriga uma folga a mais, o previsto da semana cai uma jornada", () => {
    // O motor devolve o previsto das semanas fechadas; quem o grava (previstosGravados) não cria saldo negativo.
    const menores = [...sim.previstos.values()].filter((p) => p < 36 * 60);
    expect(menores.length).toBeGreaterThan(0);
    expect(menores.every((p) => p === 30 * 60)).toBe(true);
    for (const f of sim.funcionarios) {
      const total = sim.saldoAte(f, "2027-01-04", "x");
      expect(Math.abs(total), f.id).toBeLessThanOrEqual(2 * 60);
    }
  });

  it("não deixa furos de cobertura", () => {
    expect(contarFuros(todas, turnos, "2026-11-01", "2026-12-31")).toBe(0);
  });
});

/** Semanas com exatamente 2 folgas em que alguma folga tem outra colada (inclusive na semana vizinha). */
function folgasEmBloco(todas: readonly Alocacao[], ids: readonly string[], de: DataISO, ate: DataISO): { semanas: number; juntas: number } {
  let semanas = 0;
  let juntas = 0;
  for (const id of ids) {
    const dias = new Set(todas.filter((a) => a.funcionarioId === id).map((a) => a.data));
    for (let ini = de; ini <= ate; ini = somarDias(ini, 7)) {
      const folgas = Array.from({ length: 7 }, (_, k) => somarDias(ini, k)).filter((d) => !dias.has(d));
      if (folgas.length !== 2) continue;
      semanas++;
      if (folgas.some((d) => !dias.has(somarDias(d, 1)) || !dias.has(somarDias(d, -1)))) juntas++;
    }
  }
  return { semanas, juntas };
}

describe("folgas em bloco e no fim de semana", () => {
  for (const [nome, modelo, pessoas] of [
    ["shopping com 10 pessoas", "shopping", 10],
    ["comércio com 6 pessoas", "comercio", 6],
  ] as const) {
    it(`${nome}: pelo menos 70% das semanas com 2 folgas coladas, sem furos de cobertura`, () => {
      const { sim, turnos, funcionarios } = cenario(modelo, pessoas);
      gerarMeses(sim, NOV_A_MAR);
      const r = folgasEmBloco(sim.todas(), funcionarios.map((f) => f.id), "2026-12-21", "2027-03-22");
      expect(r.semanas).toBe(pessoas * 14);
      expect(r.juntas / r.semanas).toBeGreaterThanOrEqual(0.7);
      expect(contarFuros(sim.todas(), turnos, "2026-11-01", "2027-03-31")).toBe(0);
      sim.verificarTudo();
    });
  }

  it("com a cobertura mínima em risco, a folga em bloco cede: nenhum turno fica abaixo do efetivo", () => {
    // 4 pessoas para 2 turnos de 1 pessoa nos 7 dias: sobram só 6 turnos-dia por semana de folga.
    const { sim, turnos } = cenario("shopping", 4);
    gerarMeses(sim, NOV_A_MAR);
    expect(contarFuros(sim.todas(), turnos, "2026-11-01", "2027-03-31")).toBe(0);
  });
});

describe("equidade de sábados e domingos livres", () => {
  it("no shopping com 10 pessoas, a diferença de sábados livres entre pessoas é de no máximo 2 em 13 semanas", () => {
    const { sim, funcionarios } = cenario("shopping", 10);
    gerarMeses(sim, [...NOV_A_MAR, [2027, 4], [2027, 5], [2027, 6]]);
    const todas = sim.todas();
    for (const inicio of ["2026-12-21", "2027-01-04", "2027-01-18", "2027-02-01", "2027-02-15"]) {
      const livres = funcionarios.map((f) => {
        const dias = new Set(todas.filter((a) => a.funcionarioId === f.id).map((a) => a.data));
        return Array.from({ length: 13 }, (_, k) => somarDias(inicio, 7 * k + 5)).filter((sab) => !dias.has(sab)).length;
      });
      expect(Math.max(...livres) - Math.min(...livres), `${inicio}: ${livres.join(",")}`).toBeLessThanOrEqual(2);
    }
  });

  it("domingos livres também ficam equilibrados", () => {
    const { sim, funcionarios } = cenario("shopping", 10);
    gerarMeses(sim, NOV_A_MAR);
    const todas = sim.todas();
    const livres = funcionarios.map((f) => {
      const dias = new Set(todas.filter((a) => a.funcionarioId === f.id).map((a) => a.data));
      return Array.from({ length: 13 }, (_, k) => somarDias("2026-12-28", 7 * k)).filter((dom) => !dias.has(dom)).length;
    });
    expect(Math.max(...livres) - Math.min(...livres)).toBeLessThanOrEqual(2);
  });
});

describe("descanso de 35h em volta da folga (CLT arts. 66 e 67, Súmula 110 do TST)", () => {
  const cozinha = chaveFuncao("Farmacêutico");
  function farmacia(parcial: Parameters<typeof regras>[0] = {}) {
    const e = entrada(
      "2027-01-01",
      "2027-01-31",
      regras({ jornadaContratualMin: 8 * 60, permitirHoraExtra: true, horaExtraDiariaMaxMin: 120, domingosSeguidosMax: 0, ...parcial }),
      tresTurnos(1),
      equipe(4, { funcao: "Farmacêutico" }),
    );
    e.regime = etapasEc141();
    e.minimoPorFuncao = new Map([[cozinha, { nome: "Farmacêutico", minimo: 1 }]]);
    return e;
  }

  /** Intervalos (minutos) entre a última saída antes de uma folga e a entrada seguinte. */
  function intervalosEmVoltaDeFolgas(alocacoes: readonly Alocacao[]): number[] {
    const intervalos: number[] = [];
    const porPessoa = new Map<string, Alocacao[]>();
    for (const a of alocacoes) porPessoa.set(a.funcionarioId, [...(porPessoa.get(a.funcionarioId) ?? []), a]);
    const inicio = (a: Alocacao): number => datasDoIntervalo("1970-01-01", a.data).length * 1440 + a.horario.inicioMin;
    const fim = (a: Alocacao): number => {
      const dur = a.horario.fimMin <= a.horario.inicioMin ? 1440 - a.horario.inicioMin + a.horario.fimMin : a.horario.fimMin - a.horario.inicioMin;
      return inicio(a) + dur;
    };
    for (const lista of porPessoa.values()) {
      lista.sort((a, b) => inicio(a) - inicio(b));
      for (let i = 1; i < lista.length; i++) {
        const ant = lista[i - 1];
        const seg = lista[i];
        if (!ant || !seg) continue;
        if (datasDoIntervalo(ant.data, seg.data).length > 2) intervalos.push(inicio(seg) - fim(ant));
        else if (seg.data > somarDias(ant.data, 1)) intervalos.push(inicio(seg) - fim(ant));
      }
    }
    return intervalos;
  }

  it("a farmácia 24h com 4 farmacêuticos e hora extra não tem intervalo menor que 35h em volta de folgas", () => {
    const e = farmacia();
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    expect(r.alocacoes.some((a) => a.origem === "horaExtra")).toBe(true);
    const intervalos = intervalosEmVoltaDeFolgas(r.alocacoes);
    expect(intervalos.length).toBeGreaterThan(0);
    expect(Math.min(...intervalos)).toBeGreaterThanOrEqual(35 * 60);
  });

  it("o verificador acusa um caso plantado (noite, folga, manhã: só 24h de intervalo)", () => {
    const e = entrada("2027-03-01", "2027-03-31", regras(), tresTurnos(0), equipe(1));
    const noite = tresTurnos(0)[2];
    const manha = tresTurnos(0)[0];
    const aloc = (data: DataISO, turnoId: string, h: Alocacao["horario"]): Alocacao => ({ funcionarioId: "f01", turnoId, data, horario: h });
    const plantado = [aloc("2027-03-02", "noite", noite?.horario ?? horario("22:00", "06:00")), aloc("2027-03-04", "manha", manha?.horario ?? horario("06:00", "14:00"))];
    const v = encontrarViolacoes(e, plantado);
    expect(v.map((x) => x.tipo)).toEqual(["descansoSemanal"]);
    expect(v[0]).toMatchObject({ minimo: 35 * 60 });
    expect(v[0]?.mensagem).toMatch(/24h entre a última saída antes da folga/);
    // O verificador também entrega o caso como aviso de violação de regra.
    expect(verificarEscala(e, plantado).map((a) => a.tipo)).toEqual(["violacaoRegra"]);
    // A regra pode ser desligada (0) ou ajustada.
    expect(encontrarViolacoes({ ...e, regras: regras({ descansoSemanalMin: 0 }) }, plantado)).toEqual([]);
    expect(encontrarViolacoes({ ...e, regras: regras({ descansoSemanalMin: 20 * 60 }) }, plantado)).toEqual([]);
    // Noite, folga, noite: 40h, sem problema.
    expect(encontrarViolacoes(e, [plantado[0] as Alocacao, aloc("2027-03-04", "noite", noite?.horario ?? horario("22:00", "06:00"))])).toEqual([]);
  });

  it("valida o campo novo das regras", () => {
    expect(() => gerarEscala(farmacia({ descansoSemanalMin: -1 }))).toThrow();
    expect(() => gerarEscala(farmacia({ horaExtraSemanalMaxMin: -5 }))).toThrow();
  });
});

describe("hora extra: aviso de excesso semanal e teto semanal", () => {
  const farmaceutico = chaveFuncao("Farmacêutico");
  function farmacia(parcial: Parameters<typeof regras>[0] = {}) {
    // Janeiro/2028: já valem 40h e 2 folgas, então 4 pessoas (5 × 8h = 40h) cobrem 20 dos 21 turnos da semana.
    const e = entrada(
      "2028-01-03",
      "2028-01-30",
      regras({ jornadaContratualMin: 8 * 60, permitirHoraExtra: true, horaExtraDiariaMaxMin: 120, domingosSeguidosMax: 0, ...parcial }),
      tresTurnos(1),
      equipe(4, { funcao: "Farmacêutico" }),
    );
    e.regime = etapasEc141();
    e.minimoPorFuncao = new Map([[farmaceutico, { nome: "Farmacêutico", minimo: 1 }]]);
    return e;
  }

  it("o motor avisa a semana que passou do limite legal por causa da hora extra", () => {
    const r = gerarEscala(farmacia());
    const excessos = r.avisos.filter((a) => a.tipo === "excessoSemanal");
    expect(excessos.length).toBeGreaterThan(0);
    expect(excessos[0]?.mensagem).toMatch(/^Funcionário f\d\d: \d+h(\d\d)? na semana de \d\d\/\d\d \(limite 40h\), \d+h(\d\d)? de hora extra\.$/);
    expect(excessos.every((a) => a.data !== undefined && a.funcionarioId !== undefined)).toBe(true);
  });

  it("o verificador avisa o excesso (sem tratá-lo como violação, já que a hora extra está ligada)", () => {
    const f = [funcionario("a", { nome: "Ana" })];
    const e = entrada("2026-12-14", "2026-12-20", regras({ cargaSemanalMaxMin: 44 * 60, jornadaDiariaMaxMin: 10 * 60, jornadaContratualMin: 8 * 60, permitirHoraExtra: true }), [umTurno("longo", "06:00", "16:00", 60)], f);
    e.regime = etapasEc141();
    // 5 dias de 9h = 45h numa semana que já vale 42h (a de 14/12 pega a primeira etapa da transição).
    const alocs: Alocacao[] = ["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18"].map((data) => ({
      funcionarioId: "a",
      turnoId: "longo",
      data,
      horario: horario("06:00", "16:00", 60),
    }));
    expect(encontrarViolacoes(e, alocs)).toEqual([]);
    const avisos = verificarEscala(e, alocs);
    expect(avisos).toHaveLength(1);
    expect(avisos[0]).toMatchObject({ tipo: "excessoSemanal", funcionarioId: "a", data: "2026-12-14" });
    expect(avisos[0]?.mensagem).toBe("Ana: 45h na semana de 14/12 (limite 42h), 3h de hora extra.");
  });

  it("o teto semanal de hora extra limita as extensões (padrão: teto diário × dias de trabalho)", () => {
    const livre = gerarEscala(farmacia());
    const extraDe = (e: ReturnType<typeof farmacia>, alocacoes: readonly Alocacao[]): number => {
      let maior = 0;
      for (const semana of [semanaContendo("2028-01-03", "segunda"), semanaContendo("2028-01-10", "segunda"), semanaContendo("2028-01-17", "segunda"), semanaContendo("2028-01-24", "segunda")]) {
        for (const l of resumoSemanal({ semana, funcionarios: e.funcionarios, turnos: e.turnos, regras: e.regras, regime: e.regime, alocacoes })) maior = Math.max(maior, l.horaExtraMin);
      }
      return maior;
    };
    const e60 = farmacia({ horaExtraSemanalMaxMin: 60 });
    const r60 = gerarEscala(e60);
    assertSemViolacoes(e60, r60);
    expect(extraDe(e60, r60.alocacoes)).toBeLessThanOrEqual(60);
    expect(extraDe(farmacia(), livre.alocacoes)).toBeGreaterThan(60);
    const e0 = farmacia({ horaExtraSemanalMaxMin: 0 });
    const r0 = gerarEscala(e0);
    expect(r0.alocacoes.some((a) => a.origem === "horaExtra")).toBe(false);
    expect(r0.avisos.some((a) => a.tipo === "coberturaInsuficiente" || a.tipo === "funcaoDescoberta")).toBe(true);
  });
});

describe("ausência em dia de folga", () => {
  it("o previsto não perde dias de trabalho: ausente no sábado e no domingo, a pessoa deve 5 jornadas", () => {
    const turnos = turnosDaLoja();
    const semana = semanaContendo("2027-03-08", "segunda");
    const limites = limitesDaSemana(regras(), [], semana);
    const f = funcionario("a", { indisponivel: new Set(["2027-03-13", "2027-03-14"]) });
    expect(previstoDaSemana(f, turnos, limites, semana, 360)).toBe(5 * 360);
    // Uma ausência só, com 1 folga por semana: ela é a folga, e as outras 6 jornadas continuam previstas.
    expect(previstoDaSemana(funcionario("b", { indisponivel: new Set(["2027-03-10"]) }), turnos, limites, semana, 360)).toBe(6 * 360);
    // Três ausências: abona as 3 jornadas que a folga não cobre... 7 dias − 3 = 4 jornadas.
    expect(previstoDaSemana(funcionario("c", { indisponivel: new Set(["2027-03-09", "2027-03-10", "2027-03-11"]) }), turnos, limites, semana, 360)).toBe(4 * 360);
  });

  it("o motor completa a carga nos dias restantes quando a ausência cai na folga", () => {
    const funcs = equipe(6).map((f, i) => (i === 0 ? { ...f, indisponivel: new Set(["2027-03-13", "2027-03-14"]) } : f));
    const e = entrada("2027-03-01", "2027-03-31", regras(), turnosDaLoja(), funcs);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    const daSemana = r.alocacoes.filter((a) => a.funcionarioId === "f01" && a.data >= "2027-03-08" && a.data <= "2027-03-14");
    expect(daSemana).toHaveLength(5);
    expect(daSemana.every((a) => minutosDaAlocacao(a) === 360)).toBe(true);
  });
});

describe("dias fechados (feriados)", () => {
  const FECHADO = "2026-12-25";

  function lojaFeriado() {
    const e = entrada("2026-12-01", "2026-12-31", regrasDoModelo("shopping"), turnosDaLoja(1), equipe(10, { funcao: "atendente" }));
    e.regime = etapasEc141();
    e.minimoPorFuncao = minimos([["atendente", 1]]);
    e.diasFechados = new Set([FECHADO]);
    return e;
  }

  it("ninguém é escalado, e não há aviso de cobertura nem de função no dia", () => {
    const e = lojaFeriado();
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    expect(r.alocacoes.some((a) => a.data === FECHADO)).toBe(false);
    expect(r.avisos.filter((a) => a.data === FECHADO)).toEqual([]);
    expect(r.avisos.some((a) => a.mensagem.includes("25/12"))).toBe(false);
    // Os demais dias seguem cobertos.
    for (const d of datasDoIntervalo("2026-12-01", "2026-12-31")) {
      if (d === FECHADO) continue;
      for (const t of e.turnos) expect(r.alocacoes.filter((a) => a.data === d && a.turnoId === t.id).length, `${d} ${t.nome}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("a hora extra não tenta cobrir o dia fechado", () => {
    const e = entrada("2026-12-21", "2026-12-27", regras({ jornadaContratualMin: 480, permitirHoraExtra: true }), tresTurnos(1), equipe(2, { funcao: "farmacia" }));
    e.minimoPorFuncao = minimos([["farmacia", 1]]);
    e.diasFechados = new Set(["2026-12-25"]);
    const r = gerarEscala(e);
    expect(r.alocacoes.some((a) => a.data === "2026-12-25")).toBe(false);
    expect(r.avisos.filter((a) => a.data === "2026-12-25")).toEqual([]);
  });

  it("o previsto da semana cai uma jornada quando o dia fechado deixa menos dias abertos que de trabalho", () => {
    // Comércio de segunda a sábado (6 dias abertos), 1 folga por semana: o feriado de sexta deixa 5 dias abertos.
    const turnos = Array.from({ length: 1 }, () => umTurno("c", "09:00", "18:00", 60, 1, 0b0111111));
    const semana = semanaContendo("2026-11-16", "segunda");
    const limites = limitesDaSemana(regras({ cargaSemanalMaxMin: 44 * 60 }), [], semana);
    const f = funcionario("a");
    expect(previstoDaSemana(f, turnos, limites, semana, 480)).toBe(5 * 480); // 44h / 8h = 5 jornadas
    const folgado = limitesDaSemana(regras({ cargaSemanalMaxMin: 48 * 60 }), [], semana);
    expect(previstoDaSemana(f, turnos, folgado, semana, 480)).toBe(6 * 480);
    expect(previstoDaSemana(f, turnos, folgado, semana, 480, { diasFechados: new Set(["2026-11-20"]) })).toBe(5 * 480);
    // O resumo semanal leva o conjunto adiante.
    const linha = resumoSemanal({ semana, funcionarios: [f], turnos, regras: regras({ cargaSemanalMaxMin: 48 * 60 }), regime: [], alocacoes: [], diasFechados: new Set(["2026-11-20"]) })[0];
    expect(linha?.previstoMin).toBe(5 * 480);
  });

  it("o verificador trata alocação em dia fechado como violação de regra", () => {
    const e = lojaFeriado();
    const planta: Alocacao = { funcionarioId: "f01", turnoId: "t1", data: FECHADO, horario: e.turnos[0]?.horario ?? horario("10:00", "16:15", 15) };
    expect(encontrarViolacoes(e, [planta]).map((v) => v.tipo)).toEqual(["diaFechado"]);
    expect(verificarEscala(e, [planta]).map((a) => a.tipo)).toEqual(["violacaoRegra"]);
  });

  it("os resumos da agenda ignoram o dia fechado", () => {
    const turnos = turnosDaLoja(1);
    const alocs: Alocacao[] = [{ funcionarioId: "f01", turnoId: "t1", data: FECHADO, horario: turnos[0]?.horario ?? horario("10:00", "16:15", 15) }];
    expect(pessoasPorTurnoDia(alocs).has(FECHADO)).toBe(true);
    expect(pessoasPorTurnoDia(alocs, new Set([FECHADO])).has(FECHADO)).toBe(false);
    const mapa = new Map([["atendente", { nome: "atendente", minimo: 1 }]]);
    const base = { datas: [FECHADO], alocacoes: [], funcionarios: equipe(2, { funcao: "atendente" }) as FuncionarioPlano[], turnos, minimoPorFuncao: mapa };
    expect(funcoesDescobertas(base).length).toBeGreaterThan(0);
    expect(funcoesDescobertas({ ...base, diasFechados: new Set([FECHADO]) })).toEqual([]);
  });
});

describe("contrato parcial", () => {
  it("contrato de 30h com turno de 8h fecha 24h por semana e avisa, sem encurtar o turno", () => {
    const funcs = [funcionario("a", { nome: "Ana", cargaSemanalMin: 30 * 60 }), ...equipe(5).map((f) => ({ ...f }))];
    const e = entrada("2027-03-01", "2027-03-28", regras(), [umTurno("dia", "09:00", "18:00", 60, 1)], funcs);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    const avisos = r.avisos.filter((a) => a.tipo === "cargaAbaixoDoAlvo" && a.funcionarioId === "a");
    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.mensagem).toBe("Ana: contrato de 30h, mas a escala fecha 24h por semana porque o turno tem 8h; ajuste a jornada da pessoa ou aceite.");
    expect(r.alocacoes.filter((a) => a.funcionarioId === "a").every((a) => minutosDaAlocacao(a) === 8 * 60)).toBe(true);
    // Quem não tem contrato próprio não gera esse aviso.
    expect(r.avisos.filter((a) => a.tipo === "cargaAbaixoDoAlvo" && a.funcionarioId !== "a")).toEqual([]);
  });
});

describe("dimensionamento da equipe", () => {
  const turnos = turnosDaLoja(0);
  const regrasLoja = regrasDoModelo("shopping");
  const pessoas = (atendentes: number, cozinheiros: number) => [
    ...Array.from({ length: atendentes }, (_, i) => ({ id: `a${i}`, cargo: "Atendente", ativo: true })),
    ...Array.from({ length: cozinheiros }, (_, i) => ({ id: `c${i}`, cargo: "Cozinheiro", ativo: true })),
  ];
  const minimosCafeteria = new Map([
    [chaveFuncao("Atendente"), { nome: "Atendente", minimo: 1 }],
    [chaveFuncao("Cozinheiro"), { nome: "Cozinheiro", minimo: 1 }],
  ]);
  const dimensionarEm = (funcionarios: ReturnType<typeof pessoas>, dataReferencia: DataISO, parcial: Partial<Parameters<typeof dimensionar>[0]> = {}) =>
    dimensionar({ turnos, funcionarios, minimoPorFuncao: minimosCafeteria, regras: regrasLoja, regime: etapasEc141(), dataReferencia, ...parcial });
  const linha = (d: ReturnType<typeof dimensionar>, nome: string) => d.linhas.find((l) => l.nome === nome);

  it("cafeteria com 5 atendentes e 2 cozinheiros: contratar 1 cozinheiro antes de 16/12 e 2 depois", () => {
    // 2 turnos × 7 dias = 14 turnos-dia por função. Antes: 6 jornadas por pessoa (1 folga); depois: 5 (2 folgas); margem de 8%.
    const antes = dimensionarEm(pessoas(5, 2), "2026-11-18");
    expect(linha(antes, "Atendente")).toMatchObject({ faltamPessoas: 0, demandaTurnosSemana: 14 });
    expect(linha(antes, "Cozinheiro")).toMatchObject({ faltamPessoas: 1, demandaTurnosSemana: 14, pessoas: 2 });
    expect(linha(antes, "Cozinheiro")?.capacidadeTurnosSemana).toBeCloseTo(2 * 6 * 0.92, 1);
    const depois = dimensionarEm(pessoas(5, 2), "2026-12-30");
    expect(linha(depois, "Atendente")?.faltamPessoas).toBe(0);
    expect(linha(depois, "Cozinheiro")).toMatchObject({ faltamPessoas: 2, turnosPorPessoaNova: 4.6 });
    expect(depois.faltas.map((l) => l.nome)).toEqual(["Cozinheiro"]);
    expect(linha(depois, "Cozinheiro")?.mensagem).toMatch(/^Cozinheiro: 2 pessoas cobrem 9 de 14 turnos por semana\. Contratar 2 pessoas/);
  });

  it("função sem mínimo configurado não é exigida; o efetivo mínimo dos turnos continua na tabela", () => {
    const comEfetivo = turnos.map((t) => ({ ...t, efetivoMinimo: 2 }));
    const d = dimensionarEm(pessoas(5, 2), "2026-12-30", { turnos: comEfetivo, minimoPorFuncao: new Map() });
    const atendente = linha(d, "Atendente");
    expect(atendente).toMatchObject({ minimoPorTurno: 0, demandaTurnosSemana: 0, faltamPessoas: 0 });
    expect(atendente?.mensagem).toContain("sem exigência");
    expect(d.linhas.some((l) => l.funcao === "")).toBe(true);
  });

  it("equipe suficiente: ninguém a contratar", () => {
    const d = dimensionarEm(pessoas(5, 4), "2026-12-30");
    expect(d.faltas).toEqual([]);
    expect(d.linhas.every((l) => l.faltamPessoas === 0 && l.horasExtrasSemanaMin === 0)).toBe(true);
    expect(linha(d, "Cozinheiro")?.mensagem).toContain("Equipe suficiente.");
  });

  it("função exigida sem ninguém no cadastro: contratar o que a demanda pede", () => {
    const minimosComBarista = new Map([...minimosCafeteria, [chaveFuncao("Barista"), { nome: "Barista", minimo: 1 }]]);
    const antes = dimensionarEm(pessoas(5, 4), "2026-11-18", { minimoPorFuncao: minimosComBarista });
    // 14 turnos-dia ÷ (6 jornadas × 0,92 = 5,52 por pessoa nova) = 2,5 → 3 pessoas.
    expect(linha(antes, "Barista")).toMatchObject({ pessoas: 0, faltamPessoas: 3, demandaTurnosSemana: 14 });
    const depois = dimensionarEm(pessoas(5, 4), "2026-12-30", { minimoPorFuncao: minimosComBarista });
    // 14 ÷ (5 × 0,92 = 4,6) = 3,04 → 4 pessoas.
    expect(linha(depois, "Barista")?.faltamPessoas).toBe(4);
    expect(depois.faltas[0]?.nome).toBe("Barista");
  });

  it("sem hora extra permitida, o que falta não é cobrível com hora extra", () => {
    // 3 cozinheiros cobrem 13,8 dos 14 turnos: o que falta (cerca de 1h10 por semana) cabe na hora extra.
    const comExtra = dimensionarEm(pessoas(5, 3), "2026-12-30");
    expect(linha(comExtra, "Cozinheiro")).toMatchObject({ faltamPessoas: 1, cobrivelComHoraExtra: true });
    expect(linha(comExtra, "Cozinheiro")?.mensagem).toContain("ou aceitar cerca de");
    const semExtra = dimensionarEm(pessoas(5, 3), "2026-12-30", { regras: { ...regrasLoja, permitirHoraExtra: false } });
    const c = linha(semExtra, "Cozinheiro");
    expect(c?.faltamPessoas).toBe(1);
    expect(c?.cobrivelComHoraExtra).toBe(false);
    expect(c?.mensagem).toContain("nem com hora extra dá para cobrir");
    // Com 2 cozinheiros o que falta (quase 29h por semana) passa do teto legal de hora extra mesmo com ela ligada.
    expect(linha(dimensionarEm(pessoas(5, 2), "2026-12-30"), "Cozinheiro")?.cobrivelComHoraExtra).toBe(false);
    // Sem falta, sempre "cobrível".
    expect(linha(semExtra, "Atendente")?.cobrivelComHoraExtra).toBe(true);
  });

  it("pessoas inativas e fora do regime: inativas não contam; isenta da EC 141 segue só a regra da empresa", () => {
    const equipeInativa = [...pessoas(5, 2), { id: "c9", cargo: "Cozinheiro", ativo: false }];
    expect(linha(dimensionarEm(equipeInativa, "2026-12-30"), "Cozinheiro")?.pessoas).toBe(2);
    const isentas = pessoas(5, 2).map((p) => (p.cargo === "Cozinheiro" ? { ...p, isentoRegime: true } : p));
    const d = dimensionarEm(isentas, "2026-12-30");
    // Isentas fazem 6 jornadas (1 folga da empresa): 2 × 6 × 0,92 = 11,04 de 14 → falta 1 (a pessoa nova segue a lei).
    expect(linha(d, "Cozinheiro")?.faltamPessoas).toBe(1);
  });
});
