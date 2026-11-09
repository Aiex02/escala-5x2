import { describe, expect, it } from "vitest";
import {
  type Alocacao,
  type Aviso,
  diaDaSemana,
  diasDeIndices,
  ehTipoAviso,
  ErroMotor,
  gerarEscala,
  MAX_DIAS_PERIODO,
  minutosDaAlocacao,
  resumoSemanal,
  semanaContendo,
  semanasCobrindo,
  somarDias,
  TODOS_OS_DIAS,
} from "..";
import {
  assertSemViolacoes,
  diasPorSemana,
  entrada,
  equipe,
  funcionario,
  h,
  horario,
  horasPorSemana,
  mes,
  Simulacao,
  regras,
  tresTurnos,
  umTurno,
} from "./util";

const H40 = 40 * 60;

describe("limite semanal e ausência de hora extra", () => {
  it("nenhuma semana passa de 40h em três anos gerados em sequência", () => {
    const t = tresTurnos(2);
    const sim = new Simulacao(regras(), t, equipe(12));
    for (let ano = 2025; ano <= 2027; ano++) {
      for (let m = 1; m <= 12; m++) sim.gerar(ano, m);
    }
    sim.verificarTudo();
    for (const minutos of horasPorSemana(sim.todas()).values()) expect(minutos).toBeLessThanOrEqual(H40);
  });

  it("semanas completas usam toda a carga sem ultrapassar (fevereiro/2027 = 4 semanas inteiras)", () => {
    const funcs = equipe(12);
    const [ini, fim] = mes(2027, 2);
    const e = entrada(ini, fim, regras(), tresTurnos(2), funcs);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    const horas = horasPorSemana(r.alocacoes);
    for (const f of funcs) {
      for (const s of semanasCobrindo(ini, fim, "segunda")) {
        expect(horas.get(`${f.id}|${s.inicio}`) ?? 0).toBe(H40);
      }
    }
    expect(r.avisos).toEqual([]);
  });

  it("folgas distribuídas em 5x2 mantêm a cobertura estável", () => {
    // 7 pessoas, 5 jornadas cada por semana: 5 pessoas por dia em média. As folgas em bloco (dias
    // seguidos) trocam a igualdade exata por uma variação de 1 pessoa para mais ou para menos.
    const [ini, fim] = mes(2027, 2);
    const e = entrada(ini, fim, regras(), [umTurno("unico", "06:00", "14:00")], equipe(7));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    const porDia = new Map<string, number>();
    for (const a of r.alocacoes) porDia.set(a.data, (porDia.get(a.data) ?? 0) + 1);
    let total = 0;
    for (let d = ini; d <= fim; d = somarDias(d, 1)) {
      const n = porDia.get(d) ?? 0;
      total += n;
      expect(n, d).toBeGreaterThanOrEqual(4);
      expect(n, d).toBeLessThanOrEqual(6);
    }
    expect(total).toBe(7 * 4 * 5);
  });

  it("limite configurável e carga individual", () => {
    const funcs = equipe(6);
    funcs[0] = { ...funcs[0]!, cargaSemanalMin: 30 * 60 }; // contrato menor que a regra
    funcs[1] = { ...funcs[1]!, cargaSemanalMin: 44 * 60 }; // contrato maior: vale a regra (36h)
    const sim = new Simulacao(regras({ cargaSemanalMaxMin: 36 * 60 }), tresTurnos(1), funcs);
    for (let m = 1; m <= 6; m++) sim.gerar(2026, m);
    sim.verificarTudo();
    for (const [chave, minutos] of horasPorSemana(sim.todas())) {
      expect(minutos).toBeLessThanOrEqual(chave.startsWith("f01|") ? 30 * 60 : 36 * 60);
    }
  });

  it("turnos com intervalo contam apenas as horas trabalhadas", () => {
    // 07:00–16:00 com 1h de intervalo = 8h trabalhadas.
    const [ini, fim] = mes(2027, 2);
    const e = entrada(ini, fim, regras(), [umTurno("c", "07:00", "16:00", 60)], equipe(3));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    for (const minutos of horasPorSemana(r.alocacoes).values()) expect(minutos).toBe(H40);
  });

  it("jornadas que não dividem o limite ficam abaixo dele", () => {
    // 7h20 por dia: 5 jornadas = 36h40; a 6ª passaria de 40h.
    const [ini, fim] = mes(2027, 2);
    const e = entrada(ini, fim, regras(), [umTurno("c", "06:00", "13:20")], equipe(4));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    for (const minutos of horasPorSemana(r.alocacoes).values()) expect(minutos).toBe(5 * 440);
  });

  it("nunca gera hora extra: propriedade com configurações aleatórias", () => {
    let semente = 20_271;
    const sorteio = (n: number): number => {
      semente = (semente * 1_103_515_245 + 12_345) % 2_147_483_648;
      return Math.floor((semente / 2_147_483_648) * n);
    };
    for (let rodada = 0; rodada < 12; rodada++) {
      const r = regras({
        cargaSemanalMaxMin: (30 + sorteio(15)) * 60,
        folgasSemanaisMin: 1 + sorteio(2),
        domingosSeguidosMax: sorteio(3),
        inicioSemana: sorteio(2) === 0 ? "segunda" : "domingo",
        maxDiasConsecutivos: 4 + sorteio(4),
      });
      const duracao = 4 + sorteio(5);
      const inicio = 6 + sorteio(6);
      const turnos = [
        { ...umTurno("a", `${String(inicio).padStart(2, "0")}:00`, `${String(inicio + duracao).padStart(2, "0")}:00`, 0, sorteio(3)), ordem: 0 },
        { ...umTurno("b", `${String(inicio + 4).padStart(2, "0")}:00`, `${String(inicio + 4 + duracao).padStart(2, "0")}:00`, 0, sorteio(3)), ordem: 1 },
      ];
      const funcs = equipe(2 + sorteio(8)).map((f) => {
        const indisponivel = new Set<string>();
        const faltas = new Set<string>();
        for (let k = 0; k < sorteio(4); k++) indisponivel.add(`2027-03-${String(1 + sorteio(28)).padStart(2, "0")}`);
        if (sorteio(3) === 0) faltas.add(`2027-03-${String(1 + sorteio(28)).padStart(2, "0")}`);
        return { ...f, indisponivel, faltas, saldoAnteriorMin: (sorteio(9) - 4) * 60 };
      });
      const sim = new Simulacao(r, turnos, funcs);
      sim.gerar(2027, 2);
      sim.gerar(2027, 3);
      sim.gerar(2027, 4);
      sim.verificarTudo();
    }
  });
});

