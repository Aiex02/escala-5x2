// Hora não trabalhada: o almoço/intervalo da própria pessoa vale no lugar do intervalo da loja
// e é descontado das horas do dia dela, na escala, na carga semanal e no dimensionamento.

import { describe, expect, it } from "vitest";
import {
  dimensionar,
  gerarEscala,
  horarioDoFuncionario,
  intervaloDoFuncionario,
  minutosDaAlocacao,
  minutosDoTurnoPara,
  resumoSemanal,
  semanaContendo,
  temHoraNaoTrabalhada,
} from "..";
import { assertSemViolacoes, entrada, funcionario, horario, mes, regras, turnosDaLoja, umTurno } from "./util";

describe("intervalo que vale para a pessoa", () => {
  it("sem hora não trabalhada, segue o intervalo do turno", () => {
    const f = funcionario("a");
    expect(temHoraNaoTrabalhada(f)).toBe(false);
    expect(intervaloDoFuncionario(f, 15)).toBe(15);
    expect(horarioDoFuncionario(f, horario("10:00", "16:15", 15))).toMatchObject({ intervaloMin: 15 });
  });

  it("com hora não trabalhada, ela substitui o intervalo da loja", () => {
    const f = funcionario("a", { horasNaoTrabalhadasMin: 60 });
    expect(temHoraNaoTrabalhada(f)).toBe(true);
    expect(intervaloDoFuncionario(f, 15)).toBe(60);
    expect(horarioDoFuncionario(f, horario("10:00", "16:15", 15))).toMatchObject({
      inicioMin: 10 * 60,
      fimMin: 16 * 60 + 15,
      intervaloMin: 60,
    });
  });

  it("zero é um valor informado: a pessoa não tem intervalo nenhum", () => {
    const f = funcionario("a", { horasNaoTrabalhadasMin: 0 });
    expect(temHoraNaoTrabalhada(f)).toBe(true);
    expect(intervaloDoFuncionario(f, 60)).toBe(0);
    // Entrada e saída não mudam: o que muda são os minutos trabalhados no dia.
    expect(minutosDoTurnoPara(f, { horario: horario("08:00", "17:00", 60) })).toBe(9 * 60);
  });

  it("desconta as horas do dia: o mesmo turno rende menos para quem tem almoço maior", () => {
    const turno = { horario: horario("10:00", "16:15", 15) };
    expect(minutosDoTurnoPara(funcionario("a"), turno)).toBe(6 * 60);
    expect(minutosDoTurnoPara(funcionario("b", { horasNaoTrabalhadasMin: 60 }), turno)).toBe(5 * 60 + 15);
    expect(minutosDoTurnoPara(funcionario("c", { horasNaoTrabalhadasMin: 30 }), turno)).toBe(5 * 60 + 45);
  });

  it("almoço que não cabe na jornada deixa o turno sem servir para a pessoa", () => {
    const turno = { horario: horario("10:00", "16:15", 15) };
    expect(horarioDoFuncionario(funcionario("a", { horasNaoTrabalhadasMin: 400 }), turno.horario)).toBeNull();
    expect(minutosDoTurnoPara(funcionario("a", { horasNaoTrabalhadasMin: 400 }), turno)).toBe(0);
  });
});

