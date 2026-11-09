// Geração e reequilíbrio da escala do mês.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deISO, paraISO } from "@/lib/datas";
import {
  type Alocacao,
  type Aviso,
  type DataISO,
  gerarEscala,
  minutosTrabalhados,
  primeiroDiaDoMes,
  verificarEscala,
} from "@/motor";
import type { ResultadoGeracaoDto, ResultadoReequilibrioDto } from "./agendaDto";
import {
  alocacaoParaMotor,
  alocacoesEntre,
  calcularSaldosAnteriores,
  carregarContexto,
  ErroAgenda,
  gravarPrevistos,
  limitesDoMes,
  mesesPosteriores,
  montarEntrada,
  validarAnoMes,
} from "./planejamento";

const OPCOES_TRANSACAO = { maxWait: 10_000, timeout: 60_000 } as const;

function avisoParaDb(clienteId: string, ano: number, mes: number, a: Aviso): Prisma.AvisoMesCreateManyInput {
  return {
    clienteId,
    ano,
    mes,
    tipo: a.tipo,
    data: a.data ? deISO(a.data) : null,
    turnoId: a.turnoId ?? null,
    funcionarioId: a.funcionarioId ?? null,
    mensagem: a.mensagem,
  };
}

function alocacaoParaDb(clienteId: string, a: Alocacao): Prisma.AlocacaoCreateManyInput {
  return {
    clienteId,
    funcionarioId: a.funcionarioId,
    turnoId: a.turnoId,
    data: deISO(a.data),
    inicioMin: a.horario.inicioMin,
    fimMin: a.horario.fimMin,
    intervaloMin: a.horario.intervaloMin,
    minutosTrabalhados: minutosTrabalhados(a.horario),
    origem: a.origem ?? "normal",
  };
}

/** Saldo de horas de cada funcionário (id → minutos) nas semanas fechadas antes do período que começa em `inicio`. */
export async function saldosAnteriores(clienteId: string, inicio: DataISO): Promise<Record<string, number>> {
  const ctx = await carregarContexto(prisma, clienteId);
  return Object.fromEntries(await calcularSaldosAnteriores(prisma, ctx, inicio));
}

/** Gera (ou gera de novo) a escala do mês inteiro, descartando alocações, avisos e ajustes manuais anteriores. */
export async function gerarMes(clienteId: string, ano: number, mes: number): Promise<ResultadoGeracaoDto> {
  validarAnoMes(ano, mes);
  const { inicio, fim } = limitesDoMes(ano, mes);
  const ctx = await carregarContexto(prisma, clienteId);
  if (!ctx.funcionarios.some((f) => f.ativo)) throw new ErroAgenda("Cadastre ou ative ao menos um funcionário antes de gerar a escala.");
  if (ctx.turnosAtivos.length === 0) throw new ErroAgenda("Configure ao menos um turno antes de gerar a escala.");

  const saldos = await calcularSaldosAnteriores(prisma, ctx, inicio);
  const entrada = await montarEntrada(prisma, ctx, ano, mes, inicio, { funcionarios: "ativos", saldos });
  const resultado = gerarEscala(entrada);
  const avisos: Aviso[] = [...resultado.avisos, ...verificarEscala(entrada, resultado.alocacoes)];

  await prisma.$transaction(async (tx) => {
    const periodo = { gte: deISO(inicio), lte: deISO(fim) };
    await tx.alocacao.deleteMany({ where: { clienteId, data: periodo } });
    await tx.ajusteManual.deleteMany({ where: { clienteId, data: periodo } });
    await tx.avisoMes.deleteMany({ where: { clienteId, ano, mes } });
    await tx.mesGerado.upsert({
      where: { clienteId_ano_mes: { clienteId, ano, mes } },
      create: { clienteId, ano, mes },
      update: { geradoEm: new Date() },
    });
    await tx.alocacao.createMany({ data: resultado.alocacoes.map((a) => alocacaoParaDb(clienteId, a)) });
    await tx.avisoMes.createMany({ data: avisos.map((a) => avisoParaDb(clienteId, ano, mes, a)) });
    await gravarPrevistos(tx, clienteId, ano, mes, { doMotor: resultado.previstos });
  }, OPCOES_TRANSACAO);

  return { alocacoes: resultado.alocacoes.length, avisos: avisos.length };
}

/**
 * Refaz o mês a partir de `aPartirDe`: dias antes dele e dias com ajuste manual ficam como
 * estão; o resto é redistribuído compensando o saldo das semanas anteriores.
 */