describe("semanas incompletas e virada de mês", () => {
  it("mês que começa no meio da semana reserva saldo para o mês anterior", () => {
    // Outubro/2025 começa numa quarta: gerado sozinho, a semana 29/09–05/10 recebe só parte do alvo.
    const sim = new Simulacao(regras(), tresTurnos(1), equipe(6));
    const [, r] = sim.gerar(2025, 10);
    const primeira = semanaContendo("2025-10-01", "segunda");
    for (const [chave, minutos] of horasPorSemana(r.alocacoes)) {
      if (chave.endsWith(`|${primeira.inicio}`)) expect(minutos).toBeLessThan(H40);
    }
    // Setembro gerado depois (fora de ordem) completa a semana sem passar de 40h.
    sim.gerar(2025, 9);
    sim.verificarTudo();
    const total = horasPorSemana(sim.todas());
    for (const f of sim.funcionarios) {
      const minutos = total.get(`${f.id}|${primeira.inicio}`) ?? 0;
      expect(minutos).toBeLessThanOrEqual(H40);
      expect(minutos).toBeGreaterThanOrEqual(H40 - 8 * 60);
    }
  });

  it("mês que termina no meio da semana e mês seguinte respeita o que já foi trabalhado", () => {
    // Janeiro/2026 termina num sábado; a semana 26/01–01/02 tem só o domingo em fevereiro.
    const sim = new Simulacao(regras(), tresTurnos(1), equipe(6));
    sim.gerar(2026, 1);
    const [eFev, rFev] = sim.gerar(2026, 2);
    expect(eFev.alocacoesFixas.some((a) => a.data === "2026-01-31" || a.data === "2026-01-30")).toBe(true);
    const virada = semanaContendo("2026-02-01", "segunda");
    const total = horasPorSemana(sim.todas());
    for (const f of sim.funcionarios) expect(total.get(`${f.id}|${virada.inicio}`) ?? 0).toBeLessThanOrEqual(H40);
    // Quem já tinha 40h na semana não trabalha no domingo 01/02.
    const feitas = new Map<string, number>();
    for (const a of sim.meses.get("2026-1") ?? []) {
      if (virada.contem(a.data)) feitas.set(a.funcionarioId, (feitas.get(a.funcionarioId) ?? 0) + minutosDaAlocacao(a));
    }
    const cheios = new Set([...feitas].filter(([, m]) => m >= H40).map(([id]) => id));
    expect(rFev.alocacoes.filter((a) => a.data === "2026-02-01").every((a) => !cheios.has(a.funcionarioId))).toBe(true);
    sim.verificarTudo();
  });

  it("mês gerado entre dois meses já gerados", () => {
    const sim = new Simulacao(regras(), tresTurnos(1), equipe(9));
    sim.gerar(2026, 3);
    sim.gerar(2026, 5);
    const [e] = sim.gerar(2026, 4);
    expect(e.alocacoesFixas.some((a) => a.data.startsWith("2026-03"))).toBe(true);
    expect(e.alocacoesFixas.some((a) => a.data.startsWith("2026-05"))).toBe(true);
    sim.verificarTudo();
  });

  it("regenerar um mês mantém os vizinhos válidos", () => {
    const sim = new Simulacao(regras(), tresTurnos(1), equipe(6));
    for (let m = 6; m <= 8; m++) sim.gerar(2026, m);
    sim.funcionarios[0] = { ...sim.funcionarios[0]!, cargaSemanalMin: 20 * 60 };
    sim.gerar(2026, 7); // gerar() já verifica o mês contra as regras e os vizinhos fixos
    for (const [chave, minutos] of horasPorSemana(sim.meses.get("2026-7") ?? [])) {
      if (chave.startsWith("f01|")) expect(minutos).toBeLessThanOrEqual(20 * 60);
    }
  });

  it("semana iniciando no domingo", () => {
    const sim = new Simulacao(regras({ inicioSemana: "domingo" }), tresTurnos(1), equipe(6));
    for (let m = 1; m <= 4; m++) sim.gerar(2026, m);
    sim.verificarTudo();
    for (const [chave, minutos] of horasPorSemana(sim.todas(), "domingo")) {
      expect(diaDaSemana(chave.split("|")[1] ?? "")).toBe(6);
      expect(minutos).toBeLessThanOrEqual(H40);
    }
  });

  it("período de um único dia", () => {
    const e = entrada("2026-03-15", "2026-03-15", regras(), tresTurnos(1), equipe(4));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    expect(r.alocacoes.length).toBeGreaterThan(0);
    expect(r.alocacoes.every((a) => a.data === "2026-03-15")).toBe(true);
  });
});

