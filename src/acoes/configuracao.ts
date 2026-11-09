"use server";

import { z } from "zod";
import { falha, type Resultado } from "@/lib/resultado";
import { ehValida } from "@/motor";
import { dimensionarCliente } from "@/servicos/dimensionamento";
import type { DimensionamentoDto } from "@/servicos/dto";
import { salvarFuncionamento, salvarFuncoes, salvarHoraExtra, salvarRegime, salvarTurno } from "@/servicos/configuracao";
import { executarCadastro, revalidarCliente, validar } from "./executarCadastro";

const id = z.string().min(1);
const inteiro = (rotulo: string, min: number, max: number) =>
  z.number({ error: `${rotulo}: informe um número.` }).int(`${rotulo}: use um número inteiro.`).min(min, `${rotulo}: mínimo ${min}.`).max(max, `${rotulo}: máximo ${max}.`);

const esquemaFuncionamento = z.object({
  clienteId: id,
  modelo: z.string().min(1).nullable(),
  regras: z.object({
    cargaSemanalMaxMin: inteiro("Carga semanal", 1, 7 * 24 * 60),
    jornadaDiariaMaxMin: inteiro("Jornada diária máxima", 1, 24 * 60),
    descansoEntreJornadasMin: inteiro("Descanso entre jornadas", 0, 48 * 60),
    maxDiasConsecutivos: inteiro("Dias consecutivos", 1, 31),
    inicioSemana: z.enum(["segunda", "domingo"], { error: "Início da semana inválido." }),
    folgasSemanaisMin: inteiro("Folgas semanais", 0, 6),
    domingosSeguidosMax: inteiro("Domingos seguidos", 0, 52),
  }),
  janelas: z.array(
    z.object({
      dia: inteiro("Dia", 0, 6),
      abreMin: inteiro("Abertura", 0, 1439),
      fechaMin: inteiro("Fechamento", 0, 1439),
    }),
  ),
  jornadaMin: inteiro("Jornada", 60, 12 * 60),
  intervaloMin: inteiro("Intervalo", 0, 120),
});

export type EntradaFuncionamentoAcao = z.input<typeof esquemaFuncionamento>;

/** Salva modelo, regras e janelas e refaz os turnos. */
export async function salvarFuncionamentoAcao(entrada: EntradaFuncionamentoAcao): Promise<Resultado<{ turnos: number }>> {
  const v = validar(esquemaFuncionamento, entrada);
  if (!v.ok) return falha(v.erro);
  const { clienteId, ...resto } = v.dados;
  const r = await executarCadastro(() => salvarFuncionamento(clienteId, resto));
  if (r.ok) revalidarCliente();
  return r;
}

const esquemaRegime = z.object({
  clienteId: id,
  regime: z.enum(["LIVRE", "EC141"]),
  publicacao: z.string().refine(ehValida, "Data de publicação inválida."),
});

export async function salvarRegimeAcao(entrada: z.input<typeof esquemaRegime>): Promise<Resultado<null>> {
  const v = validar(esquemaRegime, entrada);
  if (!v.ok) return falha(v.erro);
  const r = await executarCadastro(async () => {
    await salvarRegime(v.dados.clienteId, v.dados.regime, v.dados.publicacao);
    return null;
  });
  if (r.ok) revalidarCliente();
  return r;
}

const esquemaHoraExtra = z.object({
  clienteId: id,
  permitirHoraExtra: z.boolean(),
  horaExtraDiariaMaxMin: inteiro("Hora extra máxima por dia", 0, 240).refine((n) => n % 15 === 0, "Hora extra máxima por dia: use múltiplos de 15 minutos."),
});

export async function salvarHoraExtraAcao(entrada: z.input<typeof esquemaHoraExtra>): Promise<Resultado<null>> {
  const v = validar(esquemaHoraExtra, entrada);
  if (!v.ok) return falha(v.erro);
  const { clienteId, ...dados } = v.dados;
  const r = await executarCadastro(async () => {
    await salvarHoraExtra(clienteId, dados);
    return null;
  });
  if (r.ok) revalidarCliente();
  return r;
}

const esquemaTurno = z.object({
  clienteId: id,
  turnoId: id,
  cor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Cor inválida."),
  efetivoMinimo: inteiro("Efetivo mínimo", 0, 99),
});

export async function salvarTurnoAcao(entrada: z.input<typeof esquemaTurno>): Promise<Resultado<null>> {
  const v = validar(esquemaTurno, entrada);
  if (!v.ok) return falha(v.erro);
  const r = await executarCadastro(async () => {
    await salvarTurno(v.dados.clienteId, v.dados.turnoId, { cor: v.dados.cor.toUpperCase(), efetivoMinimo: v.dados.efetivoMinimo });
    return null;
  });
  if (r.ok) revalidarCliente();
  return r;
}

const esquemaFuncoes = z.object({
  clienteId: id,
  minimos: z.array(z.object({ chave: z.string().min(1), minimo: inteiro("Mínimo por turno", 0, 99) })),
});

export async function salvarFuncoesAcao(entrada: z.input<typeof esquemaFuncoes>): Promise<Resultado<null>> {
  const v = validar(esquemaFuncoes, entrada);
  if (!v.ok) return falha(v.erro);
  const r = await executarCadastro(async () => {
    await salvarFuncoes(v.dados.clienteId, v.dados.minimos);
    return null;
  });
  if (r.ok) revalidarCliente();
  return r;
}

const esquemaDimensionamento = z.object({
  clienteId: id,
  dataReferencia: z.string().refine(ehValida, "Data de referência inválida."),
});

/** Dimensionamento da equipe na semana que contém a data (a capacidade muda com a fase da lei). */
export async function dimensionarAcao(clienteId: string, dataReferencia: string): Promise<Resultado<DimensionamentoDto>> {
  const v = validar(esquemaDimensionamento, { clienteId, dataReferencia });
  if (!v.ok) return falha(v.erro);
  return executarCadastro(() => dimensionarCliente(v.dados.clienteId, v.dados.dataReferencia));
}
