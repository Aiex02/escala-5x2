// Cadastro de clientes: criação (com modelo de funcionamento), renomeação e exclusão.

import { prisma } from "@/lib/db";
import { deISO } from "@/lib/datas";
import {
  PUBLICACAO_EC141_PADRAO,
  MODELO_PADRAO,
  buscarModelo,
  funcionamentoDoModelo,
  gerarTurnos,
  regrasDoModelo,
} from "@/motor";
import { inicioSemanaParaDb } from "./mapeadores";
import { gravarJanelas, sincronizarTurnos } from "./configuracao";
import { ErroCadastro } from "./erroCadastro";

export interface ClienteResumo {
  id: string;
  nome: string;
}

export async function listarClientes(): Promise<ClienteResumo[]> {
  return prisma.cliente.findMany({ select: { id: true, nome: true }, orderBy: { nome: "asc" } });
}

function validarNome(nome: string): string {
  const limpo = nome.trim().replace(/\s+/g, " ");
  if (limpo.length < 2) throw new ErroCadastro("Informe o nome do cliente (ao menos 2 letras).");
  if (limpo.length > 80) throw new ErroCadastro("O nome do cliente deve ter até 80 caracteres.");
  return limpo;
}

async function garantirNomeLivre(nome: string, exceto?: string): Promise<void> {
  const igual = await prisma.cliente.findFirst({
    where: { nome: { equals: nome, mode: "insensitive" }, ...(exceto ? { id: { not: exceto } } : {}) },
    select: { id: true },
  });
  if (igual) throw new ErroCadastro("Já existe um cliente com esse nome.");
}

/**
 * Cria o cliente com as regras, as janelas e os turnos do modelo.
 * `modelo = null` cria um cliente "personalizado", partindo do funcionamento do modelo padrão.
 */
export async function criarCliente(entrada: { nome: string; modelo: string | null }): Promise<{ id: string }> {
  const nome = validarNome(entrada.nome);
  if (entrada.modelo !== null && !buscarModelo(entrada.modelo)) {
    throw new ErroCadastro("Modelo de funcionamento desconhecido.");
  }
  await garantirNomeLivre(nome);

  const base = entrada.modelo ?? MODELO_PADRAO;
  const regras = regrasDoModelo(base);
  const { janelas, jornadaMin, intervaloMin } = funcionamentoDoModelo(base);
  const gerados = gerarTurnos(janelas, jornadaMin, intervaloMin);

  const id = await prisma.$transaction(async (tx) => {
    const cliente = await tx.cliente.create({
      data: {
        nome,
        regras: {
          create: {
            cargaSemanalMaxMin: regras.cargaSemanalMaxMin,
            jornadaDiariaMaxMin: regras.jornadaDiariaMaxMin,
            descansoEntreJornadasMin: regras.descansoEntreJornadasMin,
            maxDiasConsecutivos: regras.maxDiasConsecutivos,
            inicioSemana: inicioSemanaParaDb(regras.inicioSemana),
            folgasSemanaisMin: regras.folgasSemanaisMin,
            domingosSeguidosMax: regras.domingosSeguidosMax,
            regime: "EC141",
            ec141Publicacao: deISO(PUBLICACAO_EC141_PADRAO),
            jornadaPadraoMin: jornadaMin,
            intervaloPadraoMin: intervaloMin,
            modelo: entrada.modelo,
          },
        },
      },
      select: { id: true },
    });
    await gravarJanelas(tx, cliente.id, janelas);
    await sincronizarTurnos(tx, cliente.id, gerados);
    return cliente.id;
  });
  return { id };
}

export async function renomearCliente(id: string, nomeNovo: string): Promise<void> {
  const nome = validarNome(nomeNovo);
  await garantirNomeLivre(nome, id);
  await prisma.cliente.update({ where: { id }, data: { nome } });
}

/** Apaga o cliente e tudo que depende dele (cascata no banco). */
export async function excluirCliente(id: string): Promise<void> {
  await prisma.cliente.delete({ where: { id } });
}
