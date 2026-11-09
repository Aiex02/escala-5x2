// Dimensionamento da equipe: quantas pessoas de cada função faltam para cobrir o mínimo.

import { prisma } from "@/lib/db";
import { type DataISO, descreverLimites, dimensionar, ehValida, formatarDataBR, type LinhaDimensionamento } from "@/motor";
import type { DimensionamentoDto, LinhaDimensionamentoDto } from "./dto";
import { carregarContexto, type ContextoCliente, ErroAgenda, minimosPorFuncao } from "./planejamento";

function linhaParaDto(l: LinhaDimensionamento): LinhaDimensionamentoDto {
  return {
    funcao: l.funcao,
    nome: l.nome,
    minimoPorTurno: l.minimoPorTurno,
    pessoas: l.pessoas,
    demandaTurnosSemana: l.demandaTurnosSemana,
    capacidadeTurnosSemana: l.capacidadeTurnosSemana,
    faltamPessoas: l.faltamPessoas,
    horasExtrasSemanaMin: l.horasExtrasSemanaMin,
    cobrivelComHoraExtra: l.cobrivelComHoraExtra,
    mensagem: l.mensagem,
  };
}

/** Dimensiona a equipe do cliente para a semana que contém `dataReferencia`. */
export async function dimensionarCliente(clienteId: string, dataReferencia: DataISO): Promise<DimensionamentoDto> {
  if (!ehValida(dataReferencia)) throw new ErroAgenda("Data de referência inválida.");
  return dimensionarContexto(await carregarContexto(prisma, clienteId), dataReferencia);
}

/** Igual a `dimensionarCliente`, com o contexto já carregado. */
export function dimensionarContexto(ctx: ContextoCliente, dataReferencia: DataISO): DimensionamentoDto {  const r = dimensionar({
    turnos: ctx.turnosAtivos,
    funcionarios: ctx.funcionarios.map((f) => ({
      id: f.id,
      cargo: f.cargo,
      cargaSemanalMin: f.cargaSemanalMin,
      ativo: f.ativo,
      isentoRegime: f.isentoEc141,
    })),
    minimoPorFuncao: minimosPorFuncao(ctx.funcionarios, ctx.funcoesMinimasDb),
    regras: ctx.regras,
    regime: ctx.regime,
    dataReferencia,
  });
  return {
    clienteId: ctx.clienteId,
    dataReferencia,
    periodo: `Semana de ${formatarDataBR(r.semana.inicio)} a ${formatarDataBR(r.semana.fim)}`,
    limites: descreverLimites(r.limites),
    margemAusenciasPct: r.margemAusenciasPct,
    linhas: r.linhas.map(linhaParaDto),
    faltas: r.faltas.map(linhaParaDto),
  };
}
