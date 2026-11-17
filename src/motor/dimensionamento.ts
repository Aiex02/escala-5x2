// Dimensionamento de equipe: quantas pessoas de cada função faltam para cobrir o mínimo
// de cada turno em todos os dias abertos, dentro das regras da fase vigente da lei.
//
// A conta é semanal: demanda = mínimo × dias abertos de cada turno; capacidade de cada
// pessoa = jornadas que ela pode fazer na semana (dias de trabalho permitidos limitados pela
// carga contratual e pelo teto legal), descontada uma margem para férias, atestados e faltas.

import { type Semana, semanaContendo } from "./calendario";
import { type DataISO } from "./data";
import { formatarMinutos, minutosTrabalhados } from "./hora";
import {
  chaveFuncao,
  type FuncaoMinima,
  HORA_EXTRA_DIARIA_PADRAO_MIN,
  indicesDias,
  minutosDoTurnoPara,
  type RegrasCarga,
  temHoraNaoTrabalhada,
  type Turno,
} from "./modelo";
import { diasTrabalhoMax, type EtapaRegime, limiteDoFuncionario, limitesDaSemana, type LimitesSemana } from "./regime";

export interface PessoaDimensionamento {
  id: string;
  /** Cargo como cadastrado (é normalizado por `chaveFuncao`). */
  cargo?: string | null;
  cargaSemanalMin?: number | null;
  ativo: boolean;
  /** Fora do regime da EC 141 (só regras da empresa). */
  isentoRegime?: boolean;
  /** Hora não trabalhada própria (almoço da pessoa), em minutos; muda a jornada dela. */
  horasNaoTrabalhadasMin?: number | null;
}

export interface EntradaDimensionamento {
  turnos: readonly Turno[];
  funcionarios: readonly PessoaDimensionamento[];
  /** Mínimo por função (chave de `chaveFuncao`); função sem linha usa `minimoPadrao` (padrão 0 = sem exigência). */
  minimoPorFuncao: ReadonlyMap<string, FuncaoMinima>;
  /** Mínimo para funções sem linha (padrão 0 = sem exigência). */
  minimoPadrao?: number;
  regras: RegrasCarga;
  regime: readonly EtapaRegime[];
  /** Semana de referência: a que contém esta data (define a fase da lei). */
  dataReferencia: DataISO;
  /** Margem para férias, atestados e faltas, em % da capacidade (padrão 8). */
  margemAusenciasPct?: number;
}

export interface LinhaDimensionamento {
  /** Chave da função; "" = efetivo mínimo geral dos turnos. */
  funcao: string;
  /** Nome para exibir (cargo mais frequente ou "Efetivo mínimo"). */
  nome: string;
  minimoPorTurno: number;
  pessoas: number;
  /** Turnos-dia que o mínimo exige por semana. */
  demandaTurnosSemana: number;
  demandaHorasMin: number;
  /** Turnos-dia que a equipe atual cobre por semana (já com a margem). */
  capacidadeTurnosSemana: number;
  capacidadeHorasMin: number;
  /** Pessoas a contratar para cobrir sem hora extra (0 = equipe suficiente). */
  faltamPessoas: number;
  /** Turnos-dia por semana que uma pessoa nova cobre (base da conta). */
  turnosPorPessoaNova: number;
  /** Hora extra por semana necessária para cobrir sem contratar (0 se não falta). */
  horasExtrasSemanaMin: number;
  /** A hora extra legal (teto diário × dias) dá conta do que falta? */
  cobrivelComHoraExtra: boolean;
  /** Frase pronta: "Cozinheiro: cobre 10 de 14 turnos por semana. Contratar 1." */
  mensagem: string;
}

export interface Dimensionamento {
  semana: Semana;
  limites: LimitesSemana;
  linhas: LinhaDimensionamento[];
  /** Só as linhas com falta, ordenadas por quem falta mais. */
  faltas: LinhaDimensionamento[];
  margemAusenciasPct: number;
}

const MARGEM_PADRAO_PCT = 8;

/**
 * Jornada típica dos turnos (média ponderada pelos dias abertos), base da capacidade. Com
 * `pessoa`, mede os turnos com a hora não trabalhada dela: quem tem almoço próprio cumpre
 * jornadas de outro tamanho, e a capacidade semanal dela muda junto.
 */
