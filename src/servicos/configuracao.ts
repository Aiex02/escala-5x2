// Configuração do cliente: modelo de funcionamento, regras da empresa, turnos, regime legal e funções.

import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deISO, hojeISO } from "@/lib/datas";
import { proximaCorLivre } from "@/lib/coresTurno";
import {
  buscarModelo,
  chaveFuncao,
  ehValida,
  errosDasRegras,
  funcionamentoDoModelo,
  gerarTurnos,
  regrasDoModelo,
  type JanelaDia,
  type RegrasCarga,
  type TurnoGerado,
} from "@/motor";
import { inicioSemanaParaDb, inicioSemanaParaMotor, publicacaoEc141 } from "./mapeadores";
import { dimensionarCliente } from "./dimensionamento";
import type { ConfiguracaoDto, FuncaoDto, RegimeDto, TurnoDto } from "./dto";
import { ErroCadastro } from "./erroCadastro";

type Transacao = Prisma.TransactionClient;

const chaveHorario = (inicio: number, fim: number, intervalo: number) => `${inicio}|${fim}|${intervalo}`;

/**
 * Faz os turnos do cliente refletirem os `gerados`:
 * - turnos com o mesmo horário (início/fim/intervalo) continuam (id, cor e efetivo mínimo ficam);
 * - os que deixam de existir são arquivados (se têm alocações) ou excluídos;
 * - os novos ganham a próxima cor livre.
 */
export async function sincronizarTurnos(tx: Transacao, clienteId: string, gerados: readonly TurnoGerado[]): Promise<void> {
  const existentes = await tx.turno.findMany({ where: { clienteId }, orderBy: { ordem: "asc" } });
  const livres = new Map<string, (typeof existentes)[number][]>();
  // Turnos ativos têm preferência sobre arquivados na hora de casar horários iguais.
  for (const t of [...existentes].sort((a, b) => Number(a.arquivado) - Number(b.arquivado))) {
    const chave = chaveHorario(t.inicioMin, t.fimMin, t.intervaloMin);
    livres.set(chave, [...(livres.get(chave) ?? []), t]);
  }

  const casados: { existenteId: string; gerado: TurnoGerado; ordem: number }[] = [];
  const novos: { gerado: TurnoGerado; ordem: number }[] = [];
  gerados.forEach((gerado, ordem) => {
    const h = gerado.horario;
    const fila = livres.get(chaveHorario(h.inicioMin, h.fimMin, h.intervaloMin));
    const achado = fila?.shift();
    if (achado) casados.push({ existenteId: achado.id, gerado, ordem });
    else novos.push({ gerado, ordem });
  });

  const idsCasados = new Set(casados.map((c) => c.existenteId));
  for (const t of existentes) {
    if (idsCasados.has(t.id) || t.arquivado) continue;
    const alocacoes = await tx.alocacao.count({ where: { turnoId: t.id } });
    if (alocacoes > 0) {
      // Renomeia para liberar o nome (único por cliente) e preserva o histórico.
      await tx.turno.update({
        where: { id: t.id },
        data: { arquivado: true, nome: `${t.nome} (arquivado ${t.id.slice(-5)})` },
      });
    } else {
      await tx.turno.delete({ where: { id: t.id } });
    }
  }

  // Nomes provisórios evitam conflito de unicidade enquanto os nomes trocam de dono.
  for (const c of casados) {
    await tx.turno.update({ where: { id: c.existenteId }, data: { nome: `~${c.existenteId}` } });
  }
  for (const c of casados) {
    await tx.turno.update({
      where: { id: c.existenteId },
      data: { nome: c.gerado.nome, ordem: c.ordem, diasSemana: c.gerado.dias, arquivado: false },
    });
  }

  const ativos = await tx.turno.findMany({ where: { clienteId, arquivado: false }, select: { cor: true } });
  const cores = ativos.map((t) => t.cor);
  for (const n of novos) {
    const cor = proximaCorLivre(cores);
    cores.push(cor);
    const h = n.gerado.horario;
    await tx.turno.create({
      data: {
        clienteId,
        nome: n.gerado.nome,
        inicioMin: h.inicioMin,
        fimMin: h.fimMin,
        intervaloMin: h.intervaloMin,
        efetivoMinimo: 1,
        ordem: n.ordem,
        cor,
        diasSemana: n.gerado.dias,
      },
    });
  }
}

/** Grava as janelas, substituindo as anteriores. */
export async function gravarJanelas(tx: Transacao, clienteId: string, janelas: readonly JanelaDia[]): Promise<void> {
  await tx.janelaFuncionamento.deleteMany({ where: { clienteId } });
  await tx.janelaFuncionamento.createMany({
    data: janelas.map((j) => ({ clienteId, dia: j.dia, abreMin: j.abreMin, fechaMin: j.fechaMin })),
  });
}

