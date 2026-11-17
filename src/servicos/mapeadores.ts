// Conversões entre as linhas do Prisma e os tipos do motor (domínio puro).
// Compartilhado pelos serviços de cadastro e de agenda.

import type {
  Funcionario as FuncionarioDb,
  Regras as RegrasDb,
  Turno as TurnoDb,
  Periodo as PeriodoDb,
  InicioSemana as InicioSemanaDb,
} from "@prisma/client";
import {
  type EtapaRegime,
  type FuncionarioPlano,
  type InicioSemana,
  type Periodo,
  type RegrasCarga,
  type Turno,
  type DataISO,
  chaveFuncao,
  etapasEc141,
  PUBLICACAO_EC141_PADRAO,
} from "@/motor";
import { paraISO } from "@/lib/datas";

export function periodoParaMotor(p: PeriodoDb | null | undefined): Periodo | undefined {
  switch (p) {
    case "MANHA":
      return "manha";
    case "TARDE":
      return "tarde";
    case "NOITE":
      return "noite";
    default:
      return undefined;
  }
}

export function periodoParaDb(p: Periodo | null | undefined): PeriodoDb | null {
  switch (p) {
    case "manha":
      return "MANHA";
    case "tarde":
      return "TARDE";
    case "noite":
      return "NOITE";
    default:
      return null;
  }
}

export function inicioSemanaParaMotor(i: InicioSemanaDb): InicioSemana {
  return i === "DOMINGO" ? "domingo" : "segunda";
}

export function inicioSemanaParaDb(i: InicioSemana): InicioSemanaDb {
  return i === "domingo" ? "DOMINGO" : "SEGUNDA";
}

export function regrasParaMotor(r: RegrasDb): RegrasCarga {
  return {
    cargaSemanalMaxMin: r.cargaSemanalMaxMin,
    jornadaDiariaMaxMin: r.jornadaDiariaMaxMin,
    descansoEntreJornadasMin: r.descansoEntreJornadasMin,
    maxDiasConsecutivos: r.maxDiasConsecutivos,
    inicioSemana: inicioSemanaParaMotor(r.inicioSemana),
    folgasSemanaisMin: r.folgasSemanaisMin,
    domingosSeguidosMax: r.domingosSeguidosMax,
    jornadaContratualMin: r.jornadaPadraoMin,
    permitirHoraExtra: r.permitirHoraExtra,
    horaExtraDiariaMaxMin: r.horaExtraDiariaMaxMin,
  };
}

/** Data de publicação da EC 141 em vigor para o cliente (ISO). */
export function publicacaoEc141(r: Pick<RegrasDb, "ec141Publicacao">): DataISO {
  return r.ec141Publicacao ? paraISO(r.ec141Publicacao) : PUBLICACAO_EC141_PADRAO;
}

/** Etapas do regime legal do cliente (vazio = só as regras da empresa). */
export function regimeParaMotor(r: Pick<RegrasDb, "regime" | "ec141Publicacao">): EtapaRegime[] {
  return r.regime === "EC141" ? etapasEc141(publicacaoEc141(r)) : [];
}

export function turnoParaMotor(t: TurnoDb): Turno {
  return {
    id: t.id,
    nome: t.nome,
    horario: { inicioMin: t.inicioMin, fimMin: t.fimMin, intervaloMin: t.intervaloMin },
    efetivoMinimo: t.efetivoMinimo,
    ordem: t.ordem,
    dias: t.diasSemana,
  };
}

/**
 * Funcionário para o motor. Ausências, faltas e saldo anterior são preenchidos pelo
 * serviço de agenda (dependem do período e das semanas fechadas).
 */
export function funcionarioParaMotor(
  f: FuncionarioDb,
  extras: { indisponivel?: Set<DataISO>; faltas?: Set<DataISO>; saldoAnteriorMin?: number } = {},
): FuncionarioPlano {
  return {
    id: f.id,
    nome: f.nome,
    cargaSemanalMin: f.cargaSemanalMin ?? undefined,
    indisponivel: extras.indisponivel ?? new Set(),
    faltas: extras.faltas ?? new Set(),
    preferencia: periodoParaMotor(f.preferencia),
    saldoAnteriorMin: extras.saldoAnteriorMin ?? 0,
    funcao: f.cargo ? chaveFuncao(f.cargo) : undefined,
    isentoRegime: f.isentoEc141,
    // Hora não trabalhada (almoço próprio): entra no motor e substitui o intervalo da loja.
    ...(f.horasNaoTrabalhadasMin === null ? {} : { horasNaoTrabalhadasMin: f.horasNaoTrabalhadasMin }),
  };
}