async function reequilibrarMes(clienteId: string, ano: number, mes: number, aPartirDe: DataISO): Promise<number> {
  const { inicio: inicioMes, fim } = limitesDoMes(ano, mes);
  const de = aPartirDe < inicioMes ? inicioMes : aPartirDe > fim ? fim : aPartirDe;
  const ctx = await carregarContexto(prisma, clienteId);
  const saldos = await calcularSaldosAnteriores(prisma, ctx, de);
  const entrada = await montarEntrada(prisma, ctx, ano, mes, de, { funcionarios: "ativos", saldos });

  const [existentes, ajustes, avisosAntigos] = await Promise.all([
    alocacoesEntre(prisma, clienteId, de, fim),
    prisma.ajusteManual.findMany({ where: { clienteId, data: { gte: deISO(de), lte: deISO(fim) } } }),
    prisma.avisoMes.findMany({ where: { clienteId, ano, mes } }),
  ]);
  const manuais = new Set(ajustes.map((a) => `${a.funcionarioId}|${paraISO(a.data)}`));
  const travadasDb = existentes.filter((a) => manuais.has(`${a.funcionarioId}|${paraISO(a.data)}`));
  entrada.alocacoesTravadas = travadasDb.map(alocacaoParaMotor);

  // Folga feita à mão: a pessoa não trabalha nesse dia, mas as horas dele continuam previstas.
  const trabalha = new Set(entrada.alocacoesTravadas.map((a) => `${a.funcionarioId}|${a.data}`));
  for (const aj of ajustes) {
    const data = paraISO(aj.data);
    if (trabalha.has(`${aj.funcionarioId}|${data}`)) continue;
    const plano = entrada.funcionarios.find((p) => p.id === aj.funcionarioId);
    if (plano && !plano.indisponivel.has(data)) plano.faltas.add(data);
  }

  const resultado = gerarEscala(entrada);
  // Violações novas (além das que os ajustes manuais já causam) viram avisos.
  const antes = new Set(verificarEscala(entrada, entrada.alocacoesTravadas).map((a) => a.mensagem));
  const novas = verificarEscala(entrada, [...entrada.alocacoesTravadas, ...resultado.alocacoes]).filter((a) => !antes.has(a.mensagem));
  const avisosAnteriores: Aviso[] = avisosAntigos
    .filter((a) => a.data !== null && paraISO(a.data) < de)
    .map((a) => ({
      tipo: a.tipo as Aviso["tipo"],
      data: a.data ? paraISO(a.data) : undefined,
      turnoId: a.turnoId ?? undefined,
      funcionarioId: a.funcionarioId ?? undefined,
      mensagem: a.mensagem,
    }));
  const avisos = [...avisosAnteriores, ...resultado.avisos, ...novas];

  await prisma.$transaction(async (tx) => {
    await tx.alocacao.deleteMany({
      where: { clienteId, data: { gte: deISO(de), lte: deISO(fim) }, id: { notIn: travadasDb.map((a) => a.id) } },
    });
    await tx.avisoMes.deleteMany({ where: { clienteId, ano, mes } });
    await tx.alocacao.createMany({ data: resultado.alocacoes.map((a) => alocacaoParaDb(clienteId, a)) });
    await tx.avisoMes.createMany({ data: avisos.map((a) => avisoParaDb(clienteId, ano, mes, a)) });
    await gravarPrevistos(tx, clienteId, ano, mes, { desde: de, doMotor: resultado.previstos });
  }, OPCOES_TRANSACAO);
  return avisos.length;
}

/**
 * Reequilibra o mês a partir de `aPartirDe`. Com `levarAosSeguintes`, refaz também, do dia 1
 * e mantendo seus ajustes manuais, cada mês seguinte já gerado.
 */
export async function reequilibrar(
  clienteId: string,
  ano: number,
  mes: number,
  aPartirDe: DataISO,
  levarAosSeguintes: boolean,
): Promise<ResultadoReequilibrioDto> {
  validarAnoMes(ano, mes);
  const ctx = await carregarContexto(prisma, clienteId);
  if (!ctx.meses.some((m) => m.ano === ano && m.mes === mes)) throw new ErroAgenda("Gere a escala deste mês antes de reequilibrar.");
  let meses = 1;
  const avisos = await reequilibrarMes(clienteId, ano, mes, aPartirDe);
  if (levarAosSeguintes) {
    for (const m of mesesPosteriores(ctx, ano, mes)) {
      await reequilibrarMes(clienteId, m.ano, m.mes, primeiroDiaDoMes(m.ano, m.mes));
      meses++;
    }
  }
  return { meses, avisos };
}