describe("demais restrições", () => {
  it("turno acima da jornada diária é ignorado com aviso", () => {
    const [ini, fim] = mes(2026, 3);
    const e = entrada(ini, fim, regras(), [umTurno("longo", "06:00", "16:00")], equipe(1));
    const r = gerarEscala(e);
    expect(r.alocacoes).toEqual([]);
    expect(r.avisos.some((a) => a.tipo === "turnoExcedeJornada" && a.turnoId === "longo")).toBe(true);
    expect(r.avisos.some((a) => a.tipo === "funcionarioSemTurno")).toBe(true);
  });

  it("descanso entre jornadas considera o mês anterior", () => {
    // Noite de 28/02 termina às 06:00 de 01/03: uma manhã às 06:00 teria 0h de descanso.
    const [ini, fim] = mes(2026, 3);
    const e = entrada(ini, fim, regras(), [umTurno("manha", "06:00", "14:00")], equipe(1));
    e.alocacoesFixas.push({ funcionarioId: "f01", turnoId: "noite", data: "2026-02-28", horario: horario("22:00", "06:00") });
    e.datasPlanejadas.add("2026-02-28");
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    expect(r.alocacoes.every((a) => a.data !== "2026-03-01")).toBe(true);
  });

  it("quem faz vários turnos respeita o descanso ao trocar de turno", () => {
    const sim = new Simulacao(regras(), tresTurnos(2), equipe(8));
    for (let m = 1; m <= 3; m++) sim.gerar(2026, m);
    sim.verificarTudo();
  });

  it("dias consecutivos respeitados na virada do mês", () => {
    const [ini, fim] = mes(2026, 3);
    const t = [umTurno("manha", "06:00", "14:00")];
    const e = entrada(ini, fim, regras(), t, equipe(1));
    // 23/02 a 28/02: 6 dias seguidos (o máximo). 01/03 deve ser folga.
    for (let dia = 23; dia <= 28; dia++) {
      const data = `2026-02-${dia}`;
      e.alocacoesFixas.push({ funcionarioId: "f01", turnoId: "manha", data, horario: t[0]!.horario });
      e.datasPlanejadas.add(data);
    }
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    expect(r.alocacoes.every((a) => a.data !== "2026-03-01")).toBe(true);
  });

  it("férias (ausência justificada) são respeitadas e a semana abonada não gera aviso de carga", () => {
    const ferias = new Set(["2026-03-09", "2026-03-10", "2026-03-11", "2026-03-12", "2026-03-13"]);
    const f = funcionario("f01", { indisponivel: ferias });
    const [ini, fim] = mes(2026, 3);
    const e = entrada(ini, fim, regras(), [umTurno("manha", "06:00", "14:00")], [f]);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    expect(r.alocacoes.length).toBeGreaterThan(0);
    expect(r.alocacoes.every((a) => !ferias.has(a.data))).toBe(true);
    expect(r.avisos.some((a) => a.tipo === "cargaAbaixoDoAlvo" && a.data === "2026-03-09")).toBe(false);
  });

  it("efetivo mínimo impossível gera aviso e não gera hora extra", () => {
    const [ini, fim] = mes(2026, 3);
    const e = entrada(ini, fim, regras(), tresTurnos(3), equipe(2));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    expect(r.avisos.filter((a) => a.tipo === "coberturaInsuficiente").length).toBeGreaterThan(28);
    for (const minutos of horasPorSemana(r.alocacoes).values()) expect(minutos).toBeLessThanOrEqual(H40);
  });

  it("turno com efetivo mínimo e ninguém habilitado gera um aviso geral só", () => {
    const [ini, fim] = mes(2026, 3);
    const r = gerarEscala(entrada(ini, fim, regras(), tresTurnos(1), []));
    const avisos = r.avisos.filter((a) => a.tipo === "coberturaInsuficiente");
    expect(avisos).toHaveLength(3);
    expect(avisos.every((a) => a.data === undefined)).toBe(true);
  });

  it("funcionário sem turno possível gera aviso", () => {
    const [ini, fim] = mes(2026, 3);
    const r = gerarEscala(entrada(ini, fim, regras(), [], equipe(1)));
    expect(r.alocacoes).toEqual([]);
    expect(r.avisos.some((a) => a.tipo === "funcionarioSemTurno")).toBe(true);
  });

  it("a geração é determinística", () => {
    const [ini, fim] = mes(2026, 5);
    const e = entrada(ini, fim, regras(), tresTurnos(2), equipe(8, { saldoAnteriorMin: 120 }));
    expect(gerarEscala(e)).toEqual(gerarEscala(e));
  });

  it("entradas inválidas são rejeitadas com ErroMotor", () => {
    const base = () => entrada("2026-03-01", "2026-03-31", regras(), tresTurnos(0), equipe(1));
    const erro = (e: ReturnType<typeof base>): string => {
      try {
        gerarEscala(e);
      } catch (x) {
        if (x instanceof ErroMotor) return x.codigo;
        throw x;
      }
      return "nenhum";
    };
    expect(erro({ ...base(), fim: "2026-02-28" })).toBe("periodoInvalido");
    expect(erro({ ...base(), fim: "2026-02-30" })).toBe("periodoInvalido");
    expect(erro({ ...base(), inicio: "2026-01-01", fim: somarDias("2026-01-01", MAX_DIAS_PERIODO) })).toBe("periodoLongo");
    expect(erro({ ...base(), regras: regras({ cargaSemanalMaxMin: 0 }) })).toBe("regrasInvalidas");
    expect(erro({ ...base(), funcionarios: [...equipe(1), ...equipe(1)] })).toBe("funcionarioDuplicado");
    expect(erro({ ...base(), turnos: [...tresTurnos(0), ...tresTurnos(0)] })).toBe("turnoDuplicado");
    const fixa: Alocacao = { funcionarioId: "f01", turnoId: "manha", data: "2026-03-10", horario: horario("06:00", "14:00") };
    expect(erro({ ...base(), alocacoesFixas: [fixa] })).toBe("fixaDentroDoPeriodo");
    expect(erro({ ...base(), alocacoesTravadas: [{ ...fixa, data: "2026-04-10" }] })).toBe("travadaForaDoPeriodo");
    expect(erro(base())).toBe("nenhum");
  });
});

