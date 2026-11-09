// Verificação independente de uma escala contra as regras de carga.
//
// Implementada sem reaproveitar o código do motor (agrupa e ordena tudo do zero), para servir
// de prova nos testes e para apontar, na agenda, alocações antigas que passaram a violar regras
// alteradas depois da geração.

import { type Semana, semanaContendo } from "./calendario";
import { type DataISO, diaDaSemana, diasDesdeEpoca, diasEntre, formatarDataBR, formatarDiaMes } from "./data";
import { formatarMinutos } from "./hora";
import type { EntradaPlanejamento } from "./motor";
import { type Alocacao, type Aviso, contemDia, descansoSemanalMin, disponivelEm, type FuncionarioPlano, horaExtraAtiva, jornadaMaxComExtraMin, type Turno } from "./modelo";
import { diasTrabalhoMax, limiteDoFuncionario, limitesDoFuncionarioNaSemana } from "./regime";

export type Violacao =
  | { tipo: "foraDoPeriodo"; funcionarioId: string; data: DataISO; mensagem: string }
  | { tipo: "funcionarioDesconhecido"; funcionarioId: string; data: DataISO; mensagem: string }
  | { tipo: "maisDeUmaJornadaNoDia"; funcionarioId: string; data: DataISO; mensagem: string }
  | { tipo: "diaIndisponivel"; funcionarioId: string; data: DataISO; mensagem: string }
  | { tipo: "turnoInativoNoDia"; funcionarioId: string; data: DataISO; turnoId: string; mensagem: string }
  | { tipo: "jornadaDiaria"; funcionarioId: string; data: DataISO; minutos: number; limite: number; mensagem: string }
  | { tipo: "cargaSemanal"; funcionarioId: string; data: DataISO; minutos: number; limite: number; mensagem: string }
  | { tipo: "folgasSemanais"; funcionarioId: string; data: DataISO; diasTrabalhados: number; folgasMinimas: number; mensagem: string }
  | { tipo: "domingosSeguidos"; funcionarioId: string; data: DataISO; domingos: number; maximo: number; mensagem: string }
  | { tipo: "descanso"; funcionarioId: string; data: DataISO; minutos: number; minimo: number; mensagem: string }
  | { tipo: "descansoSemanal"; funcionarioId: string; data: DataISO; minutos: number; minimo: number; mensagem: string }
  | { tipo: "diaFechado"; funcionarioId: string; data: DataISO; mensagem: string }
  | { tipo: "diasConsecutivos"; funcionarioId: string; data: DataISO; dias: number; maximo: number; mensagem: string };

const duracao = (a: Alocacao): number => {
  const { inicioMin, fimMin } = a.horario;
  return fimMin <= inicioMin ? 1440 - inicioMin + fimMin : fimMin - inicioMin;
};
const trabalhado = (a: Alocacao): number => Math.max(0, duracao(a) - a.horario.intervaloMin);
const comeco = (a: Alocacao): number => diasDesdeEpoca(a.data) * 1440 + a.horario.inicioMin;
const termino = (a: Alocacao): number => comeco(a) + duracao(a);

/**
 * Verifica `alocacoes` (do período) somadas às alocações fixas da entrada. Só reporta
 * problemas que envolvem ao menos um dia do período. Devolve as violações estruturadas,
 * em ordem de data.
 */
