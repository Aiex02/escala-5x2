"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { falha, ok, type Resultado } from "@/lib/resultado";
import { ErroMotor } from "@/motor";
import type { AgendaMesDto, ResultadoGeracaoDto, ResultadoReequilibrioDto } from "@/servicos/agendaDto";
import { definirDia, excluirMes, fecharDia, reabrirDia, trocarDia } from "@/servicos/agenda";
import { gerarMes, reequilibrar } from "@/servicos/geracao";
import { ErroAgenda } from "@/servicos/planejamento";

const esquemaMes = z.object({
  clienteId: z.string().min(1),
  ano: z.number().int().min(2000).max(2100),
  mes: z.number().int().min(1).max(12),
});
const esquemaData = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.");

const esquemaValor = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("turno"), turnoId: z.string().min(1) }),
  z.object({ tipo: z.literal("folga") }),
  z.object({ tipo: z.literal("falta") }),
  z.object({ tipo: z.literal("justificada"), motivo: z.string().max(80).optional() }),
  z.object({ tipo: z.literal("limpar") }),
]);

function codigoDeErro(erro: unknown): string | undefined {
  return erro instanceof ErroAgenda && erro.codigo ? erro.codigo : undefined;
}

function mensagemDeErro(erro: unknown): string {
  if (erro instanceof ErroAgenda || erro instanceof ErroMotor) return erro.message;
  console.error("Erro inesperado na agenda:", erro);
  return "Não foi possível concluir a operação. Tente novamente.";
}

/** Atualiza a página do mês e a árvore de meses gerados da barra lateral. */
function atualizarTelas(clienteId: string, ano: number, mes: number): void {
  revalidatePath(`/clientes/${clienteId}/escala/${ano}/${mes}`);
  revalidatePath("/clientes/[clienteId]", "layout");
}

export async function gerarMesAcao(clienteId: string, ano: number, mes: number): Promise<Resultado<ResultadoGeracaoDto>> {
  const entrada = esquemaMes.safeParse({ clienteId, ano, mes });
  if (!entrada.success) return falha("Mês inválido.");
  try {
    const dados = await gerarMes(clienteId, ano, mes);
    atualizarTelas(clienteId, ano, mes);
    return ok(dados);
  } catch (erro) {
    return falha(mensagemDeErro(erro));
  }
}

export async function reequilibrarAcao(
  clienteId: string,
  ano: number,
  mes: number,
  aPartirDe: string,
  levarAosSeguintes: boolean,
): Promise<Resultado<ResultadoReequilibrioDto>> {
  const entrada = esquemaMes.safeParse({ clienteId, ano, mes });
  const data = esquemaData.safeParse(aPartirDe);
  if (!entrada.success || !data.success) return falha("Dados inválidos.");
  try {
    const dados = await reequilibrar(clienteId, ano, mes, aPartirDe, levarAosSeguintes);
    atualizarTelas(clienteId, ano, mes);
    return ok(dados);
  } catch (erro) {
    return falha(mensagemDeErro(erro));
  }
}

/**
 * Ajuste de um dia no Quadro; devolve a agenda recalculada (o cliente substitui o estado).
 * Com ausência no dia, turno e folga falham com `codigo: "diaComAusencia"` até virem com `substituirAusencia`.
 */
export async function definirDiaAcao(
  clienteId: string,
  funcionarioId: string,
  data: string,
  valor: z.input<typeof esquemaValor>,
  substituirAusencia = false,
): Promise<Resultado<AgendaMesDto>> {
  const d = esquemaData.safeParse(data);
  const v = esquemaValor.safeParse(valor);
  if (!d.success || !v.success || !clienteId || !funcionarioId) return falha("Dados inválidos.");
  try {
    return ok(await definirDia(clienteId, funcionarioId, data, v.data, { substituirAusencia }));
  } catch (erro) {
    return falha(mensagemDeErro(erro), codigoDeErro(erro));
  }
}

/** Troca o que duas pessoas têm no mesmo dia. */
export async function trocarDiaAcao(clienteId: string, data: string, funcionarioA: string, funcionarioB: string): Promise<Resultado<AgendaMesDto>> {
  const d = esquemaData.safeParse(data);
  if (!d.success || !clienteId || !funcionarioA || !funcionarioB) return falha("Dados inválidos.");
  try {
    return ok(await trocarDia(clienteId, data, funcionarioA, funcionarioB));
  } catch (erro) {
    return falha(mensagemDeErro(erro));
  }
}

/** Fecha o dia (feriado): apaga as jornadas dele e impede escalar. */
export async function fecharDiaAcao(clienteId: string, data: string, motivo: string): Promise<Resultado<AgendaMesDto>> {
  const d = esquemaData.safeParse(data);
  const m = z.string().max(80).safeParse(motivo);
  if (!d.success || !m.success || !clienteId) return falha("Dados inválidos.");
  try {
    return ok(await fecharDia(clienteId, data, m.data));
  } catch (erro) {
    return falha(mensagemDeErro(erro));
  }
}

export async function reabrirDiaAcao(clienteId: string, data: string): Promise<Resultado<AgendaMesDto>> {
  const d = esquemaData.safeParse(data);
  if (!d.success || !clienteId) return falha("Dados inválidos.");
  try {
    return ok(await reabrirDia(clienteId, data));
  } catch (erro) {
    return falha(mensagemDeErro(erro));
  }
}

export async function excluirMesAcao(clienteId: string, ano: number, mes: number): Promise<Resultado<null>> {
  const entrada = esquemaMes.safeParse({ clienteId, ano, mes });
  if (!entrada.success) return falha("Mês inválido.");
  try {
    await excluirMes(clienteId, ano, mes);
    atualizarTelas(clienteId, ano, mes);
    return ok(null);
  } catch (erro) {
    return falha(mensagemDeErro(erro));
  }
}