describe("dias de funcionamento do turno", () => {
  it("turno de segunda a sexta não recebe ninguém no fim de semana e fecha 40h", () => {
    const t = [umTurno("util", "08:00", "16:00", 0, 2, diasDeIndices([0, 1, 2, 3, 4]))];
    const [ini, fim] = mes(2027, 2);
    const e = entrada(ini, fim, regras(), t, equipe(6));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    expect(r.alocacoes.every((a) => diaDaSemana(a.data) < 5)).toBe(true);
    // 5 dias abertos: cada um faz as 5 jornadas (40h) por semana.
    for (const minutos of horasPorSemana(r.alocacoes).values()) expect(minutos).toBe(H40);
    expect(r.avisos).toEqual([]);
  });

  it("semana que termina em dias sem funcionamento não reduz o alvo", () => {
    // Março/2027 termina numa quarta; a semana 29/03–04/04 só tem 3 dias no mês e o turno é seg–sex.
    const t = [umTurno("util", "08:00", "16:00", 0, 0, diasDeIndices([0, 1, 2, 3, 4]))];
    const sim = new Simulacao(regras(), t, equipe(4));
    sim.gerar(2027, 3);
    sim.gerar(2027, 4);
    sim.verificarTudo();
    const semana = semanaContendo("2027-03-31", "segunda");
    const total = horasPorSemana(sim.todas());
    for (const f of sim.funcionarios) expect(total.get(`${f.id}|${semana.inicio}`)).toBe(H40);
  });

  it("turno seg–sáb e turno de todos os dias: domingo só no turno ativo", () => {
    const t = [
      { ...umTurno("m", "06:00", "14:00", 0, 1, diasDeIndices([0, 1, 2, 3, 4, 5])), ordem: 0 },
      { ...umTurno("d", "08:00", "16:00", 0, 1, TODOS_OS_DIAS), ordem: 1 },
    ];
    const [ini, fim] = mes(2027, 2);
    const e = entrada(ini, fim, regras({ folgasSemanaisMin: 2 }), t, equipe(6));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    for (const a of r.alocacoes) if (diaDaSemana(a.data) === 6) expect(a.turnoId).toBe("d");
  });

  it("efetivo mínimo não gera aviso de cobertura em dia sem funcionamento", () => {
    const t = [umTurno("util", "08:00", "16:00", 0, 2, diasDeIndices([0, 1, 2, 3, 4]))];
    const [ini, fim] = mes(2027, 2);
    const r = gerarEscala(entrada(ini, fim, regras(), t, equipe(6)));
    expect(r.avisos.filter((a) => a.tipo === "coberturaInsuficiente")).toEqual([]);
  });

  it("turno sem nenhum dia não recebe ninguém nem causa erro", () => {
    const t = [umTurno("fantasma", "08:00", "16:00", 0, 2, 0)];
    const [ini, fim] = mes(2027, 2);
    const r = gerarEscala(entrada(ini, fim, regras(), t, equipe(3)));
    expect(r.alocacoes).toEqual([]);
  });
});

