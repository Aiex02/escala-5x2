// Regime legal de jornada com vigência por data.
//
// As regras do cliente (`RegrasCarga`) são a política da empresa. O regime legal acrescenta
// tetos que mudam com o tempo, como a EC 141/2026, que acaba com a escala 6x1 em etapas.
// Em cada semana de apuração vale o mais restritivo entre a empresa e a lei: a menor carga
// semanal e o maior número de folgas exigidos em qualquer dia daquela semana.

import type { Semana } from "./calendario";
import { type DataISO, formatarDataBR, somarDias, somarMeses } from "./data";
import { formatarMinutos } from "./hora";
import type { FuncionarioPlano, RegrasCarga } from "./modelo";

/** Limites legais a partir de uma data (até a próxima etapa). */
export interface EtapaRegime {
  vigencia: DataISO;
  cargaSemanalMaxMin: number;
  folgasSemanaisMin: number;
}

/** Limites efetivos de uma semana de apuração. */
export interface LimitesSemana {
  cargaMaxMin: number;
  folgasMin: number;
}

/** Dias de trabalho permitidos na semana. */
export function diasTrabalhoMax(limites: LimitesSemana): number {
  return Math.max(0, 7 - limites.folgasMin);
}

/** Etapa vigente em `data` (a de maior vigência que já começou). */
export function etapaEm(etapas: readonly EtapaRegime[], data: DataISO): EtapaRegime | undefined {
  let escolhida: EtapaRegime | undefined;
  for (const e of etapas) {
    if (e.vigencia <= data && (escolhida === undefined || e.vigencia > escolhida.vigencia)) escolhida = e;
  }
  return escolhida;
}

/** Limites da semana: o mais restritivo entre a empresa e a lei em qualquer dia dela. */
export function limitesDaSemana(regras: RegrasCarga, etapas: readonly EtapaRegime[], semana: Semana): LimitesSemana {
  const limites: LimitesSemana = { cargaMaxMin: regras.cargaSemanalMaxMin, folgasMin: regras.folgasSemanaisMin };
  if (etapas.length === 0) return limites;
  for (const dia of semana.dias()) {
    const etapa = etapaEm(etapas, dia);
    if (etapa) {
      limites.cargaMaxMin = Math.min(limites.cargaMaxMin, etapa.cargaSemanalMaxMin);
      limites.folgasMin = Math.max(limites.folgasMin, etapa.folgasSemanaisMin);
    }
  }
  return limites;
}

/**
 * Limites da semana para um funcionário: quem é isento do regime (`isentoRegime`) segue só as
 * regras da empresa; os demais têm também as etapas da lei.
 */
export function limitesDoFuncionarioNaSemana(
  funcionario: Pick<FuncionarioPlano, "isentoRegime">,
  regras: RegrasCarga,
  etapas: readonly EtapaRegime[],
  semana: Semana,
): LimitesSemana {
  return limitesDaSemana(regras, funcionario.isentoRegime ? [] : etapas, semana);
}

/** Teto semanal do funcionário: contrato individual limitado pela semana. */
export function limiteDoFuncionario(funcionario: Pick<FuncionarioPlano, "cargaSemanalMin">, limites: LimitesSemana): number {
  const contrato = funcionario.cargaSemanalMin;
  return contrato === undefined ? limites.cargaMaxMin : Math.min(contrato, limites.cargaMaxMin);
}

// ---------------------------------------------------------------------------
// EC 141/2026
// ---------------------------------------------------------------------------

/** Data de publicação da EC 141/2026 (promulgada em 16/10/2026). Editável: os prazos contam dela. */
export const PUBLICACAO_EC141_PADRAO: DataISO = "2026-10-16";

/**
 * Etapas da EC 141/2026 (fim da escala 6x1), contadas da publicação:
 * - até 2 meses depois: regra anterior da CLT (44h e 1 folga semanal);
 * - 2 meses depois: 42h semanais e 2 folgas por semana;
 * - 14 meses depois: 40h semanais e 2 folgas por semana.
 */
export function etapasEc141(publicacao: DataISO = PUBLICACAO_EC141_PADRAO): EtapaRegime[] {
  return [
    { vigencia: "1900-01-01", cargaSemanalMaxMin: 44 * 60, folgasSemanaisMin: 1 },
    { vigencia: somarMeses(publicacao, 2), cargaSemanalMaxMin: 42 * 60, folgasSemanaisMin: 2 },
    { vigencia: somarMeses(publicacao, 14), cargaSemanalMaxMin: 40 * 60, folgasSemanaisMin: 2 },
  ];
}