function jornadaTipica(turnos: readonly Turno[], regras: RegrasCarga, pessoa?: PessoaDimensionamento): number {
  const propria = temHoraNaoTrabalhada(pessoa);
  if (!propria && regras.jornadaContratualMin && regras.jornadaContratualMin > 0) return regras.jornadaContratualMin;
  let soma = 0;
  let dias = 0;
  for (const t of turnos) {
    const n = indicesDias(t.dias).length;
    soma += (propria ? minutosDoTurnoPara(pessoa, t) : minutosTrabalhados(t.horario)) * n;
    dias += n;
  }
  return dias > 0 ? Math.round(soma / dias) : regras.jornadaDiariaMaxMin;
}

/** Turnos-dia que uma pessoa cobre por semana, sem margem. */
function turnosPorSemana(cargaSemanalMin: number | null | undefined, limites: LimitesSemana, jornadaMin: number): number {
  const carga = limiteDoFuncionario({ cargaSemanalMin: cargaSemanalMin ?? undefined }, limites);
  return Math.max(0, Math.min(diasTrabalhoMax(limites), Math.floor(carga / jornadaMin)));
}

function nomeMaisFrequente(cargos: readonly string[], chave: string): string {
  const contagem = new Map<string, number>();
  for (const c of cargos) contagem.set(c, (contagem.get(c) ?? 0) + 1);
  return [...contagem.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"))[0]?.[0] ?? chave;
}

function plural(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** Dimensiona a equipe por função e no total, para a semana que contém `dataReferencia`. */
export function dimensionar(entrada: EntradaDimensionamento): Dimensionamento {
  const margemPct = entrada.margemAusenciasPct ?? MARGEM_PADRAO_PCT;
  const fator = Math.max(0, 1 - margemPct / 100);
  const semana = semanaContendo(entrada.dataReferencia, entrada.regras.inicioSemana);
  const limites = limitesDaSemana(entrada.regras, entrada.regime, semana);
  const limitesEmpresa = limitesDaSemana(entrada.regras, [], semana);
  const jornadaMin = jornadaTipica(entrada.turnos, entrada.regras);
  // Jornada de cada pessoa: quem tem hora não trabalhada própria tem a sua (cache por id).
  const jornadaPorPessoa = new Map<string, number>();
  const jornadaDe = (p: PessoaDimensionamento): number => {
    if (!temHoraNaoTrabalhada(p)) return jornadaMin;
    const cacheada = jornadaPorPessoa.get(p.id);
    if (cacheada !== undefined) return cacheada;
    const propria = Math.max(1, jornadaTipica(entrada.turnos, entrada.regras, p));
    jornadaPorPessoa.set(p.id, propria);
    return propria;
  };
  const extraDiaMax = entrada.regras.permitirHoraExtra === false ? 0 : (entrada.regras.horaExtraDiariaMaxMin ?? HORA_EXTRA_DIARIA_PADRAO_MIN);
  const minimoPadrao = entrada.minimoPadrao ?? 0;
  const ativos = entrada.funcionarios.filter((f) => f.ativo);

  // Demanda por turno: dias abertos na semana.
  const diasPorTurno = entrada.turnos.map((t) => ({ turno: t, dias: indicesDias(t.dias).length }));
  const turnosDiaTotal = diasPorTurno.reduce((s, x) => s + x.dias, 0);
  const horasTotal = diasPorTurno.reduce((s, x) => s + x.dias * minutosTrabalhados(x.turno.horario), 0);

  const linhaDe = (
    funcao: string,
    nome: string,
    minimoPorTurno: number,
    pessoas: readonly PessoaDimensionamento[],
    demandaTurnos: number,
    demandaHoras: number,
  ): LinhaDimensionamento => {
    const capBruta = pessoas.reduce((s, p) => s + turnosPorSemana(p.cargaSemanalMin, p.isentoRegime ? limitesEmpresa : limites, jornadaDe(p)), 0);
    const capacidade = capBruta * fator;
    const porPessoaNova = turnosPorSemana(undefined, limites, jornadaMin) * fator;
    const deficitTurnos = Math.max(0, demandaTurnos - capacidade);
    const faltam = deficitTurnos > 0 && porPessoaNova > 0 ? Math.ceil(deficitTurnos / porPessoaNova) : 0;
    const horasExtras = Math.round(deficitTurnos * jornadaMin);
    const extraPossivel = pessoas.reduce((s, p) => s + turnosPorSemana(p.cargaSemanalMin, limites, jornadaDe(p)) * extraDiaMax, 0);
    const cobrivel = horasExtras === 0 || horasExtras <= extraPossivel;
    const capTexto = `${Math.floor(capacidade)} de ${demandaTurnos} turnos por semana`;
    const mensagem =
      demandaTurnos === 0
        ? `${nome}: sem exigência de cobertura.`
        : faltam === 0
          ? `${nome}: ${plural(pessoas.length, "pessoa cobre", "pessoas cobrem")} ${capTexto}. Equipe suficiente.`
          : `${nome}: ${plural(pessoas.length, "pessoa cobre", "pessoas cobrem")} ${capTexto}. Contratar ${plural(faltam, "pessoa", "pessoas")}` +
            (cobrivel
              ? ` ou aceitar cerca de ${formatarMinutos(horasExtras)} de hora extra por semana.`
              : `; nem com hora extra dá para cobrir (faltam ${formatarMinutos(horasExtras)} por semana).`);
    return {
      funcao,
      nome,
      minimoPorTurno,
      pessoas: pessoas.length,
      demandaTurnosSemana: demandaTurnos,
      demandaHorasMin: demandaHoras,
      capacidadeTurnosSemana: Math.round(capacidade * 10) / 10,
      capacidadeHorasMin: Math.round(capacidade * jornadaMin),
      faltamPessoas: faltam,
      turnosPorPessoaNova: Math.round(porPessoaNova * 10) / 10,
      horasExtrasSemanaMin: horasExtras,
      cobrivelComHoraExtra: cobrivel,
      mensagem,
    };
  };

  const linhas: LinhaDimensionamento[] = [];

  // Efetivo mínimo geral (soma dos mínimos dos turnos) contra toda a equipe ativa.
  const demandaEfetivo = diasPorTurno.reduce((s, x) => s + x.dias * x.turno.efetivoMinimo, 0);
  const horasEfetivo = diasPorTurno.reduce((s, x) => s + x.dias * x.turno.efetivoMinimo * minutosTrabalhados(x.turno.horario), 0);
  if (demandaEfetivo > 0) {
    const minimoMedio = turnosDiaTotal > 0 ? Math.round((demandaEfetivo / turnosDiaTotal) * 10) / 10 : 0;
    linhas.push(linhaDe("", "Efetivo mínimo dos turnos", minimoMedio, ativos, demandaEfetivo, horasEfetivo));
  }

  // Por função.
  const porFuncao = new Map<string, PessoaDimensionamento[]>();
  for (const f of ativos) {
    const cargo = f.cargo?.trim();
    if (!cargo) continue;
    const chave = chaveFuncao(cargo);
    if (!chave) continue;
    porFuncao.set(chave, [...(porFuncao.get(chave) ?? []), f]);
  }
  for (const [chave, pessoas] of porFuncao) {
    const configurado = entrada.minimoPorFuncao.get(chave);
    const minimo = configurado?.minimo ?? minimoPadrao;
    const nome = configurado?.nome ?? nomeMaisFrequente(pessoas.map((p) => p.cargo?.trim() ?? ""), chave);
    linhas.push(linhaDe(chave, nome, minimo, pessoas, turnosDiaTotal * minimo, horasTotal * minimo));
  }
  // Funções exigidas sem ninguém no cadastro.
  for (const [chave, fm] of entrada.minimoPorFuncao) {
    if (porFuncao.has(chave) || fm.minimo <= 0) continue;
    linhas.push(linhaDe(chave, fm.nome, fm.minimo, [], turnosDiaTotal * fm.minimo, horasTotal * fm.minimo));
  }

  linhas.sort((a, b) => (a.funcao === "" ? -1 : b.funcao === "" ? 1 : a.nome.localeCompare(b.nome, "pt-BR")));
  const faltas = linhas.filter((l) => l.faltamPessoas > 0).sort((a, b) => b.faltamPessoas - a.faltamPessoas);
  return { semana, limites, linhas, faltas, margemAusenciasPct: margemPct };
}