describe("EC 141/2026: 42h, 2 folgas e 40h", () => {
  const regras44 = regras({ cargaSemanalMaxMin: 44 * 60 });
  // Turno de 7h20: 6 jornadas = 44h (6x1); a partir de 16/12/2026 só cabem 5.
  const turnoDe440 = [umTurno("c", "08:00", "15:20")];

  it("a transição reduz para 42h e exige 2 folgas depois de 16/12/2026", async () => {
    const { etapasEc141 } = await import("..");
    const sim = new Simulacao(regras44, turnoDe440, equipe(6));
    sim.regime = etapasEc141("2026-10-16");
    for (const [a, m] of [[2026, 11], [2026, 12], [2027, 1]] as const) sim.gerar(a, m);
    sim.verificarTudo();
    const todas = sim.todas();
    const minutos = horasPorSemana(todas);
    const dias = diasPorSemana(todas);
    for (const [chave, d] of dias) {
      const inicio = chave.split("|")[1] ?? "";
      const fimSemana = somarDias(inicio, 6);
      const m = minutos.get(chave) ?? 0;
      if (fimSemana < "2026-12-16") {
        expect(d).toBeLessThanOrEqual(6);
        expect(m).toBeLessThanOrEqual(44 * 60);
      } else {
        // A semana da virada (14–20/12) já usa a regra nova inteira.
        expect(d).toBeLessThanOrEqual(5);
        expect(m).toBeLessThanOrEqual(42 * 60);
      }
    }
    // Semana cheia antes da virada: 6x1 (44h); depois: 5 jornadas (36h40).
    const antes = semanaContendo("2026-11-09", "segunda").inicio;
    const depois = semanaContendo("2027-01-11", "segunda").inicio;
    for (const f of sim.funcionarios) {
      expect(minutos.get(`${f.id}|${antes}`)).toBe(6 * 440);
      expect(minutos.get(`${f.id}|${depois}`)).toBe(5 * 440);
    }
  });

  it("a semana da virada (14–20/12/2026) usa 42h e 2 folgas", async () => {
    const { etapasEc141 } = await import("..");
    const e = entrada("2026-12-01", "2026-12-31", regras44, turnoDe440, equipe(6));
    e.regime = etapasEc141("2026-10-16");
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    const dias = diasPorSemana(r.alocacoes);
    for (const f of equipe(6)) expect(dias.get(`${f.id}|2026-12-14`)).toBeLessThanOrEqual(5);
  });

  it("depois de 16/12/2027 vale 40h", async () => {
    const { etapasEc141 } = await import("..");
    const sim = new Simulacao(regras44, tresTurnos(1), equipe(6));
    sim.regime = etapasEc141("2026-10-16");
    sim.gerar(2028, 2);
    sim.verificarTudo();
    for (const minutos of horasPorSemana(sim.todas()).values()) expect(minutos).toBeLessThanOrEqual(H40);
  });

  it("empregado isento do regime pode fazer 44h em 6 dias depois de 16/12/2026", async () => {
    const { etapasEc141 } = await import("..");
    const funcs = equipe(6).map((f, i) => (i === 0 ? { ...f, isentoRegime: true } : f));
    const e = entrada("2027-01-01", "2027-01-31", regras44, turnoDe440, funcs);
    e.regime = etapasEc141("2026-10-16");
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    const dias = diasPorSemana(r.alocacoes);
    const minutos = horasPorSemana(r.alocacoes);
    // Semana cheia de 04 a 10/01/2027.
    expect(dias.get("f01|2027-01-04")).toBe(6);
    expect(minutos.get("f01|2027-01-04")).toBe(6 * 440);
    expect(dias.get("f02|2027-01-04")).toBe(5);
    expect(minutos.get("f02|2027-01-04")).toBe(5 * 440);
  });

  it("folgas mínimas limitam os dias mesmo com horas sobrando", () => {
    // Turnos de 4h e 44h semanais: sem a regra caberiam 11 jornadas; com 2 folgas, no máximo 5.
    const [ini, fim] = mes(2027, 2);
    const e = entrada(ini, fim, regras({ cargaSemanalMaxMin: 44 * 60, folgasSemanaisMin: 2 }), [umTurno("m", "08:00", "12:00")], equipe(4));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    for (const d of diasPorSemana(r.alocacoes).values()) expect(d).toBe(5);
  });

  it("depois de 16/12/2026 ninguém fica com menos de 2 folgas por semana", async () => {
    const { etapasEc141 } = await import("..");
    const sim = new Simulacao(regras({ cargaSemanalMaxMin: 44 * 60, domingosSeguidosMax: 2 }), tresTurnos(1), equipe(9));
    sim.regime = etapasEc141("2026-10-16");
    for (const [a, m] of [[2026, 12], [2027, 1], [2027, 2]] as const) sim.gerar(a, m);
    sim.verificarTudo();
    for (const [chave, d] of diasPorSemana(sim.todas())) {
      if ((chave.split("|")[1] ?? "") >= "2026-12-14") expect(d).toBeLessThanOrEqual(5);
    }
  });
});

describe("rodízio de domingos", () => {
  it("respeita o máximo de domingos seguidos e roda entre a equipe", () => {
    const t = [umTurno("m", "06:00", "14:00", 0, 2)];
    const sim = new Simulacao(regras({ folgasSemanaisMin: 2, domingosSeguidosMax: 2 }), t, equipe(5));
    for (let m = 1; m <= 4; m++) sim.gerar(2027, m);
    sim.verificarTudo();
    const porPessoa = new Map<string, number>();
    for (const a of sim.todas()) if (diaDaSemana(a.data) === 6) porPessoa.set(a.funcionarioId, (porPessoa.get(a.funcionarioId) ?? 0) + 1);
    const valores = [...porPessoa.values()];
    expect(Math.max(...valores) - Math.min(...valores)).toBeLessThanOrEqual(3);
  });

  it("não deixa nenhum domingo vazio com equipe suficiente (máximo de 2 seguidos)", () => {
    // Comércio (Lei 10.101): no máximo 2 domingos seguidos. Sem rodízio escalonado a equipe
    // toda chegaria ao limite junta e o 3º domingo ficaria vazio.
    const t = tresTurnos(1).slice(0, 2).map((x, i) => (i === 0 ? { ...x, horario: horario("10:00", "16:15", 15) } : { ...x, horario: horario("15:45", "22:00", 15) }));
    const sim = new Simulacao(regras({ domingosSeguidosMax: 2, cargaSemanalMaxMin: 44 * 60 }), t, equipe(10));
    for (let m = 1; m <= 3; m++) sim.gerar(2027, m);
    sim.verificarTudo();
    const todas = sim.todas();
    const domingos = new Set(todas.map((a) => a.data).filter((d) => diaDaSemana(d) === 6));
    expect(domingos.size).toBeGreaterThanOrEqual(12);
    for (const dia of domingos) {
      for (const turno of t) {
        expect(todas.filter((a) => a.data === dia && a.turnoId === turno.id).length, `${dia} ${turno.nome}`).toBeGreaterThanOrEqual(2);
      }
    }
  });
});

