"use server";

import { z } from "zod";
import { falha, type Resultado } from "@/lib/resultado";
import { ehValida } from "@/motor";
import type { AusenciaDto, FuncionarioDto } from "@/servicos/dto";
import {
  adicionarAusencia,
  definirAtivo,
  excluirFuncionario,
  removerAusencia,
  renomearCargo,
  salvarFuncionario,
} from "@/servicos/funcionarios";
import { executarCadastro, revalidarCliente, validar } from "./executarCadastro";

const id = z.string().min(1);
const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use até ${max} caracteres.`)
    .nullish()
    .transform((t) => (t ? t : null));

const esquemaFuncionario = z.object({
  clienteId: id,
  /** `null` cria um funcionário novo. */
  id: id.nullable(),
  matricula: z.string().trim().min(1, "Informe a matrícula.").max(30, "A matrícula deve ter até 30 caracteres."),
  nome: z.string().trim().min(1, "Informe o nome.").max(120, "O nome deve ter até 120 caracteres."),
  cargo: textoOpcional(60),
  secao: textoOpcional(60),
  ctps: textoOpcional(40),
  /** Minutos por semana; `null` = regra do cliente. */
  cargaSemanalMin: z
    .number({ error: "Carga semanal inválida." })
    .int("Carga semanal inválida.")
    .min(60, "A carga semanal deve ser de pelo menos 1h.")
    .max(60 * 60, "A carga semanal deve ser de no máximo 60h.")
    .nullable(),
  preferencia: z.enum(["MANHA", "TARDE", "NOITE"]).nullable(),
  ativo: z.boolean(),
  isentoEc141: z.boolean(),
});

export async function salvarFuncionarioAcao(entrada: z.input<typeof esquemaFuncionario>): Promise<Resultado<FuncionarioDto>> {
  const v = validar(esquemaFuncionario, entrada);
  if (!v.ok) return falha(v.erro);
  const { clienteId, id: funcionarioId, ...dados } = v.dados;
  const r = await executarCadastro(() => salvarFuncionario(clienteId, funcionarioId, dados));
  if (r.ok) revalidarCliente();
  return r;
}

export async function definirAtivoAcao(clienteId: string, funcionarioId: string, ativo: boolean): Promise<Resultado<null>> {
  const v = validar(z.object({ clienteId: id, funcionarioId: id, ativo: z.boolean() }), { clienteId, funcionarioId, ativo });
  if (!v.ok) return falha(v.erro);
  const r = await executarCadastro(async () => {
    await definirAtivo(v.dados.clienteId, v.dados.funcionarioId, v.dados.ativo);
    return null;
  });
  if (r.ok) revalidarCliente();
  return r;
}

export async function excluirFuncionarioAcao(clienteId: string, funcionarioId: string): Promise<Resultado<null>> {
  const v = validar(z.object({ clienteId: id, funcionarioId: id }), { clienteId, funcionarioId });
  if (!v.ok) return falha(v.erro);
  const r = await executarCadastro(async () => {
    await excluirFuncionario(v.dados.clienteId, v.dados.funcionarioId);
    return null;
  });
  if (r.ok) revalidarCliente();
  return r;
}

const esquemaAusencia = z.object({
  clienteId: id,
  funcionarioId: id,
  inicio: z.string().refine(ehValida, "Informe a data de início."),
  fim: z.string().refine(ehValida, "Informe a data de fim."),
  motivo: textoOpcional(120),
  justificada: z.boolean(),
});

export async function adicionarAusenciaAcao(entrada: z.input<typeof esquemaAusencia>): Promise<Resultado<AusenciaDto>> {
  const v = validar(esquemaAusencia, entrada);
  if (!v.ok) return falha(v.erro);
  const { clienteId, funcionarioId, ...dados } = v.dados;
  const r = await executarCadastro(() => adicionarAusencia(clienteId, funcionarioId, dados));
  if (r.ok) revalidarCliente();
  return r;
}

export async function removerAusenciaAcao(clienteId: string, ausenciaId: string): Promise<Resultado<null>> {
  const v = validar(z.object({ clienteId: id, ausenciaId: id }), { clienteId, ausenciaId });
  if (!v.ok) return falha(v.erro);
  const r = await executarCadastro(async () => {
    await removerAusencia(v.dados.clienteId, v.dados.ausenciaId);
    return null;
  });
  if (r.ok) revalidarCliente();
  return r;
}

const esquemaRenomearCargo = z.object({
  clienteId: id,
  de: z.string().trim().min(1, "Informe o cargo atual."),
  para: z.string().trim().min(1, "Informe o novo nome do cargo.").max(60, "O cargo deve ter até 60 caracteres."),
});

export async function renomearCargoAcao(entrada: z.input<typeof esquemaRenomearCargo>): Promise<Resultado<{ afetados: number }>> {
  const v = validar(esquemaRenomearCargo, entrada);
  if (!v.ok) return falha(v.erro);
  const { clienteId, de, para } = v.dados;
  const r = await executarCadastro(() => renomearCargo(clienteId, de, para));
  if (r.ok) revalidarCliente();
  return r;
}