export function encontrarViolacoes(entrada: EntradaPlanejamento, alocacoes: readonly Alocacao[]): Violacao[] {
  const regras = entrada.regras;
  const noPeriodo = (d: DataISO): boolean => entrada.inicio <= d && d <= entrada.fim;
  const funcionarios = new Map<string, FuncionarioPlano>(entrada.funcionarios.map((f) => [f.id, f]));
  const turnos = new Map<string, Turno>(entrada.turnos.map((t) => [t.id, t]));
  const violacoes: Violacao[] = [];
  // Com hora extra ativa, a jornada pode passar da normal até o teto com extra, e o limite
  // semanal deixa de ser violação (o excedente vira saldo a compensar).
  const extra = horaExtraAtiva(regras);
  const jornadaMax = jornadaMaxComExtraMin(regras);
  const semanal = descansoSemanalMin(regras);

  // Checagens individuais das alocações do período.
  const vistos = new Set<string>();
  for (const a of alocacoes) {
    const func = funcionarios.get(a.funcionarioId);
    if (!func) {
      violacoes.push({
        tipo: "funcionarioDesconhecido",
        funcionarioId: a.funcionarioId,
        data: a.data,
        mensagem: `Alocação em ${formatarDataBR(a.data)} de funcionário desconhecido (${a.funcionarioId})`,
      });
      continue;
    }
    if (!noPeriodo(a.data)) {
      violacoes.push({
        tipo: "foraDoPeriodo",
        funcionarioId: a.funcionarioId,
        data: a.data,
        mensagem: `${func.nome}: alocação em ${formatarDataBR(a.data)} fora do período`,
      });
    }
    const chave = `${a.funcionarioId}|${a.data}`;
    if (vistos.has(chave)) {
      violacoes.push({
        tipo: "maisDeUmaJornadaNoDia",
        funcionarioId: a.funcionarioId,
        data: a.data,
        mensagem: `${func.nome}: mais de uma jornada em ${formatarDataBR(a.data)}`,
      });
    }
    vistos.add(chave);
    if (!disponivelEm(func, a.data)) {
      violacoes.push({
        tipo: "diaIndisponivel",
        funcionarioId: a.funcionarioId,
        data: a.data,
        mensagem: `${func.nome}: escalado em ${formatarDataBR(a.data)}, dia indisponível`,
      });
    }
    if (entrada.diasFechados?.has(a.data)) {
      violacoes.push({
        tipo: "diaFechado",
        funcionarioId: a.funcionarioId,
        data: a.data,
        mensagem: `${func.nome}: escalado em ${formatarDataBR(a.data)}, dia em que o estabelecimento está fechado`,
      });
    }
    const turno = turnos.get(a.turnoId);
    if (turno && !contemDia(turno.dias, diaDaSemana(a.data))) {
      violacoes.push({
        tipo: "turnoInativoNoDia",
        funcionarioId: a.funcionarioId,
        data: a.data,
        turnoId: a.turnoId,
        mensagem: `${func.nome}: escalado em ${formatarDataBR(a.data)} no turno ${turno.nome}, que não funciona nesse dia`,
      });
    }
    if (trabalhado(a) > jornadaMax) {
      violacoes.push({
        tipo: "jornadaDiaria",
        funcionarioId: a.funcionarioId,
        data: a.data,
        minutos: trabalhado(a),
        limite: jornadaMax,
        mensagem: `${func.nome}: jornada de ${formatarMinutos(trabalhado(a))} em ${formatarDataBR(a.data)} excede o máximo diário de ${formatarMinutos(jornadaMax)}${extra ? " (com hora extra)" : ""}`,
      });
    }
  }

  // Checagens que dependem da sequência: une período + fixas, por funcionário.
  const porFuncionario = new Map<string, Alocacao[]>();
  for (const a of [...alocacoes, ...entrada.alocacoesFixas]) {
    const lista = porFuncionario.get(a.funcionarioId) ?? [];
    lista.push(a);
    porFuncionario.set(a.funcionarioId, lista);
  }

  for (const [id, lista] of porFuncionario) {
    const func = funcionarios.get(id);
    if (!func) continue;
    lista.sort((a, b) => comeco(a) - comeco(b) || (a.data < b.data ? -1 : 1));

    // Carga semanal e folgas (semana completa de apuração, com o regime vigente).
    const semanas = new Map<string, { semana: Semana; minutos: number; dias: Set<DataISO>; tocaPeriodo: boolean }>();
    for (const a of lista) {
      const semana = semanaContendo(a.data, regras.inicioSemana);
      const item = semanas.get(semana.inicio) ?? { semana, minutos: 0, dias: new Set<DataISO>(), tocaPeriodo: false };
      item.minutos += trabalhado(a);
      item.dias.add(a.data);
      item.tocaPeriodo = item.tocaPeriodo || noPeriodo(a.data);
      semanas.set(semana.inicio, item);
    }
    for (const { semana, minutos, dias, tocaPeriodo } of semanas.values()) {
      if (!tocaPeriodo) continue;
      const limites = limitesDoFuncionarioNaSemana(func, regras, entrada.regime, semana);
      const limite = limiteDoFuncionario(func, limites);
      if (minutos > limite && !extra) {
        violacoes.push({
          tipo: "cargaSemanal",
          funcionarioId: id,
          data: semana.inicio,
          minutos,
          limite,
          mensagem: `${func.nome}: ${formatarMinutos(minutos)} na semana de ${formatarDiaMes(semana.inicio)} a ${formatarDiaMes(semana.fim)} excede o limite de ${formatarMinutos(limite)} (hora extra)`,
        });
      }
      if (dias.size > diasTrabalhoMax(limites)) {
        violacoes.push({
          tipo: "folgasSemanais",
          funcionarioId: id,
          data: semana.inicio,
          diasTrabalhados: dias.size,
          folgasMinimas: limites.folgasMin,
          mensagem: `${func.nome}: ${dias.size} dias de trabalho na semana de ${formatarDiaMes(semana.inicio)} a ${formatarDiaMes(semana.fim)}; a regra exige ${limites.folgasMin} folga(s) por semana`,
        });
      }
    }

    // Domingos seguidos.
    if (regras.domingosSeguidosMax > 0) {
      const domingos = [...new Set(lista.map((a) => a.data).filter((d) => diaDaSemana(d) === 6))].sort();
      let sequencia: DataISO[] = [];
      const fechar = (): void => {
        const ultimo = sequencia[sequencia.length - 1];
        if (ultimo !== undefined && sequencia.length > regras.domingosSeguidosMax && sequencia.some(noPeriodo)) {
          violacoes.push({
            tipo: "domingosSeguidos",
            funcionarioId: id,
            data: ultimo,
            domingos: sequencia.length,
            maximo: regras.domingosSeguidosMax,
            mensagem: `${func.nome}: ${sequencia.length} domingos seguidos de trabalho até ${formatarDataBR(ultimo)} (máximo ${regras.domingosSeguidosMax})`,
          });
        }
        sequencia = [];
      };
      for (const d of domingos) {
        const ultimo = sequencia[sequencia.length - 1];
        if (ultimo !== undefined && diasDesdeEpoca(d) - diasDesdeEpoca(ultimo) !== 7) fechar();
        sequencia.push(d);
      }
      fechar();
    }

    // Descanso entre jornadas consecutivas.
    for (let i = 1; i < lista.length; i++) {
      const anterior = lista[i - 1];
      const seguinte = lista[i];
      if (!anterior || !seguinte) continue;
      const descanso = comeco(seguinte) - termino(anterior);
      if (!noPeriodo(anterior.data) && !noPeriodo(seguinte.data)) continue;
      if (descanso < regras.descansoEntreJornadasMin) {
        violacoes.push({
          tipo: "descanso",
          funcionarioId: id,
          data: seguinte.data,
          minutos: descanso,
          minimo: regras.descansoEntreJornadasMin,
          mensagem: `${func.nome}: descanso de ${formatarMinutos(Math.max(0, descanso))} antes da jornada de ${formatarDataBR(seguinte.data)} (mínimo ${formatarMinutos(regras.descansoEntreJornadasMin)})`,
        });
      } else if (descanso < semanal && diasEntre(anterior.data, seguinte.data) > 1) {
        // Folga no meio: 24h de repouso mais 11h de descanso (CLT arts. 66 e 67, Súmula 110 do TST).
        violacoes.push({
          tipo: "descansoSemanal",
          funcionarioId: id,
          data: seguinte.data,
          minutos: descanso,
          minimo: semanal,
          mensagem: `${func.nome}: ${formatarMinutos(Math.max(0, descanso))} entre a última saída antes da folga e a jornada de ${formatarDataBR(seguinte.data)} (mínimo ${formatarMinutos(semanal)} ao redor de uma folga)`,
        });
      }
    }

    // Dias consecutivos.
    const datas = [...new Set(lista.map((a) => a.data))].sort();
    let corrida: DataISO[] = [];
    const fecharCorrida = (): void => {
      const ultimo = corrida[corrida.length - 1];
      if (ultimo !== undefined && corrida.length > regras.maxDiasConsecutivos && corrida.some(noPeriodo)) {
        violacoes.push({
          tipo: "diasConsecutivos",
          funcionarioId: id,
          data: ultimo,
          dias: corrida.length,
          maximo: regras.maxDiasConsecutivos,
          mensagem: `${func.nome}: ${corrida.length} dias seguidos de trabalho até ${formatarDataBR(ultimo)} (máximo ${regras.maxDiasConsecutivos})`,
        });
      }
      corrida = [];
    };
    for (const d of datas) {
      const ultimo = corrida[corrida.length - 1];
      if (ultimo !== undefined && diasDesdeEpoca(d) - diasDesdeEpoca(ultimo) !== 1) fecharCorrida();
      corrida.push(d);
    }
    fecharCorrida();
  }

  return violacoes.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

/**
 * Como `encontrarViolacoes`, no formato de avisos da agenda (tipo `violacaoRegra`), mais um
 * aviso `excessoSemanal` (informativo) para cada semana acima do limite legal, o que só é
 * possível com hora extra.
 */
export function verificarEscala(entrada: EntradaPlanejamento, alocacoes: readonly Alocacao[]): Aviso[] {
  const avisos: Aviso[] = encontrarViolacoes(entrada, alocacoes).map((v) => ({
    tipo: "violacaoRegra",
    data: v.data,
    funcionarioId: v.funcionarioId,
    ...(v.tipo === "turnoInativoNoDia" ? { turnoId: v.turnoId } : {}),
    mensagem: v.mensagem,
  }));
  return [...avisos, ...avisosDeExcessoSemanal(entrada, alocacoes)];
}

/** Semanas (que tocam o período) em que alguém passou do limite legal: hora extra a avisar. */
export function avisosDeExcessoSemanal(entrada: EntradaPlanejamento, alocacoes: readonly Alocacao[]): Aviso[] {
  const regras = entrada.regras;
  if (!horaExtraAtiva(regras)) return [];
  const funcionarios = new Map<string, FuncionarioPlano>(entrada.funcionarios.map((f) => [f.id, f]));
  const semanas = new Map<string, { semana: Semana; funcionarioId: string; minutos: number; noPeriodo: boolean }>();
  for (const a of [...alocacoes, ...entrada.alocacoesFixas]) {
    if (!funcionarios.has(a.funcionarioId)) continue;
    const semana = semanaContendo(a.data, regras.inicioSemana);
    const chave = `${a.funcionarioId}|${semana.inicio}`;
    const item = semanas.get(chave) ?? { semana, funcionarioId: a.funcionarioId, minutos: 0, noPeriodo: false };
    item.minutos += trabalhado(a);
    item.noPeriodo = item.noPeriodo || (entrada.inicio <= a.data && a.data <= entrada.fim);
    semanas.set(chave, item);
  }
  const avisos: Aviso[] = [];
  for (const { semana, funcionarioId, minutos, noPeriodo } of semanas.values()) {
    const func = funcionarios.get(funcionarioId);
    if (!func || !noPeriodo) continue;
    const limite = limiteDoFuncionario(func, limitesDoFuncionarioNaSemana(func, regras, entrada.regime, semana));
    if (minutos <= limite) continue;
    avisos.push({
      tipo: "excessoSemanal",
      data: semana.inicio,
      funcionarioId,
      mensagem: `${func.nome}: ${formatarMinutos(minutos)} na semana de ${formatarDiaMes(semana.inicio)} (limite ${formatarMinutos(limite)}), ${formatarMinutos(minutos - limite)} de hora extra.`,
    });
  }
  return avisos.sort((a, b) => compararAviso(a, b));
}

function compararAviso(a: Aviso, b: Aviso): number {
  const da = a.data ?? "";
  const db = b.data ?? "";
  return da < db ? -1 : da > db ? 1 : (a.funcionarioId ?? "") < (b.funcionarioId ?? "") ? -1 : 1;
}