describe("escala gerada com hora não trabalhada", () => {
  it("as jornadas da pessoa saem com o almoço dela, e não com o da loja", () => {
    const turnos = turnosDaLoja(0);
    const [ini, fim] = mes(2027, 3);
    const funcs = [funcionario("padrao"), funcionario("almoco", { horasNaoTrabalhadasMin: 60 })];
    const e = entrada(ini, fim, regras(), turnos, funcs);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);

    const normais = (id: string) => r.alocacoes.filter((a) => a.funcionarioId === id && (a.origem ?? "normal") === "normal");
    expect(normais("padrao").length).toBeGreaterThan(0);
    expect(normais("almoco").length).toBeGreaterThan(0);
    // Quem segue a loja tem 15 min de intervalo; quem tem almoço próprio, os 60 min dela.
    for (const a of normais("padrao")) expect(a.horario.intervaloMin).toBe(15);
    for (const a of normais("almoco")) expect(a.horario.intervaloMin).toBe(60);
    // E as horas do dia caem junto: 6h contra 5h15.
    for (const a of normais("padrao")) expect(minutosDaAlocacao(a)).toBe(6 * 60);
    for (const a of normais("almoco")) expect(minutosDaAlocacao(a)).toBe(5 * 60 + 15);
  });

  it("a carga semanal e o saldo usam a jornada da própria pessoa", () => {
    const turnos = turnosDaLoja(0);
    const [ini, fim] = mes(2027, 3);
    const funcs = [funcionario("padrao"), funcionario("almoco", { horasNaoTrabalhadasMin: 60 })];
    const e = entrada(ini, fim, regras(), turnos, funcs);
    const r = gerarEscala(e);
    const semana = semanaContendo("2027-03-08", "segunda");
    const linhas = resumoSemanal({
      semana,
      funcionarios: e.funcionarios,
      turnos,
      regras: e.regras,
      regime: [],
      alocacoes: r.alocacoes,
    });

    const padrao = linhas.find((l) => l.funcionarioId === "padrao");
    const almoco = linhas.find((l) => l.funcionarioId === "almoco");
    // 6 jornadas na semana (1 folga): 6×6h para quem segue a loja, 6×5h15 para quem tem almoço próprio.
    expect(padrao).toMatchObject({ feitoMin: 36 * 60, previstoMin: 36 * 60, saldoMin: 0 });
    expect(almoco).toMatchObject({ feitoMin: 6 * (5 * 60 + 15), previstoMin: 6 * (5 * 60 + 15), saldoMin: 0 });
    // O previsto dela não é o da equipe: é menor, porque o dia dela rende menos.
    expect(almoco?.previstoMin).toBeLessThan(padrao?.previstoMin ?? 0);
  });

  it("o previsto da semana desconta o almoço mesmo sem nenhuma jornada feita", () => {
    const turnos = turnosDaLoja(0);
    const semana = semanaContendo("2027-03-08", "segunda");
    const funcs = [funcionario("padrao"), funcionario("almoco", { horasNaoTrabalhadasMin: 60 })];
    const [padrao, almoco] = resumoSemanal({ semana, funcionarios: funcs, turnos, regras: regras(), regime: [], alocacoes: [] });
    expect(padrao?.previstoMin).toBe(36 * 60);
    expect(almoco?.previstoMin).toBe(6 * (5 * 60 + 15));
  });

  it("a compensação de saldo não mexe no almoço da pessoa", () => {
    // Turno único 07:00–16:00 (9h de permanência). Com 1h30 de almoço próprio a jornada dela
    // é de 7h30 e cabe no máximo diário; a semana fecha com ajuste de horário (compensação).
    const turnos = [umTurno("t1", "07:00", "16:00", 60, 0)];
    const [ini, fim] = mes(2027, 3);
    // Com 1h de saldo positivo vindo de antes, o motor encurta uma jornada para zerar o saldo.
    const e = entrada(ini, fim, regras(), turnos, [funcionario("almoco", { horasNaoTrabalhadasMin: 90, saldoAnteriorMin: 60 })]);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    // Há compensação de verdade no mês (senão o teste não provaria nada).
    const compensadas = r.alocacoes.filter((a) => a.origem === "compensacao");
    expect(compensadas).toHaveLength(1);
    // A jornada encurtou 1h (7h30 → 6h30), mas o almoço dela continua de 1h30.
    expect(minutosDaAlocacao(compensadas[0]!)).toBe(6 * 60 + 30);
    for (const a of r.alocacoes) expect(a.horario.intervaloMin).toBe(90);
  });

  it("quem não tem turno possível por causa do almoço recebe aviso e não é escalado", () => {
    const turnos = turnosDaLoja(0);
    const [ini, fim] = mes(2027, 3);
    const e = entrada(ini, fim, regras(), turnos, [funcionario("impossivel", { horasNaoTrabalhadasMin: 11 * 60 })]);
    const r = gerarEscala(e);
    expect(r.alocacoes.filter((a) => a.funcionarioId === "impossivel")).toEqual([]);
    expect(r.avisos.some((a) => a.tipo === "funcionarioSemTurno" && a.funcionarioId === "impossivel")).toBe(true);
  });
});

describe("dimensionamento com hora não trabalhada", () => {
  it("a capacidade da pessoa é contada com a jornada dela", () => {
    // Turno 08:00–18:00 com 1h de intervalo: 9h de jornada para a equipe. No teto de 40h
    // semanais cabem 4 jornadas dessas.
    const turnos = [umTurno("t1", "08:00", "18:00", 60, 1)];
    const base = {
      turnos,
      minimoPorFuncao: new Map(),
      regras: regras({ jornadaDiariaMaxMin: 9 * 60 }),
      regime: [],
      dataReferencia: "2027-03-08",
      margemAusenciasPct: 0,
    };
    const comum = dimensionar({ ...base, funcionarios: [{ id: "a", ativo: true }] });
    // Com 3h de almoço próprio a jornada dela é de 7h: cabem 5 na mesma semana de 40h.
    const comAlmoco = dimensionar({ ...base, funcionarios: [{ id: "a", ativo: true, horasNaoTrabalhadasMin: 180 }] });
    expect(comum.linhas[0]?.capacidadeTurnosSemana).toBe(4);
    expect(comAlmoco.linhas[0]?.capacidadeTurnosSemana).toBe(5);
  });
});