/** Texto como "até 42h e 2 folgas por semana". */
export function descreverLimites(limites: LimitesSemana): string {
  return `até ${formatarMinutos(limites.cargaMaxMin)} e ${limites.folgasMin} ${limites.folgasMin === 1 ? "folga" : "folgas"} por semana`;
}

/** Uma fase do regime, pronta para a interface (linha do tempo da EC 141). */
export interface FaseRegime {
  /** 1, 2 ou 3. */
  numero: number;
  nome: string;
  /** Primeiro dia da fase; `null` na primeira (vale desde sempre). */
  inicio: DataISO | null;
  /** Último dia da fase; `null` na última (sem fim). */
  fim: DataISO | null;
  cargaSemanalMaxMin: number;
  folgasSemanaisMin: number;
  /** Ex.: "Até 42h e 2 folgas por semana". */
  descricao: string;
  /** Ex.: "Até 15/12/2026", "De 16/12/2026 a 15/12/2027", "A partir de 16/12/2027". */
  periodo: string;
}

const NOMES_FASES = ["CLT anterior", "Transição (42h)", "Regra final (40h)"];

function primeiraMaiuscula(texto: string): string {
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Fases da EC 141 para exibir. Com `regras`, cada fase já combina a lei com a política da
 * empresa (o mais restritivo); sem ele, mostra só os limites da lei.
 */
export function fasesParaExibicao(publicacao: DataISO = PUBLICACAO_EC141_PADRAO, regras?: RegrasCarga): FaseRegime[] {
  const etapas = etapasEc141(publicacao);
  return etapas.map((etapa, i) => {
    const proxima = etapas[i + 1];
    const inicio = i === 0 ? null : etapa.vigencia;
    const fim = proxima ? somarDias(proxima.vigencia, -1) : null;
    const limites: LimitesSemana = {
      cargaMaxMin: regras ? Math.min(regras.cargaSemanalMaxMin, etapa.cargaSemanalMaxMin) : etapa.cargaSemanalMaxMin,
      folgasMin: regras ? Math.max(regras.folgasSemanaisMin, etapa.folgasSemanaisMin) : etapa.folgasSemanaisMin,
    };
    let periodo: string;
    if (inicio === null && fim !== null) periodo = `Até ${formatarDataBR(fim)}`;
    else if (inicio !== null && fim !== null) periodo = `De ${formatarDataBR(inicio)} a ${formatarDataBR(fim)}`;
    else if (inicio !== null) periodo = `A partir de ${formatarDataBR(inicio)}`;
    else periodo = "Sempre";
    return {
      numero: i + 1,
      nome: NOMES_FASES[i] ?? `Fase ${i + 1}`,
      inicio,
      fim,
      cargaSemanalMaxMin: limites.cargaMaxMin,
      folgasSemanaisMin: limites.folgasMin,
      descricao: primeiraMaiuscula(descreverLimites(limites)),
      periodo,
    };
  });
}

/** Fase da EC 141 em vigor em `data`. */
export function faseVigenteEm(publicacao: DataISO, data: DataISO, regras?: RegrasCarga): FaseRegime {
  const fases = fasesParaExibicao(publicacao, regras);
  let vigente = fases[0];
  for (const fase of fases) {
    if (fase.inicio !== null && fase.inicio <= data) vigente = fase;
  }
  // fasesParaExibicao sempre devolve 3 fases.
  return vigente as FaseRegime;
}

/** Texto da regra que vale no período das semanas: "Até 44h e 1 folga por semana; a partir da semana de 14/12, até 42h e 2 folgas por semana". */
export function descreverRegraDasSemanas(regras: RegrasCarga, etapas: readonly EtapaRegime[], semanas: readonly Semana[]): string {
  const partes: Array<{ inicio: DataISO; limites: LimitesSemana }> = [];
  for (const s of semanas) {
    const l = limitesDaSemana(regras, etapas, s);
    const ultimo = partes[partes.length - 1];
    if (!ultimo || ultimo.limites.cargaMaxMin !== l.cargaMaxMin || ultimo.limites.folgasMin !== l.folgasMin) {
      partes.push({ inicio: s.inicio, limites: l });
    }
  }
  return partes
    .map((p, i) =>
      i === 0
        ? primeiraMaiuscula(descreverLimites(p.limites))
        : `a partir da semana de ${p.inicio.slice(8, 10)}/${p.inicio.slice(5, 7)}, ${descreverLimites(p.limites)}`,
    )
    .join("; ");
}