describe("faixas de horário e preferência", () => {
  const faixasLoja = async () => (await import("./util")).turnosDaLoja();

  it("a loja intercala abertura e fechamento com a equipe dividida ao meio", async () => {
    const t = await faixasLoja();
    expect(t).toHaveLength(2);
    const [ini, fim] = mes(2027, 3);
    const e = entrada(ini, fim, regras(), t, equipe(10));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    const turnosPorPessoa = new Map<string, Set<string>>();
    for (const a of r.alocacoes) turnosPorPessoa.set(a.funcionarioId, (turnosPorPessoa.get(a.funcionarioId) ?? new Set()).add(a.turnoId));
    // Cada um fica na sua faixa o mês todo.
    expect([...turnosPorPessoa.values()].every((s) => s.size === 1)).toBe(true);
    expect([...turnosPorPessoa.values()].filter((s) => s.has(t[0]!.id))).toHaveLength(5);
    // Todo dia a loja tem gente na abertura e no fechamento.
    for (let d = ini; d <= fim; d = somarDias(d, 1)) {
      for (const turno of t) expect(r.alocacoes.some((a) => a.data === d && a.turnoId === turno.id)).toBe(true);
    }
  });

  it("a preferência de período é atendida quando há vaga", async () => {
    const t = await faixasLoja();
    // 6 preferem manhã, 3 preferem tarde e 1 não tem preferência: vagas de 5 e 5.
    const funcs = [
      ...Array.from({ length: 6 }, (_, i) => funcionario(`f${i + 1}`, { preferencia: "manha" })),
      ...Array.from({ length: 3 }, (_, i) => funcionario(`f${i + 7}`, { preferencia: "tarde" })),
      funcionario("f10"),
    ];
    const [ini, fim] = mes(2027, 3);
    const e = entrada(ini, fim, regras(), t, funcs);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    const turnoDe = (id: string): string | undefined => r.alocacoes.find((a) => a.funcionarioId === id)?.turnoId;
    const [manha, tarde] = [t[0]!.id, t[1]!.id];
    for (const id of ["f7", "f8", "f9"]) expect(turnoDe(id)).toBe(tarde);
    expect(["f1", "f2", "f3", "f4", "f5", "f6"].filter((id) => turnoDe(id) === manha)).toHaveLength(5);
    expect(turnoDe("f10")).toBe(tarde);
  });

  it("mantém a faixa do mês anterior quando ela combina com a preferência", async () => {
    const t = await faixasLoja();
    const sim = new Simulacao(regras(), t, equipe(10));
    sim.gerar(2027, 3);
    sim.gerar(2027, 4);
    const faixaDe = (mesChave: string, id: string): string | undefined => sim.meses.get(mesChave)?.find((a) => a.funcionarioId === id)?.turnoId;
    for (const f of sim.funcionarios) expect(faixaDe("2027-4", f.id)).toBe(faixaDe("2027-3", f.id));
  });
});

