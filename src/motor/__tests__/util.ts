// Utilitários compartilhados pelos testes do motor.

import { expect } from "vitest";
import {
  type Alocacao,
  analisarHora,
  type DataISO,
  datasDoIntervalo,
  type EntradaPlanejamento,
  type EtapaRegime,
  type FuncaoMinima,
  type FuncionarioPlano,
  gerarEscala,
  gerarTurnos,
  type InicioSemana,
  criarHorario,
  encontrarViolacoes,
  type JanelaDia,
  minutosDaAlocacao,
  type Periodo,
  REGRAS_PADRAO,
  type RegrasCarga,
  resumoSemanal,
  semanasCobrindo,
  type ResultadoPlanejamento,
  semanaContendo,
  TODOS_OS_DIAS,
  type Turno,
  ultimoDiaDoMes,
  primeiroDiaDoMes,
  diaDaSemana,
  somarDias,
} from "..";

export const h = (texto: string): number => analisarHora(texto);

export const horario = (inicio: string, fim: string, intervalo = 0) => criarHorario(h(inicio), h(fim), intervalo);

/** Manhã 06–14, Tarde 14–22 e Noite 22–06, todos os dias. */
export function tresTurnos(efetivoMinimo = 0): Turno[] {
  return [
    { id: "manha", nome: "Manhã", horario: horario("06:00", "14:00"), efetivoMinimo, ordem: 0, dias: TODOS_OS_DIAS },
    { id: "tarde", nome: "Tarde", horario: horario("14:00", "22:00"), efetivoMinimo, ordem: 1, dias: TODOS_OS_DIAS },
    { id: "noite", nome: "Noite", horario: horario("22:00", "06:00"), efetivoMinimo, ordem: 2, dias: TODOS_OS_DIAS },
  ];
}

/** Turnos de uma loja de shopping (10–22, jornada de 6h com 15 min): Manhã 10:00–16:15 e Tarde 15:45–22:00. */
export function turnosDaLoja(efetivoMinimo = 1): Turno[] {
  const janelas: JanelaDia[] = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abreMin: h("10:00"), fechaMin: h("22:00") }));
  return gerarTurnos(janelas, 6 * 60, 15).map((g, i) => ({
    id: `t${i + 1}`,
    nome: g.nome,
    horario: g.horario,
    efetivoMinimo,
    ordem: i,
    dias: g.dias,
  }));
}

export function umTurno(id: string, inicio: string, fim: string, intervalo = 0, efetivoMinimo = 0, dias = TODOS_OS_DIAS): Turno {
  return { id, nome: id, horario: horario(inicio, fim, intervalo), efetivoMinimo, ordem: 0, dias };
}

export function funcionario(id: string, extra: Partial<FuncionarioPlano> = {}): FuncionarioPlano {
  return {
    id,
    nome: `Funcionário ${id}`,
    indisponivel: new Set<DataISO>(),
    faltas: new Set<DataISO>(),
    saldoAnteriorMin: 0,
    isentoRegime: false,
    ...extra,
  };
}

/** `n` funcionários com ids f01, f02, ... */
export function equipe(n: number, extra: Partial<FuncionarioPlano> = {}): FuncionarioPlano[] {
  return Array.from({ length: n }, (_, i) => funcionario(`f${String(i + 1).padStart(2, "0")}`, extra));
}

export function entrada(
  inicio: DataISO,
  fim: DataISO,
  regras: RegrasCarga,
  turnos: Turno[],
  funcionarios: FuncionarioPlano[],
): EntradaPlanejamento {
  return {
    inicio,
    fim,
    regras,
    turnos,
    funcionarios,
    alocacoesFixas: [],
    alocacoesTravadas: [],
    datasPlanejadas: new Set<DataISO>(),
    regime: [],
    minimoPorFuncao: new Map<string, FuncaoMinima>(),
  };
}

export function mes(ano: number, m: number): [DataISO, DataISO] {
  return [primeiroDiaDoMes(ano, m), ultimoDiaDoMes(ano, m)];
}

export const regras = (parcial: Partial<RegrasCarga> = {}): RegrasCarga => ({ ...REGRAS_PADRAO, ...parcial });

export function minimos(funcoes: Array<[string, number]>): Map<string, FuncaoMinima> {
  return new Map(funcoes.map(([f, m]) => [f, { nome: f, minimo: m }]));
}

export function comPreferencia(id: string, preferencia: Periodo | undefined, extra: Partial<FuncionarioPlano> = {}): FuncionarioPlano {
  return funcionario(id, { preferencia, ...extra });
}

/** Minutos por (funcionário, início da semana). */
export function horasPorSemana(alocacoes: readonly Alocacao[], inicioSemana: InicioSemana = "segunda"): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of alocacoes) {
    const chave = `${a.funcionarioId}|${semanaContendo(a.data, inicioSemana).inicio}`;
    m.set(chave, (m.get(chave) ?? 0) + minutosDaAlocacao(a));
  }
  return m;
}

/** Dias trabalhados por (funcionário, início da semana). */
export function diasPorSemana(alocacoes: readonly Alocacao[], inicioSemana: InicioSemana = "segunda"): Map<string, number> {
  const m = new Map<string, number>();
  for (const a of alocacoes) {
    const chave = `${a.funcionarioId}|${semanaContendo(a.data, inicioSemana).inicio}`;
    m.set(chave, (m.get(chave) ?? 0) + 1);
  }
  return m;
}

