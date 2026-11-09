import { describe, expect, it } from "vitest";
import { type Alocacao, funcoesDescobertas, gerarEscala, pessoasPorTurnoDia, resumoSemanal, semanaContendo } from "..";
import { entrada, equipe, funcionario, horario, mes, minimos, regras, turnosDaLoja } from "./util";

describe("resumo semanal", () => {
  it("horas feitas × previstas e saldo por funcionário", () => {
    const turnos = turnosDaLoja();
    const [ini, fim] = mes(2027, 3);
    const e = entrada(ini, fim, regras(), turnos, equipe(6));
    const r = gerarEscala(e);
    const semana = semanaContendo("2027-03-08", "segunda");
    const linhas = resumoSemanal({ semana, funcionarios: e.funcionarios, turnos, regras: e.regras, regime: [], alocacoes: r.alocacoes });
    expect(linhas).toHaveLength(6);
    for (const l of linhas) {
      expect(l).toMatchObject({ feitoMin: 36 * 60, previstoMin: 36 * 60, limiteMin: 40 * 60, saldoMin: 0 });
    }
  });

  it("ausência justificada abona a jornada; falta não", () => {
    const turnos = turnosDaLoja();
    const semana = semanaContendo("2027-03-08", "segunda");
    const dia = (d: string, id: string): Alocacao => ({ funcionarioId: id, turnoId: turnos[0]?.id ?? "", data: d, horario: turnos[0]?.horario ?? horario("10:00", "16:15", 15) });
    // "a" falta a quarta e o domingo (2 ausências): sobram 5 dias, previsto de 30h. "b" falta na quarta sem justificar.
    const funcs = [funcionario("a", { indisponivel: new Set(["2027-03-10", "2027-03-14"]) }), funcionario("b", { faltas: new Set(["2027-03-10"]) })];
    const alocs = ["2027-03-08", "2027-03-09", "2027-03-11", "2027-03-12", "2027-03-13"].flatMap((d) => [dia(d, "a"), dia(d, "b")]);
    const [a, b] = resumoSemanal({ semana, funcionarios: funcs, turnos, regras: regras(), regime: [], alocacoes: alocs });
    expect(a).toMatchObject({ feitoMin: 30 * 60, previstoMin: 30 * 60, saldoMin: 0 });
    expect(b).toMatchObject({ feitoMin: 30 * 60, previstoMin: 36 * 60, saldoMin: -6 * 60 });
  });

  it("ausência em dia de folga não tira dias de trabalho: a folga passa a ser a ausência", () => {
    const turnos = turnosDaLoja();
    const semana = semanaContendo("2027-03-08", "segunda");
    // Uma ausência com 1 folga por semana: a ausência é a folga e a pessoa deve as outras 6 jornadas (36h).
    const [um] = resumoSemanal({ semana, funcionarios: [funcionario("a", { indisponivel: new Set(["2027-03-10"]) })], turnos, regras: regras(), regime: [], alocacoes: [] });
    expect(um?.previstoMin).toBe(36 * 60);
    // Indisponível no sábado e no domingo: antes ficava com 3 jornadas (18h); agora são 5 (30h).
    const [fds] = resumoSemanal({ semana, funcionarios: [funcionario("b", { indisponivel: new Set(["2027-03-13", "2027-03-14"]) })], turnos, regras: regras(), regime: [], alocacoes: [] });
    expect(fds?.previstoMin).toBe(30 * 60);
  });

  it("usa o previsto gravado da semana fechada quando informado", () => {
    const turnos = turnosDaLoja();
    const semana = semanaContendo("2027-03-08", "segunda");
    const [l] = resumoSemanal({ semana, funcionarios: [funcionario("a")], turnos, regras: regras(), regime: [], alocacoes: [], previstosGravados: new Map([["a", 1234]]) });
    expect(l).toMatchObject({ feitoMin: 0, previstoMin: 1234, saldoMin: -1234 });
  });

  it("o limite considera o regime da EC 141 e a isenção", async () => {
    const { etapasEc141 } = await import("..");
    const turnos = turnosDaLoja();
    const semana = semanaContendo("2027-01-05", "segunda");
    const funcs = [funcionario("a"), funcionario("b", { isentoRegime: true })];
    const [a, b] = resumoSemanal({ semana, funcionarios: funcs, turnos, regras: regras({ cargaSemanalMaxMin: 44 * 60 }), regime: etapasEc141(), alocacoes: [] });
    expect(a?.limiteMin).toBe(42 * 60);
    expect(b?.limiteMin).toBe(44 * 60);
  });
});

describe("pessoas por turno e funções descobertas", () => {
  it("conta pessoas por data e turno", () => {
    const turnos = turnosDaLoja();
    const [ini, fim] = mes(2027, 3);
    const r = gerarEscala(entrada(ini, fim, regras(), turnos, equipe(10)));
    const mapa = pessoasPorTurnoDia(r.alocacoes);
    for (const t of turnos) expect(mapa.get("2027-03-10")?.get(t.id)).toBeGreaterThanOrEqual(1);
    const total = [...mapa.values()].flatMap((m) => [...m.values()]).reduce((s, n) => s + n, 0);
    expect(total).toBe(r.alocacoes.length);
  });

  it("aponta o turno e o dia em que falta uma função", () => {
    const turnos = turnosDaLoja();
    const funcs = [funcionario("a", { funcao: "atendente" }), funcionario("c", { funcao: "cozinheiro" })];
    const mk = (id: string, d: string, t: number): Alocacao => ({ funcionarioId: id, turnoId: turnos[t]?.id ?? "", data: d, horario: turnos[t]?.horario ?? horario("10:00", "16:15", 15) });
    const alocs = [mk("a", "2027-03-01", 0), mk("c", "2027-03-01", 0), mk("a", "2027-03-01", 1)];
    const lista = funcoesDescobertas({ datas: ["2027-03-01"], alocacoes: alocs, funcionarios: funcs, turnos, minimoPorFuncao: minimos([["atendente", 1], ["cozinheiro", 1]]) });
    expect(lista).toEqual([{ data: "2027-03-01", turnoId: turnos[1]?.id, funcao: "cozinheiro", nome: "cozinheiro", presentes: 0, minimo: 1 }]);
  });
});