describe("saldo de horas, faltas e ausências justificadas", () => {
  // Loja 10h–22h com 6 pessoas; regras padrão (40h, 8h por dia, 1 folga): previsto de 36h (6 × 6h).
  async function lojaMarco(ajuste: (f: ReturnType<typeof funcionario>) => ReturnType<typeof funcionario>) {
    const { turnosDaLoja } = await import("./util");
    const funcs = equipe(6).map((f, i) => (i === 0 ? ajuste(f) : f));
    const [ini, fim] = mes(2027, 3);
    const e = entrada(ini, fim, regras(), turnosDaLoja(), funcs);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    return { e, r };
  }

  it("horas a mais do mês anterior viram uma folga a mais", async () => {
    const { r } = await lojaMarco((f) => ({ ...f, saldoAnteriorMin: 6 * 60 }));
    expect(minutosEntre(r, "f01", "2027-03-01", "2027-03-07")).toBe(30 * 60);
    expect(minutosEntre(r, "f01", "2027-03-08", "2027-03-14")).toBe(36 * 60);
    expect(minutosEntre(r, "f02", "2027-03-01", "2027-03-07")).toBe(36 * 60);
  });

  it("poucas horas a mais encurtam uma jornada", async () => {
    const { r } = await lojaMarco((f) => ({ ...f, saldoAnteriorMin: 2 * 60 }));
    expect(minutosEntre(r, "f01", "2027-03-01", "2027-03-07")).toBe(34 * 60);
    expect(minutosEntre(r, "f01", "2027-03-08", "2027-03-14")).toBe(36 * 60);
  });

  it("horas devidas são pagas esticando jornadas dentro do limite", async () => {
    const { r } = await lojaMarco((f) => ({ ...f, saldoAnteriorMin: -4 * 60 }));
    // 36h previstas + 4h devidas = 40h, o limite semanal; nenhuma jornada passa de 8h.
    expect(minutosEntre(r, "f01", "2027-03-01", "2027-03-07")).toBe(40 * 60);
    expect(minutosEntre(r, "f01", "2027-03-08", "2027-03-14")).toBe(36 * 60);
    const esticadas = r.alocacoes.filter((a) => a.funcionarioId === "f01" && minutosDaAlocacao(a) > 360);
    expect(esticadas.length).toBeGreaterThan(0);
    for (const a of esticadas) {
      expect(minutosDaAlocacao(a)).toBeLessThanOrEqual(8 * 60);
      // Acima de 6h, o intervalo passa a 1h e o horário fica dentro das 10h às 22h.
      expect(a.horario.intervaloMin).toBe(60);
      expect(a.horario.inicioMin).toBeGreaterThanOrEqual(h("10:00"));
      expect(a.horario.fimMin).toBeLessThanOrEqual(h("22:00"));
    }
  });

  it("a falta não é escalada e as horas são pagas na mesma semana quando cabe", async () => {
    const faltas = ["2027-03-02", "2027-03-03"];
    const { r } = await lojaMarco((f) => ({ ...f, faltas: new Set(faltas) }));
    expect(r.alocacoes.every((a) => !(a.funcionarioId === "f01" && faltas.includes(a.data)))).toBe(true);
    // 5 dias de 36h previstas: as jornadas esticam e a semana fecha nas 36h, sem passar de 8h por dia.
    expect(minutosEntre(r, "f01", "2027-03-01", "2027-03-07")).toBe(36 * 60);
    expect(minutosEntre(r, "f01", "2027-03-08", "2027-03-14")).toBe(36 * 60);
    const semana1 = r.alocacoes.filter((a) => a.funcionarioId === "f01" && a.data <= "2027-03-07");
    expect(semana1).toHaveLength(5);
    expect(semana1.every((a) => minutosDaAlocacao(a) <= 8 * 60)).toBe(true);
  });

  it("a ausência justificada em dia de folga vira a folga: a pessoa trabalha os outros 6 dias", async () => {
    const { r } = await lojaMarco((f) => ({ ...f, indisponivel: new Set(["2027-03-03"]) }));
    expect(r.alocacoes.some((a) => a.funcionarioId === "f01" && a.data === "2027-03-03")).toBe(false);
    // A ausência é a folga da semana (1 folga): as outras 6 jornadas (36h) são previstas e nenhuma jornada esticada.
    expect(minutosEntre(r, "f01", "2027-03-01", "2027-03-07")).toBe(36 * 60);
    expect(r.alocacoes.filter((a) => a.funcionarioId === "f01").every((a) => minutosDaAlocacao(a) === 360)).toBe(true);
  });

  it("ausência de sábado e domingo abona só o que passa da folga: a pessoa completa a carga nos outros 5 dias", async () => {
    const { r } = await lojaMarco((f) => ({ ...f, indisponivel: new Set(["2027-03-06", "2027-03-07"]) }));
    // Antes o previsto caía para 3 jornadas (18h); agora a carga se completa com 5 dias (30h).
    expect(minutosEntre(r, "f01", "2027-03-01", "2027-03-05")).toBe(30 * 60);
    expect(r.alocacoes.filter((a) => a.funcionarioId === "f01" && a.data >= "2027-03-01" && a.data <= "2027-03-07")).toHaveLength(5);
  });

  it("faltas geram dívida compensada no mês seguinte, dentro das regras, e o acumulado volta a zero", async () => {
    const { turnosDaLoja } = await import("./util");
    // 4 faltas na última semana de fevereiro (23 a 26/02): a semana fecha devendo horas, que as
    // jornadas esticadas de março pagam sem passar de 8h por dia nem de 40h por semana.
    const faltas = new Set(["2027-02-23", "2027-02-24", "2027-02-25", "2027-02-26"]);
    const funcs = equipe(6).map((f, i) => (i === 0 ? { ...f, faltas } : f));
    const sim = new Simulacao(regras(), turnosDaLoja(), funcs);
    sim.gerar(2027, 2);
    sim.gerar(2027, 3);
    sim.verificarTudo();
    const todas = sim.todas();
    const semanas = semanasCobrindo("2027-02-01", "2027-03-28", "segunda");
    const saldos = semanas.map((semana) => resumoSemanal({ semana, funcionarios: sim.funcionarios, turnos: sim.turnos, regras: sim.regras, regime: [], alocacoes: todas }));
    const saldoDe = (id: string, ate: number): number => saldos.slice(0, ate).reduce((s, linhas) => s + (linhas.find((l) => l.funcionarioId === id)?.saldoMin ?? 0), 0);
    // Ao fechar a semana das faltas a pessoa está devendo; ao fim da compensação o acumulado é zero.
    expect(saldoDe("f01", 4)).toBeLessThan(0);
    expect(saldoDe("f01", semanas.length)).toBe(0);
    expect(saldoDe("f02", semanas.length)).toBe(0);
    for (const a of todas.filter((x) => x.funcionarioId === "f01")) expect(minutosDaAlocacao(a)).toBeLessThanOrEqual(8 * 60);
  });

  it("o saldo anterior é compensado em março sem violar regras (acumulado zero quando viável)", async () => {
    const { turnosDaLoja } = await import("./util");
    const funcs = equipe(6).map((f, i) => (i === 0 ? { ...f, saldoAnteriorMin: -3 * 60 } : f));
    const sim = new Simulacao(regras(), turnosDaLoja(), funcs);
    sim.gerar(2027, 3);
    sim.gerar(2027, 4);
    sim.verificarTudo();
    // Semanas fechadas de 01/03 a 25/04 (8 semanas): previsto de 36h cada; devia 3h → fez 8×36h + 3h.
    const todas = sim.todas();
    expect(minutosEntre({ alocacoes: todas }, "f01", "2027-03-01", "2027-04-25")).toBe(8 * 36 * 60 + 3 * 60);
    expect(minutosEntre({ alocacoes: todas }, "f02", "2027-03-01", "2027-04-25")).toBe(8 * 36 * 60);
  });
});

function minutosEntre(r: { alocacoes: readonly Alocacao[] }, id: string, de: string, ate: string): number {
  return r.alocacoes.filter((a) => a.funcionarioId === id && de <= a.data && a.data <= ate).reduce((s, a) => s + minutosDaAlocacao(a), 0);
}