function turnoParaDto(t: {
  id: string;
  nome: string;
  inicioMin: number;
  fimMin: number;
  intervaloMin: number;
  efetivoMinimo: number;
  ordem: number;
  cor: string;
  diasSemana: number;
}): TurnoDto {
  return {
    id: t.id,
    nome: t.nome,
    inicioMin: t.inicioMin,
    fimMin: t.fimMin,
    intervaloMin: t.intervaloMin,
    efetivoMinimo: t.efetivoMinimo,
    ordem: t.ordem,
    cor: t.cor,
    diasSemana: t.diasSemana,
  };
}

/** Funções (cargos agrupados por `chaveFuncao`) dos funcionários ativos, com o mínimo salvo (padrão 0 = sem exigência). */
async function listarFuncoes(clienteId: string): Promise<FuncaoDto[]> {
  const [funcionarios, minimas] = await Promise.all([
    prisma.funcionario.findMany({ where: { clienteId, ativo: true, cargo: { not: null } }, select: { cargo: true } }),
    prisma.funcaoMinima.findMany({ where: { clienteId } }),
  ]);
  const grupos = new Map<string, Map<string, number>>();
  for (const f of funcionarios) {
    const cargo = f.cargo?.trim();
    if (!cargo) continue;
    const chave = chaveFuncao(cargo);
    if (!chave) continue;
    const nomes = grupos.get(chave) ?? new Map<string, number>();
    nomes.set(cargo, (nomes.get(cargo) ?? 0) + 1);
    grupos.set(chave, nomes);
  }
  const salvos = new Map(minimas.map((m) => [m.funcao, m.minimo]));
  return [...grupos.entries()]
    .map(([chave, nomes]) => {
      const ordenados = [...nomes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"));
      return {
        chave,
        nome: ordenados[0]?.[0] ?? chave,
        pessoas: [...nomes.values()].reduce((a, b) => a + b, 0),
        minimo: salvos.get(chave) ?? 0,
      };
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

export async function obterConfiguracao(clienteId: string): Promise<ConfiguracaoDto> {
  const [cliente, turnos, janelas, funcoes] = await Promise.all([
    prisma.cliente.findUnique({ where: { id: clienteId }, include: { regras: true } }),
    prisma.turno.findMany({ where: { clienteId, arquivado: false }, orderBy: { ordem: "asc" } }),
    prisma.janelaFuncionamento.findMany({ where: { clienteId }, orderBy: { dia: "asc" } }),
    listarFuncoes(clienteId),
  ]);
  if (!cliente) throw new ErroCadastro("Cliente não encontrado.");
  const r = cliente.regras;
  if (!r) throw new ErroCadastro("O cliente não tem regras configuradas.");
  // Depois do acesso ao banco: a data de hoje só pode ser lida em tempo de requisição.
  const hoje = hojeISO();
  const dimensionamento = await dimensionarCliente(clienteId, hoje);
  return {
    clienteId,
    nome: cliente.nome,
    modelo: r.modelo,
    regras: {
      cargaSemanalMaxMin: r.cargaSemanalMaxMin,
      jornadaDiariaMaxMin: r.jornadaDiariaMaxMin,
      descansoEntreJornadasMin: r.descansoEntreJornadasMin,
      maxDiasConsecutivos: r.maxDiasConsecutivos,
      inicioSemana: inicioSemanaParaMotor(r.inicioSemana),
      folgasSemanaisMin: r.folgasSemanaisMin,
      domingosSeguidosMax: r.domingosSeguidosMax,
    },
    regime: r.regime,
    publicacao: publicacaoEc141(r),
    jornadaMin: r.jornadaPadraoMin,
    intervaloMin: r.intervaloPadraoMin,
    permitirHoraExtra: r.permitirHoraExtra,
    horaExtraDiariaMaxMin: r.horaExtraDiariaMaxMin,
    janelas: janelas.map((j) => ({ dia: j.dia, abreMin: j.abreMin, fechaMin: j.fechaMin })),
    turnos: turnos.map(turnoParaDto),
    funcoes,
    dimensionamento,
    hoje,
  };
}

export interface EntradaFuncionamento {
  /** Id do modelo pronto; `null` = personalizado (usa `regras`, `janelas`, `jornadaMin` e `intervaloMin`). */
  modelo: string | null;
  regras: RegrasCarga;
  janelas: JanelaDia[];
  jornadaMin: number;
  intervaloMin: number;
}

/** Salva modelo/regras/janelas e refaz os turnos, tudo numa transação. Devolve o número de turnos ativos. */
export async function salvarFuncionamento(clienteId: string, entrada: EntradaFuncionamento): Promise<{ turnos: number }> {
  let regras = entrada.regras;
  let janelas = entrada.janelas;
  let jornadaMin = entrada.jornadaMin;
  let intervaloMin = entrada.intervaloMin;
  if (entrada.modelo !== null) {
    if (!buscarModelo(entrada.modelo)) throw new ErroCadastro("Modelo de funcionamento desconhecido.");
    regras = regrasDoModelo(entrada.modelo);
    ({ janelas, jornadaMin, intervaloMin } = funcionamentoDoModelo(entrada.modelo));
  }
  const erros = errosDasRegras(regras);
  if (erros.length > 0) throw new ErroCadastro(erros[0] ?? "Regras inválidas.");
  const dias = new Set(janelas.map((j) => j.dia));
  if (dias.size !== janelas.length) throw new ErroCadastro("Há um dia de funcionamento repetido.");
  // Lança ErroMotor (em português) se jornada, intervalo ou horários forem inválidos.
  const gerados = gerarTurnos(janelas, jornadaMin, intervaloMin);

  await prisma.$transaction(async (tx) => {
    const atual = await tx.regras.findUnique({ where: { clienteId } });
    if (!atual) throw new ErroCadastro("O cliente não tem regras configuradas.");
    await tx.regras.update({
      where: { clienteId },
      data: {
        cargaSemanalMaxMin: regras.cargaSemanalMaxMin,
        jornadaDiariaMaxMin: regras.jornadaDiariaMaxMin,
        descansoEntreJornadasMin: regras.descansoEntreJornadasMin,
        maxDiasConsecutivos: regras.maxDiasConsecutivos,
        inicioSemana: inicioSemanaParaDb(regras.inicioSemana),
        folgasSemanaisMin: regras.folgasSemanaisMin,
        domingosSeguidosMax: regras.domingosSeguidosMax,
        jornadaPadraoMin: jornadaMin,
        intervaloPadraoMin: intervaloMin,
        modelo: entrada.modelo,
      },
    });
    await gravarJanelas(tx, clienteId, janelas);
    await sincronizarTurnos(tx, clienteId, gerados);
  });
  return { turnos: gerados.length };
}

export async function salvarRegime(clienteId: string, regime: RegimeDto, publicacao: string): Promise<void> {
  if (!ehValida(publicacao)) throw new ErroCadastro("Data de publicação inválida.");
  await prisma.regras.update({
    where: { clienteId },
    data: { regime, ec141Publicacao: deISO(publicacao) },
  });
}

/** Liga/desliga a hora extra como último recurso e define o máximo por dia. */
export async function salvarHoraExtra(clienteId: string, dados: { permitirHoraExtra: boolean; horaExtraDiariaMaxMin: number }): Promise<void> {
  const atual = await prisma.regras.findUnique({ where: { clienteId }, select: { clienteId: true } });
  if (!atual) throw new ErroCadastro("O cliente não tem regras configuradas.");
  await prisma.regras.update({
    where: { clienteId },
    data: { permitirHoraExtra: dados.permitirHoraExtra, horaExtraDiariaMaxMin: dados.horaExtraDiariaMaxMin },
  });
}

/** Ajusta cor e efetivo mínimo de um turno ativo. */
export async function salvarTurno(clienteId: string, turnoId: string, dados: { cor: string; efetivoMinimo: number }): Promise<void> {
  const turno = await prisma.turno.findFirst({ where: { id: turnoId, clienteId, arquivado: false }, select: { id: true } });
  if (!turno) throw new ErroCadastro("Turno não encontrado.");
  await prisma.turno.update({ where: { id: turnoId }, data: { cor: dados.cor, efetivoMinimo: dados.efetivoMinimo } });
}

/** Grava o mínimo por função; funções sem funcionários ativos perdem a linha. */
export async function salvarFuncoes(clienteId: string, minimos: { chave: string; minimo: number }[]): Promise<void> {
  const funcoes = await listarFuncoes(clienteId);
  const validas = new Set(funcoes.map((f) => f.chave));
  const aGravar = minimos.filter((m) => validas.has(m.chave));
  await prisma.$transaction([
    prisma.funcaoMinima.deleteMany({ where: { clienteId, funcao: { notIn: [...validas] } } }),
    ...aGravar.map((m) =>
      prisma.funcaoMinima.upsert({
        where: { clienteId_funcao: { clienteId, funcao: m.chave } },
        create: { clienteId, funcao: m.chave, minimo: m.minimo },
        update: { minimo: m.minimo },
      }),
    ),
  ]);
}
