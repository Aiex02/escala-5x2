// Cadastro de funcionários e de suas ausências.

import { Prisma } from "@prisma/client";
import type { Ausencia, Funcionario } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deISO, paraISO } from "@/lib/datas";
import { chaveFuncao, ehValida } from "@/motor";
import type { AusenciaDto, FuncionarioDto, PreferenciaDto } from "./dto";
import { ErroCadastro } from "./erroCadastro";

function ausenciaParaDto(a: Ausencia): AusenciaDto {
  return { id: a.id, inicio: paraISO(a.inicio), fim: paraISO(a.fim), motivo: a.motivo, justificada: a.justificada };
}

function paraDto(f: Funcionario & { ausencias: Ausencia[] }): FuncionarioDto {
  return {
    id: f.id,
    matricula: f.matricula,
    nome: f.nome,
    cargo: f.cargo,
    secao: f.secao,
    ctps: f.ctps,
    cargaSemanalMin: f.cargaSemanalMin,
    preferencia: f.preferencia,
    ativo: f.ativo,
    isentoEc141: f.isentoEc141,
    horasNaoTrabalhadasMin: f.horasNaoTrabalhadasMin,
    ausencias: f.ausencias.map(ausenciaParaDto),
  };
}

export async function listarFuncionarios(clienteId: string): Promise<FuncionarioDto[]> {
  const lista = await prisma.funcionario.findMany({
    where: { clienteId },
    include: { ausencias: { orderBy: { inicio: "desc" } } },
    orderBy: { nome: "asc" },
  });
  return lista.map(paraDto);
}

export interface EntradaFuncionario {
  matricula: string;
  nome: string;
  cargo: string | null;
  secao: string | null;
  ctps: string | null;
  cargaSemanalMin: number | null;
  preferencia: PreferenciaDto | null;
  ativo: boolean;
  isentoEc141: boolean;
  horasNaoTrabalhadasMin: number | null;
}

/** Cria (`id` nulo) ou atualiza um funcionário do cliente. */
export async function salvarFuncionario(clienteId: string, id: string | null, dados: EntradaFuncionario): Promise<FuncionarioDto> {
  const data = { ...dados, matricula: dados.matricula.trim(), nome: dados.nome.trim() };
  try {
    if (id === null) {
      const criado = await prisma.funcionario.create({
        data: { ...data, clienteId },
        include: { ausencias: true },
      });
      return paraDto(criado);
    }
    const existente = await prisma.funcionario.findFirst({ where: { id, clienteId }, select: { id: true } });
    if (!existente) throw new ErroCadastro("Funcionário não encontrado.");
    const atualizado = await prisma.funcionario.update({ where: { id }, data, include: { ausencias: true } });
    return paraDto(atualizado);
  } catch (erro) {
    if (erro instanceof Prisma.PrismaClientKnownRequestError && erro.code === "P2002") {
      throw new ErroCadastro(`Já existe um funcionário com a matrícula ${data.matricula} neste cliente.`);
    }
    throw erro;
  }
}

export async function definirAtivo(clienteId: string, id: string, ativo: boolean): Promise<void> {
  const { count } = await prisma.funcionario.updateMany({ where: { id, clienteId }, data: { ativo } });
  if (count === 0) throw new ErroCadastro("Funcionário não encontrado.");
}

/** Exclui o funcionário; quem já tem escala gerada deve ser inativado, para não perder o histórico. */
export async function excluirFuncionario(clienteId: string, id: string): Promise<void> {
  const funcionario = await prisma.funcionario.findFirst({
    where: { id, clienteId },
    select: { nome: true, _count: { select: { alocacoes: true } } },
  });
  if (!funcionario) throw new ErroCadastro("Funcionário não encontrado.");
  if (funcionario._count.alocacoes > 0) {
    throw new ErroCadastro(`${funcionario.nome} tem dias em escalas já geradas. Inative o funcionário em vez de excluir.`);
  }
  await prisma.funcionario.delete({ where: { id } });
}

export interface EntradaAusencia {
  inicio: string;
  fim: string;
  motivo: string | null;
  justificada: boolean;
}

export async function adicionarAusencia(clienteId: string, funcionarioId: string, dados: EntradaAusencia): Promise<AusenciaDto> {
  if (!ehValida(dados.inicio) || !ehValida(dados.fim)) throw new ErroCadastro("Informe datas válidas para a ausência.");
  if (dados.fim < dados.inicio) throw new ErroCadastro("O fim da ausência não pode ser antes do início.");
  const funcionario = await prisma.funcionario.findFirst({ where: { id: funcionarioId, clienteId }, select: { id: true } });
  if (!funcionario) throw new ErroCadastro("Funcionário não encontrado.");
  const criada = await prisma.ausencia.create({
    data: {
      funcionarioId,
      inicio: deISO(dados.inicio),
      fim: deISO(dados.fim),
      motivo: dados.motivo,
      justificada: dados.justificada,
    },
  });
  return ausenciaParaDto(criada);
}

export async function removerAusencia(clienteId: string, ausenciaId: string): Promise<void> {
  const { count } = await prisma.ausencia.deleteMany({ where: { id: ausenciaId, funcionario: { clienteId } } });
  if (count === 0) throw new ErroCadastro("Ausência não encontrada.");
}

/** Renomeia um cargo em todos os funcionários do cliente que o têm exatamente igual (`de`). Se `para` já existe, os grupos se unem. */
export async function renomearCargo(clienteId: string, de: string, para: string): Promise<{ afetados: number }> {
  if (de === para) return { afetados: 0 };
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.funcionario.updateMany({ where: { clienteId, cargo: de }, data: { cargo: para } });
    if (count === 0) throw new ErroCadastro("Nenhum funcionário tem o cargo informado.");

    const chaveDe = chaveFuncao(de);
    const chavePara = chaveFuncao(para);
    if (chaveDe !== chavePara) {
      const restantes = await tx.funcionario.findMany({ where: { clienteId, cargo: { not: null } }, select: { cargo: true } });
      const aindaUsada = restantes.some((f) => f.cargo !== null && chaveFuncao(f.cargo) === chaveDe);
      if (!aindaUsada) {
        const minimoDe = await tx.funcaoMinima.findUnique({ where: { clienteId_funcao: { clienteId, funcao: chaveDe } } });
        if (minimoDe) {
          const minimoPara = await tx.funcaoMinima.findUnique({ where: { clienteId_funcao: { clienteId, funcao: chavePara } } });
          // Chave vazia (cargo só com símbolos) não é função: a linha some em vez de migrar.
          if (minimoPara || chavePara === "") {
            await tx.funcaoMinima.delete({ where: { clienteId_funcao: { clienteId, funcao: chaveDe } } });
          } else {
            await tx.funcaoMinima.update({
              where: { clienteId_funcao: { clienteId, funcao: chaveDe } },
              data: { funcao: chavePara },
            });
          }
        }
      }
    }
    return { afetados: count };
  });
}