describe("cobertura por função", () => {
  async function cafeteria(): Promise<{ t: Awaited<ReturnType<typeof import("./util").turnosDaLoja>> }> {
    const { turnosDaLoja } = await import("./util");
    return { t: turnosDaLoja() };
  }

  it("a cafeteria tem 1 atendente e 1 cozinheiro em todo turno todo dia (atravessando a EC 141)", async () => {
    const { etapasEc141 } = await import("..");
    const { t } = await cafeteria();
    // 6 atendentes e 4 cozinheiros, todos preferindo a manhã: a preferência sozinha deixaria a tarde sem cozinheiro.
    const funcs = [
      ...Array.from({ length: 6 }, (_, i) => funcionario(`a${i + 1}`, { funcao: "atendente", preferencia: "manha" })),
      ...Array.from({ length: 4 }, (_, i) => funcionario(`c${i + 1}`, { funcao: "cozinheiro", preferencia: "manha" })),
    ];
    const { minimos } = await import("./util");
    const sim = new Simulacao(regras({ cargaSemanalMaxMin: 44 * 60, domingosSeguidosMax: 2 }), t, funcs);
    sim.minimoPorFuncao = minimos([["atendente", 1], ["cozinheiro", 1]]);
    sim.regime = etapasEc141("2026-10-16");
    const avisos: Aviso[] = [];
    for (const [a, m] of [[2026, 11], [2026, 12], [2027, 1], [2027, 2]] as const) avisos.push(...sim.gerar(a, m)[1].avisos);
    sim.verificarTudo();
    expect(avisos.filter((a) => a.tipo === "funcaoDescoberta")).toEqual([]);
    const todas = sim.todas();
    for (let d = "2026-11-01"; d <= "2027-02-28"; d = somarDias(d, 1)) {
      for (const turno of t) {
        for (const prefixo of ["a", "c"]) {
          expect(
            todas.some((x) => x.data === d && x.turnoId === turno.id && x.funcionarioId.startsWith(prefixo)),
            `${d}: ${turno.nome} sem ${prefixo}`,
          ).toBe(true);
        }
      }
    }
  });

  it("função com gente de menos gera aviso sem quebrar regra", async () => {
    const { t } = await cafeteria();
    const { minimos } = await import("./util");
    const funcs = [...Array.from({ length: 6 }, (_, i) => funcionario(`a${i + 1}`, { funcao: "atendente" })), funcionario("c1", { funcao: "cozinheiro" })];
    const sim = new Simulacao(regras(), t, funcs);
    sim.minimoPorFuncao = minimos([["cozinheiro", 1]]);
    const [, r] = sim.gerar(2027, 3);
    sim.verificarTudo();
    const descobertas = r.avisos.filter((a) => a.tipo === "funcaoDescoberta");
    expect(descobertas.length).toBeGreaterThan(0);
    expect(descobertas.every((a) => a.mensagem.startsWith("cozinheiro: turno"))).toBe(true);
    // Um aviso por semana e turno, com os dias juntos.
    expect(descobertas.length).toBeLessThanOrEqual(2 * 6);
  });

  it("cargos escritos de jeitos diferentes contam como a mesma função", async () => {
    const { chaveFuncao } = await import("..");
    const { t } = await cafeteria();
    const { minimos } = await import("./util");
    const cargos = ["Cozinheiro (a)", "COZINHEIRO", "cozinheiro", "Cozinheiro(a)"];
    const funcs = [
      ...cargos.map((c, i) => funcionario(`c${i + 1}`, { funcao: c })),
      ...Array.from({ length: 5 }, (_, i) => funcionario(`a${i + 1}`, { funcao: "Atendente" })),
    ];
    const sim = new Simulacao(regras(), t, funcs);
    sim.minimoPorFuncao = minimos([[chaveFuncao("Cozinheiro"), 1]]);
    const [, r] = sim.gerar(2027, 3);
    sim.verificarTudo();
    expect(r.avisos.filter((a) => a.tipo === "funcaoDescoberta")).toEqual([]);
    for (let d = "2027-03-01"; d <= "2027-03-31"; d = somarDias(d, 1)) {
      for (const turno of t) expect(sim.todas().some((x) => x.data === d && x.turnoId === turno.id && x.funcionarioId.startsWith("c"))).toBe(true);
    }
  });
});

describe("reequilibrar o resto do mês com jornadas travadas", () => {
  it("respeita o ajuste manual e tira outro dia da mesma semana", async () => {
    const { turnosDaLoja } = await import("./util");
    const { encontrarViolacoes } = await import("..");
    const [ini, fim] = mes(2027, 3);
    const e = entrada(ini, fim, regras(), turnosDaLoja(), equipe(6));
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    const semana: [string, string] = ["2027-03-15", "2027-03-21"];
    const trabalhados = new Set(r.alocacoes.filter((a) => a.funcionarioId === "f01" && semana[0] <= a.data && a.data <= semana[1]).map((a) => a.data));
    let folga: string = semana[0];
    while (trabalhados.has(folga)) folga = somarDias(folga, 1);
    const modelo = r.alocacoes.find((a) => a.funcionarioId === "f01")!;
    const travada: Alocacao = { ...modelo, data: folga };

    const inicio = "2027-03-10";
    const e2 = { ...e, inicio, alocacoesFixas: r.alocacoes.filter((a) => a.data < inicio), alocacoesTravadas: [travada], datasPlanejadas: new Set<string>() };
    for (let d = ini; d < inicio; d = somarDias(d, 1)) e2.datasPlanejadas.add(d);
    const r2 = gerarEscala(e2);
    expect(r2.alocacoes.every((a) => a.data >= inicio)).toBe(true);
    expect(r2.alocacoes.some((a) => a.funcionarioId === "f01" && a.data === folga)).toBe(false);

    const todas = [...e2.alocacoesFixas, travada, ...r2.alocacoes];
    const completo = { ...e2, inicio: ini, alocacoesFixas: [], alocacoesTravadas: [] };
    expect(encontrarViolacoes(completo, todas)).toEqual([]);
    expect(minutosEntre({ alocacoes: todas }, "f01", semana[0], semana[1])).toBe(36 * 60);

    // Jornada travada fora do período é recusada.
    expect(() => gerarEscala({ ...e2, alocacoesTravadas: [{ ...travada, data: "2027-03-02" }] })).toThrow(ErroMotor);
  });
});

describe("tipos de aviso", () => {
  it("reconhece os códigos estáveis", () => {
    expect(ehTipoAviso("funcaoDescoberta")).toBe(true);
    expect(ehTipoAviso("outra")).toBe(false);
  });
});