export function minutosEntre(r: { alocacoes: readonly Alocacao[] }, funcionarioId: string, de: DataISO, ate: DataISO): number {
  return r.alocacoes.filter((a) => a.funcionarioId === funcionarioId && de <= a.data && a.data <= ate).reduce((s, a) => s + minutosDaAlocacao(a), 0);
}

export function assertSemViolacoes(e: EntradaPlanejamento, r: { alocacoes: readonly Alocacao[] }): void {
  const v = encontrarViolacoes(e, r.alocacoes).map((x) => x.mensagem);
  expect(v).toEqual([]);
}

/**
 * Simula o uso do app: meses gerados um a um, cada geração recebendo como fixas as
 * alocações dos meses vizinhos já gerados.
 */
export class Simulacao {
  regime: EtapaRegime[] = [];
  minimoPorFuncao = new Map<string, FuncaoMinima>();
  readonly meses = new Map<string, Alocacao[]>();
  /** Previsto das semanas fechadas devolvido pelo motor (`funcionario|inicioDaSemana`), como o app o grava. */
  readonly previstos = new Map<string, number>();

  constructor(
    readonly regras: RegrasCarga,
    readonly turnos: Turno[],
    readonly funcionarios: FuncionarioPlano[],
  ) {}

  entradaPara(ano: number, m: number): EntradaPlanejamento {
    const [ini, fim] = mes(ano, m);
    const janelaIni = somarDias(ini, -35);
    const janelaFim = somarDias(fim, 35);
    const funcionarios = this.funcionarios.map((f) => ({ ...f, saldoAnteriorMin: f.saldoAnteriorMin + this.saldoAte(f, ini, `${ano}-${m}`) }));
    const e = entrada(ini, fim, this.regras, this.turnos, funcionarios);
    e.regime = this.regime;
    e.minimoPorFuncao = this.minimoPorFuncao;
    for (const [chave, alocs] of this.meses) {
      if (chave === `${ano}-${m}`) continue;
      const [a, mm] = chave.split("-").map(Number) as [number, number];
      const [mi, mf] = mes(a, mm);
      for (const d of datasDoIntervalo(mi, mf)) {
        if (d >= janelaIni && d <= janelaFim) e.datasPlanejadas.add(d);
      }
      e.alocacoesFixas.push(...alocs.filter((x) => x.data >= janelaIni && x.data <= janelaFim));
    }
    return e;
  }

  /**
   * Saldo (feito − previsto) das semanas fechadas antes da semana de `inicio`: todos os dias
   * dela em meses já gerados (menos o mês `exceto`, que está sendo gerado).
   */
  saldoAte(f: FuncionarioPlano, inicio: DataISO, exceto: string): number {
    const geradas = new Set<DataISO>();
    for (const [chave, alocs] of this.meses) {
      if (chave === exceto) continue;
      const [a, mm] = chave.split("-").map(Number) as [number, number];
      const [mi, mf] = mes(a, mm);
      for (const d of datasDoIntervalo(mi, mf)) geradas.add(d);
      void alocs;
    }
    const limite = semanaContendo(inicio, this.regras.inicioSemana).inicio;
    const todas = [...this.meses.entries()].filter(([c]) => c !== exceto).flatMap(([, alocs]) => alocs);
    const primeiro = [...geradas].sort()[0];
    if (primeiro === undefined) return 0;
    let saldo = 0;
    for (const semana of semanasCobrindo(primeiro, somarDias(limite, -1), this.regras.inicioSemana)) {
      if (!semana.dias().every((d) => geradas.has(d))) continue;
      const gravado = this.previstos.get(`${f.id}|${semana.inicio}`);
      const previstosGravados = gravado === undefined ? undefined : new Map([[f.id, gravado]]);
      const linha = resumoSemanal({ semana, funcionarios: [f], turnos: this.turnos, regras: this.regras, regime: this.regime, alocacoes: todas, previstosGravados })[0];
      saldo += linha?.saldoMin ?? 0;
    }
    return saldo;
  }

  gerar(ano: number, m: number): [EntradaPlanejamento, ResultadoPlanejamento] {
    const e = this.entradaPara(ano, m);
    const r = gerarEscala(e);
    assertSemViolacoes(e, r);
    this.meses.set(`${ano}-${m}`, r.alocacoes);
    for (const p of r.previstos) this.previstos.set(`${p.funcionarioId}|${p.inicioSemana}`, p.previstoMin);
    return [e, r];
  }

  todas(): Alocacao[] {
    return [...this.meses.values()].flat();
  }

  /** Verificação global de todos os meses gerados, como uma escala única. */
  verificarTudo(): void {
    const todas = this.todas();
    if (todas.length === 0) return;
    const datas = todas.map((a) => a.data).sort();
    const ini = datas[0] as DataISO;
    const fim = datas[datas.length - 1] as DataISO;
    const e = entrada(ini, fim, this.regras, this.turnos, this.funcionarios);
    e.regime = this.regime;
    expect(encontrarViolacoes(e, todas).map((x) => x.mensagem)).toEqual([]);
  }
}

export const domingo = (data: DataISO): boolean => diaDaSemana(data) === 6;
