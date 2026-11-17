// Agenda do mês: leitura (Quadro, Mês, Semana), ajuste de um dia e exclusão do mês.

import type { Ausencia as AusenciaDb, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deISO, paraISO } from "@/lib/datas";
import {
  type Alocacao,
  chaveFuncao,
  datasDoIntervalo,
  descreverRegraDasSemanas,
  type DataISO,
  diaDaSemana,
  ehValida,
  faseVigenteEm,
  formatarDataBR,
  formatarDiaMes,
  formatarHora,
  formatarMinutos,
  funcoesDescobertas,
  horarioDoFuncionario,
  intervaloDoFuncionario,
  pessoasPorTurnoDia,
  semanasCobrindo,
  somarDias,
  verificarEscala,
} from "@/motor";
import {
  type AgendaMesDto,
  type AvisoAgendaDto,
  type CelulaDto,
  type FaseDto,
  type GrupoFuncaoDto,
  type HorasSemanaDto,
  type LacunaDto,
  type LinhaFuncionarioDto,
  type SemanaDto,
  siglasDosTurnos,
  type TipoAvisoDto,
  type TurnoAgendaDto,
  type ValorDia,
} from "./agendaDto";
import { dimensionarContexto } from "./dimensionamento";
import {
  alocacaoParaMotor,
  alocacoesEntre,
  calcularSaldosAnteriores,
  carregarContexto,
  conjuntoDiasFechados,
  carregarPrevistos,
  type ContextoCliente,
  criarDiaPlanejado,
  ErroAgenda,
  gravarPrevistos,
  JANELA_VIZINHOS_DIAS,
  limitesDoMes,
  montarEntrada,
  planoDoFuncionario,
  resumirSemanas,
  semanaFechada,
  validarAnoMes,
} from "./planejamento";

const TIPOS_AO_VIVO: readonly string[] = ["coberturaInsuficiente", "funcaoDescoberta", "violacaoRegra", "coberturaParcial", "excessoSemanal"];
/** Avisos gravados que dependem do quadro e ficam defasados a cada ajuste. */
const TIPOS_DEFASAM_NO_AJUSTE = ["cargaAbaixoDoAlvo", "coberturaInsuficiente", "funcaoDescoberta", "violacaoRegra", "horaExtra", "coberturaParcial", "excessoSemanal"];
const TIPOS_AVISO = new Set<string>([
  "coberturaInsuficiente",
  "turnoExcedeJornada",
  "funcionarioSemTurno",
  "cargaAbaixoDoAlvo",
  "violacaoRegra",
  "funcaoDescoberta",
  "coberturaParcial",
  "horaExtra",
  "excessoSemanal",
]);

/** Minutos trabalhados na jornada (bruto menos intervalo). */
function minutosDe(a: Alocacao): number {
  const h = a.horario;
  const bruto = h.fimMin <= h.inicioMin ? 1440 - h.inicioMin + h.fimMin : h.fimMin - h.inicioMin;
  return Math.max(0, bruto - h.intervaloMin);
}

type Janela = readonly [number, number];

function janelaDe(inicioMin: number, fimMin: number): Janela {
  return [inicioMin, fimMin <= inicioMin ? fimMin + 1440 : fimMin];
}

/** Maior trecho contínuo de `janela` fora da união de `cobertas` (null se tudo coberto). */
function maiorDescoberto(janela: Janela, cobertas: readonly Janela[]): Janela | null {
  const ordenadas = [...cobertas].sort((a, b) => a[0] - b[0]);
  let melhor: Janela | null = null;
  let cursor = janela[0];
  const considerar = (a: number, b: number): void => {
    if (b > a && (!melhor || b - a > melhor[1] - melhor[0])) melhor = [a, b];
  };
  for (const [a, b] of ordenadas) {
    considerar(cursor, Math.min(a, janela[1]));
    cursor = Math.max(cursor, b);
  }
  considerar(cursor, janela[1]);
  return melhor;
}

/**
 * Hora extra de outros turnos no mesmo dia que se sobrepõe à janela do turno. Cada pessoa conta
 * uma vez; `max` limita quantas entram (o tamanho do furo). Fica com as de maior sobreposição.
 */
function sobreposicoesDeExtra(
  alocacoes: readonly Alocacao[],
  turnoId: string,
  janela: Janela,
  filtro: (a: Alocacao) => boolean,
  max: number,
): Janela[] {
  const achadas: Janela[] = [];
  for (const a of alocacoes) {
    if (a.origem !== "horaExtra" || a.turnoId === turnoId || !filtro(a)) continue;
    const [ini, fim] = janelaDe(a.horario.inicioMin, a.horario.fimMin);
    const de = Math.max(ini, janela[0]);
    const ate = Math.min(fim, janela[1]);
    if (ate > de) achadas.push([de, ate]);
  }
  return achadas.sort((x, y) => y[1] - y[0] - (x[1] - x[0])).slice(0, Math.max(0, max));
}

function resumoDaFase(cargaMin: number, folgas: number): string {
  return `${formatarMinutos(cargaMin)} · ${folgas} ${folgas === 1 ? "folga" : "folgas"}`;
}

/** Agenda do mês: grade de células por funcionário e dia, horas, saldos, totais e avisos. */
export async function obterAgenda(clienteId: string, ano: number, mes: number): Promise<AgendaMesDto> {
  validarAnoMes(ano, mes);
  const ctx = await carregarContexto(prisma, clienteId);
  const { inicio, fim } = limitesDoMes(ano, mes);
  const datas = datasDoIntervalo(inicio, fim);
  const mesGerado = ctx.meses.find((m) => m.ano === ano && m.mes === mes);
  const gerado = mesGerado !== undefined;
  const diaPlanejado = criarDiaPlanejado(ctx.meses);

  const janelaIni = somarDias(inicio, -JANELA_VIZINHOS_DIAS);
  const janelaFim = somarDias(fim, JANELA_VIZINHOS_DIAS);
  const [alocacoesJanela, ajustes, avisosGravados] = await Promise.all([
    alocacoesEntre(prisma, clienteId, janelaIni, janelaFim),
    prisma.ajusteManual.findMany({ where: { clienteId, data: { gte: deISO(inicio), lte: deISO(fim) } } }),
    gerado ? prisma.avisoMes.findMany({ where: { clienteId, ano, mes }, orderBy: [{ data: "asc" }] }) : Promise.resolve([]),
  ]);
  const alocacoesMotor = alocacoesJanela.map(alocacaoParaMotor);
  const doMes = alocacoesMotor.filter((a) => a.data >= inicio && a.data <= fim);
  const comAlocacaoNoMes = new Set(doMes.map((a) => a.funcionarioId));
  const listados = ctx.funcionarios.filter((f) => f.ativo || comAlocacaoNoMes.has(f.id));
  const ajustados = new Set(ajustes.map((a) => `${a.funcionarioId}|${paraISO(a.data)}`));

  // Turnos: os em uso e os arquivados que aparecem no mês.
  const usadosNoMes = new Set(doMes.map((a) => a.turnoId));
  const turnosVisiveis = ctx.turnosDb.filter((t) => !t.arquivado || usadosNoMes.has(t.id));
  const siglas = siglasDosTurnos(turnosVisiveis.map((t) => t.nome));
  const turnos: TurnoAgendaDto[] = turnosVisiveis.map((t, i) => ({
    id: t.id,
    nome: t.nome,
    sigla: siglas[i] ?? t.nome.slice(0, 1).toUpperCase(),
    cor: t.cor,
    inicioMin: t.inicioMin,
    fimMin: t.fimMin,
    intervaloMin: t.intervaloMin,
    efetivoMinimo: t.efetivoMinimo,
    diasSemana: t.diasSemana,
    arquivado: t.arquivado,
  }));
  const turnoPorId = new Map(ctx.turnosDb.map((t) => [t.id, t]));

  // Dias do mês e se o estabelecimento abre.
  const temJanelas = ctx.janelas.length > 0;
  const dias = datas.map((data) => {
    const diaSemana = diaDaSemana(data);
    const aberto = temJanelas
      ? ctx.janelas.some((j) => j.dia === diaSemana && j.fechaMin !== j.abreMin)
      : ctx.turnosAtivos.some((t) => (t.dias & (1 << diaSemana)) !== 0);
    const fechado = ctx.diasFechados.has(data);
    return { data, diaSemana, aberto: aberto && !fechado, fechado, fechadoMotivo: fechado ? (ctx.diasFechados.get(data) ?? null) : null };
  });

  // Células.
  const alocPorChave = new Map<string, Alocacao>(alocacoesMotor.map((a) => [`${a.funcionarioId}|${a.data}`, a]));
  const celulaDe = (
    f: { id: string; ausencias: readonly AusenciaDb[]; horasNaoTrabalhadasMin: number | null },
    ausenciaDia: Map<DataISO, { justificada: boolean; motivo: string | null }>,
    data: DataISO,
    aberto: boolean,
  ): CelulaDto => {
    const ajustada = ajustados.has(`${f.id}|${data}`);
    const a = alocPorChave.get(`${f.id}|${data}`);
    if (a) {
      const t = turnoPorId.get(a.turnoId);
      // O horário normal da pessoa no turno já traz a hora não trabalhada dela; só o que
      // diferir disso é jornada compensada.
      const normal = t ? (horarioDoFuncionario(f, { inicioMin: t.inicioMin, fimMin: t.fimMin, intervaloMin: t.intervaloMin }) ?? t) : null;
      const compensada = normal
        ? normal.inicioMin !== a.horario.inicioMin || normal.fimMin !== a.horario.fimMin || normal.intervaloMin !== a.horario.intervaloMin
        : false;
      const origem = a.origem ?? "normal";
      const extraMin = origem === "horaExtra" ? Math.max(0, minutosDe(a) - ctx.regrasDb.jornadaPadraoMin) : 0;
      return { tipo: "turno", turnoId: a.turnoId, inicioMin: a.horario.inicioMin, fimMin: a.horario.fimMin, intervaloMin: a.horario.intervaloMin, compensada, origem, extraMin, ajustada };
    }
    if (ctx.diasFechados.has(data)) return { tipo: "fechado", ajustada };
    const aus = ausenciaDia.get(data);
    if (aus) return aus.justificada ? { tipo: "justificada", motivo: aus.motivo, ajustada } : { tipo: "falta", ajustada };
    return aberto ? { tipo: "folga", ajustada } : { tipo: "fechado", ajustada };
  };
  const ausenciasPorDia = (f: { ausencias: readonly AusenciaDb[] }, de: DataISO, ate: DataISO) => {
    const mapa = new Map<DataISO, { justificada: boolean; motivo: string | null }>();
    for (const au of f.ausencias) {
      const ini = paraISO(au.inicio) > de ? paraISO(au.inicio) : de;
      const fi = paraISO(au.fim) < ate ? paraISO(au.fim) : ate;
      if (fi < ini) continue;
      for (const d of datasDoIntervalo(ini, fi)) mapa.set(d, { justificada: au.justificada, motivo: au.motivo });
    }
    return mapa;
  };

  // Semanas, previsto e saldo.
  const semanasMotor = semanasCobrindo(inicio, fim, ctx.regras.inicioSemana);
  const saldos = gerado ? await calcularSaldosAnteriores(prisma, ctx, inicio) : new Map<string, number>();
  const gravados = semanasMotor.length > 0
    ? await carregarPrevistos(prisma, clienteId, semanasMotor[0]?.inicio ?? inicio, semanasMotor[semanasMotor.length - 1]?.inicio ?? fim)
    : new Map<string, number>();
  const linhasSemana = gerado
    ? resumirSemanas({
        ctx,
        semanas: semanasMotor,
        funcionarios: listados,
        turnos: ctx.turnosAtivos,
        alocacoes: alocacoesMotor,
        diaPlanejado,
        gravados,
        saldosAnteriores: saldos,
      })
    : [];
  const saldoMes = new Map<string, number>();
  const porSemanaFunc = new Map<string, HorasSemanaDto>();
  for (const l of linhasSemana) {
    const horaExtraMin = l.semana.dias().reduce((t, d) => {
      const al = alocPorChave.get(`${l.funcionarioId}|${d}`);
      return al && al.origem === "horaExtra" ? t + Math.max(0, minutosDe(al) - ctx.regrasDb.jornadaPadraoMin) : t;
    }, 0);
    porSemanaFunc.set(`${l.semana.inicio}|${l.funcionarioId}`, { feitoMin: l.feitoMin, previstoMin: l.previstoMin, limiteMin: l.limiteMin, saldoMin: l.saldoMin, horaExtraMin });
    if (l.fechada && l.temMovimento) saldoMes.set(l.funcionarioId, (saldoMes.get(l.funcionarioId) ?? 0) + l.saldoMin);
  }

  // Linhas por funcionário, agrupadas por função.
  const minutosNoMes = new Map<string, number>();
  for (const a of doMes) {
    const t = a.horario;
    const bruto = t.fimMin <= t.inicioMin ? 1440 - t.inicioMin + t.fimMin : t.fimMin - t.inicioMin;
    minutosNoMes.set(a.funcionarioId, (minutosNoMes.get(a.funcionarioId) ?? 0) + Math.max(0, bruto - t.intervaloMin));
  }
  const linhas = new Map<string, { chave: string; cargo: string | null; linha: LinhaFuncionarioDto }>();
  for (const f of listados) {
    const mapaAus = ausenciasPorDia(f, inicio, fim);
    const saldoAnterior = saldos.get(f.id) ?? 0;
    const celulasLinha = dias.map((d) => celulaDe(f, mapaAus, d.data, d.aberto));
    const saldo = saldoMes.get(f.id) ?? 0;
    const cargo = f.cargo?.trim() || null;
    linhas.set(f.id, {
      chave: cargo ? chaveFuncao(cargo) : "",
      cargo,
      linha: {
        funcionarioId: f.id,
        nome: f.nome,
        cargo,
        ativo: f.ativo,
        celulas: celulasLinha,
        horasNaoTrabalhadasMin: f.horasNaoTrabalhadasMin,
        horasMesMin: minutosNoMes.get(f.id) ?? 0,
        saldoMesMin: saldo,
        saldoAnteriorMin: saldoAnterior,
        acumuladoMin: saldoAnterior + saldo,
        horaExtraMesMin: celulasLinha.reduce((t, c) => t + (c.tipo === "turno" ? c.extraMin : 0), 0),
      },
    });
  }
  const porGrupo = new Map<string, { cargos: Map<string, number>; linhas: LinhaFuncionarioDto[] }>();
  for (const { chave, cargo, linha } of linhas.values()) {
    const g = porGrupo.get(chave) ?? { cargos: new Map<string, number>(), linhas: [] };
    if (cargo) g.cargos.set(cargo, (g.cargos.get(cargo) ?? 0) + 1);
    g.linhas.push(linha);
    porGrupo.set(chave, g);
  }
  const grupos: GrupoFuncaoDto[] = [...porGrupo.entries()]
    .map(([chave, g]) => ({
      chave,
      nome: chave === "" ? "Sem função" : ([...g.cargos.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? chave),
      linhas: g.linhas.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    }))
    .sort((a, b) => (a.chave === "" ? 1 : b.chave === "" ? -1 : a.nome.localeCompare(b.nome, "pt-BR")));

  // Semanas para a visão Semana.
  const semanas: SemanaDto[] = gerado
    ? semanasMotor.map((s) => {
        const porFuncionario: Record<string, HorasSemanaDto> = {};
        const foraDoMes: Record<string, Record<DataISO, CelulaDto>> = {};
        for (const f of listados) {
          const h = porSemanaFunc.get(`${s.inicio}|${f.id}`);
          if (h) porFuncionario[f.id] = h;
          const foras = s.dias().filter((d) => d < inicio || d > fim);
          if (foras.length > 0) {
            const mapaAus = ausenciasPorDia(f, s.inicio, s.fim);
            for (const d of foras) {
              if (!diaPlanejado(d) && !alocPorChave.has(`${f.id}|${d}`)) continue;
              (foraDoMes[f.id] ??= {})[d] = celulaDe(f, mapaAus, d, true);
            }
          }
        }
        return {
          inicio: s.inicio,
          fim: s.fim,
          fechada: semanaFechada(s, diaPlanejado),
          dias: s.dias().map((d) => ({ data: d, diaSemana: diaDaSemana(d), noMes: d >= inicio && d <= fim })),
          porFuncionario,
          foraDoMes,
        };
      })
    : [];

  // Totais por turno e dia; lacunas de cobertura.
  const porTurnoDia = pessoasPorTurnoDia(doMes);
  const totaisPorTurno = turnos.map((t) => ({ turnoId: t.id, porDia: datas.map((d) => porTurnoDia.get(d)?.get(t.id) ?? 0) }));
  const trabalhandoPorDia = datas.map((d) => {
    let n = 0;
    for (const c of porTurnoDia.get(d)?.values() ?? []) n += c;
    return n;
  });
  const lacunas: LacunaDto[] = [];
  const alocPorDia = new Map<DataISO, Alocacao[]>();
  for (const a of doMes) {
    const l = alocPorDia.get(a.data);
    if (l) l.push(a);
    else alocPorDia.set(a.data, [a]);
  }
  const alocacoesDoDia = (data: DataISO): readonly Alocacao[] => alocPorDia.get(data) ?? [];
  const funcaoDoFuncionario = new Map(listados.map((f) => [f.id, f.cargo?.trim() ? chaveFuncao(f.cargo.trim()) : ""]));
  const avisosAoVivo: AvisoAgendaDto[] = [];
  if (gerado) {
    const nomeTurno = new Map(ctx.turnosDb.map((t) => [t.id, t.nome]));
    for (const t of ctx.turnosAtivos) {
      if (t.efetivoMinimo <= 0) continue;
      datas.forEach((data, i) => {
        if (ctx.diasFechados.has(data)) return;
        if ((t.dias & (1 << diaDaSemana(data))) === 0) return;
        const presentes = totaisPorTurno.find((x) => x.turnoId === t.id)?.porDia[i] ?? 0;
        if (presentes < t.efetivoMinimo) {
          const falta = t.efetivoMinimo - presentes;
          const extras = sobreposicoesDeExtra(alocacoesDoDia(data), t.id, janelaDe(t.horario.inicioMin, t.horario.fimMin), () => true, falta);
          if (extras.length >= falta) {
            const descoberto = maiorDescoberto(janelaDe(t.horario.inicioMin, t.horario.fimMin), extras);
            if (!descoberto) return;
            lacunas.push({ data, turnoId: t.id, tipo: "efetivo", funcao: null, presentes, minimo: t.efetivoMinimo, parcial: { inicioMin: descoberto[0], fimMin: descoberto[1] }, cobertoPorExtra: true });
            avisosAoVivo.push({
              tipo: "coberturaParcial",
              data,
              turnoId: t.id,
              funcionarioId: null,
              mensagem: `Turno ${t.nome} de ${formatarDiaMes(data)} descoberto das ${formatarHora(descoberto[0])} às ${formatarHora(descoberto[1])}.`,
            });
            return;
          }
          lacunas.push({ data, turnoId: t.id, tipo: "efetivo", funcao: null, presentes, minimo: t.efetivoMinimo, parcial: null, cobertoPorExtra: false });
          avisosAoVivo.push({
            tipo: "coberturaInsuficiente",
            data,
            turnoId: t.id,
            funcionarioId: null,
            mensagem: `${formatarDataBR(data)}: turno ${t.nome} com ${presentes} de ${t.efetivoMinimo} pessoa(s) mínimas.`,
          });
        }
      });
    }
    const entrada = await montarEntrada(prisma, ctx, ano, mes, inicio, { funcionarios: { alemDosAtivos: comAlocacaoNoMes }, alocacoesDaJanela: alocacoesJanela });
    const minimos = entrada.minimoPorFuncao;
    const descobertas = funcoesDescobertas({
      datas,
      alocacoes: doMes,
      funcionarios: listados.map((f) => planoDoFuncionario(f, inicio, fim)),
      turnos: ctx.turnosAtivos,
      minimoPorFuncao: minimos,
      diasFechados: conjuntoDiasFechados(ctx),
    });
    // Um aviso por função, turno e semana, listando os dias.
    const agrupado = new Map<string, { d: (typeof descobertas)[number]; dias: DataISO[] }>();
    for (const d of descobertas) {
      if (ctx.diasFechados.has(d.data)) continue;
      const turnoDb = turnoPorId.get(d.turnoId);
      const janela = turnoDb ? janelaDe(turnoDb.inicioMin, turnoDb.fimMin) : null;
      if (janela) {
        const extras = sobreposicoesDeExtra(alocacoesDoDia(d.data), d.turnoId, janela, (a) => funcaoDoFuncionario.get(a.funcionarioId) === d.funcao, d.minimo - d.presentes);
        if (extras.length >= d.minimo - d.presentes) {
          const descoberto = maiorDescoberto(janela, extras);
          if (!descoberto) continue;
          lacunas.push({ data: d.data, turnoId: d.turnoId, tipo: "funcao", funcao: d.nome, presentes: d.presentes, minimo: d.minimo, parcial: { inicioMin: descoberto[0], fimMin: descoberto[1] }, cobertoPorExtra: true });
          avisosAoVivo.push({
            tipo: "coberturaParcial",
            data: d.data,
            turnoId: d.turnoId,
            funcionarioId: null,
            mensagem: `${d.nome}: turno ${nomeTurno.get(d.turnoId) ?? "?"} de ${formatarDiaMes(d.data)} descoberto das ${formatarHora(descoberto[0])} às ${formatarHora(descoberto[1])}.`,
          });
          continue;
        }
      }
      lacunas.push({ data: d.data, turnoId: d.turnoId, tipo: "funcao", funcao: d.nome, presentes: d.presentes, minimo: d.minimo, parcial: null, cobertoPorExtra: false });
      const semana = semanasMotor.find((s) => s.contem(d.data))?.inicio ?? d.data;
      const chave = `${semana}|${d.funcao}|${d.turnoId}`;
      const g = agrupado.get(chave) ?? { d, dias: [] };
      g.dias.push(d.data);
      agrupado.set(chave, g);
    }
    for (const { d, dias: ds } of agrupado.values()) {
      avisosAoVivo.push({
        tipo: "funcaoDescoberta",
        data: ds[0] ?? null,
        turnoId: d.turnoId,
        funcionarioId: null,
        mensagem: `${d.nome}: turno ${nomeTurno.get(d.turnoId) ?? "?"} sem o mínimo de ${d.minimo} pessoa(s) da função em ${ds.map(formatarDiaMes).join(", ")}.`,
      });
    }
    for (const v of verificarEscala(entrada, doMes)) {
      avisosAoVivo.push({
        tipo: "violacaoRegra",
        data: v.data ?? null,
        turnoId: v.turnoId ?? null,
        funcionarioId: v.funcionarioId ?? null,
        mensagem: v.mensagem,
      });
    }
    // Semana acima do limite (feito > limite): ao vivo, a partir do resumo semanal.
    const nomeDe = new Map(listados.map((f) => [f.id, f.nome]));
    for (const l of linhasSemana) {
      if (l.feitoMin <= l.limiteMin) continue;
      avisosAoVivo.push({
        tipo: "excessoSemanal",
        data: l.semana.inicio < inicio ? inicio : l.semana.inicio,
        turnoId: null,
        funcionarioId: l.funcionarioId,
        mensagem: `${nomeDe.get(l.funcionarioId) ?? "Funcionário"}: ${formatarMinutos(l.feitoMin)} na semana de ${formatarDiaMes(l.semana.inicio)} (limite ${formatarMinutos(l.limiteMin)}).`,
      });
    }
  }
  const avisosPersistidos: AvisoAgendaDto[] = avisosGravados
    .filter((a) => !TIPOS_AO_VIVO.includes(a.tipo) && TIPOS_AVISO.has(a.tipo))
    .map((a) => ({
      tipo: a.tipo as TipoAvisoDto,
      data: a.data ? paraISO(a.data) : null,
      turnoId: a.turnoId,
      funcionarioId: a.funcionarioId,
      mensagem: a.mensagem,
    }));

  // Fase da EC 141 (a do último dia do mês) e regra do mês.
  let fase: FaseDto | null = null;
  if (ctx.regrasDb.regime === "EC141") {
    const f = faseVigenteEm(ctx.publicacao, fim, ctx.regras);
    fase = { numero: f.numero, nome: f.nome, descricao: f.descricao, periodo: f.periodo, resumo: resumoDaFase(f.cargaSemanalMaxMin, f.folgasSemanaisMin) };
  }
  const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
  const seguinte = mes === 12 ? { ano: ano + 1, mes: 1 } : { ano, mes: mes + 1 };

  return {
    clienteId,
    clienteNome: ctx.nome,
    ano,
    mes,
    gerado,
    geradoEm: mesGerado ? mesGerado.geradoEm.toISOString() : null,
    dias,
    turnos,
    grupos: gerado ? grupos : [],
    semanas,
    totaisPorTurno,
    trabalhandoPorDia,
    lacunas,
    avisos: [...avisosPersistidos, ...avisosAoVivo].sort((a, b) => (a.data ?? "9999") < (b.data ?? "9999") ? -1 : (a.data ?? "9999") > (b.data ?? "9999") ? 1 : 0),
    fase,
    regraDoMes: descreverRegraDasSemanas(ctx.regras, ctx.regime, semanasMotor),
    mesAnteriorGerado: ctx.meses.some((m) => m.ano === anterior.ano && m.mes === anterior.mes),
    mesSeguinteGerado: ctx.meses.some((m) => m.ano === seguinte.ano && m.mes === seguinte.mes),
    funcionariosAtivos: ctx.funcionarios.filter((f) => f.ativo).length,
    turnosAtivos: ctx.turnosAtivos.length,
    dimensionamento: {
      faltas: dimensionarContexto(ctx, fim).faltas.map((f) => ({
        nome: f.nome,
        geral: f.funcao === "",
        faltamPessoas: f.faltamPessoas,
        horasExtrasSemanaMin: f.horasExtrasSemanaMin,
        cobrivelComHoraExtra: f.cobrivelComHoraExtra,
      })),
    },
  };
}

/** Tira o dia das ausências do funcionário, dividindo o período quando ele cai no meio. */
async function removerAusenciaDoDia(tx: Prisma.TransactionClient, funcionarioId: string, data: DataISO): Promise<void> {
  const dia = deISO(data);
  const cobrem = await tx.ausencia.findMany({ where: { funcionarioId, inicio: { lte: dia }, fim: { gte: dia } } });
  for (const a of cobrem) {
    const inicio = paraISO(a.inicio);
    const fim = paraISO(a.fim);
    if (inicio === data && fim === data) {
      await tx.ausencia.delete({ where: { id: a.id } });
    } else if (inicio === data) {
      await tx.ausencia.update({ where: { id: a.id }, data: { inicio: deISO(somarDias(data, 1)) } });
    } else if (fim === data) {
      await tx.ausencia.update({ where: { id: a.id }, data: { fim: deISO(somarDias(data, -1)) } });
    } else {
      await tx.ausencia.update({ where: { id: a.id }, data: { fim: deISO(somarDias(data, -1)) } });
      await tx.ausencia.create({
        data: { funcionarioId, inicio: deISO(somarDias(data, 1)), fim: a.fim, motivo: a.motivo, justificada: a.justificada },
      });
    }
  }
}

function minutosDoTurno(t: { inicioMin: number; fimMin: number; intervaloMin: number }): number {
  return Math.max(0, (t.fimMin <= t.inicioMin ? 1440 - t.inicioMin + t.fimMin : t.fimMin - t.inicioMin) - t.intervaloMin);
}

/** Valida a data e devolve ano e mês; o mês precisa estar gerado. */
function mesGeradoDaData(ctx: ContextoCliente, data: DataISO, acao: string): { ano: number; mes: number } {
  if (!ehValida(data)) throw new ErroAgenda("Data inválida.");
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  validarAnoMes(ano, mes);
  if (!ctx.meses.some((m) => m.ano === ano && m.mes === mes)) throw new ErroAgenda(`Gere a escala deste mês antes de ${acao}.`);
  return { ano, mes };
}

function ausenciaNoDia(f: { ausencias: readonly AusenciaDb[] }, data: DataISO): AusenciaDb | undefined {
  return f.ausencias.find((a) => paraISO(a.inicio) <= data && paraISO(a.fim) >= data);
}

/**
 * Ajuste manual de um dia no Quadro (só em mês gerado). Não valida regras à força: o que
 * quebrar aparece nos avisos. `limpar` remove só o ajuste e a jornada do dia, nunca a ausência
 * cadastrada; turno ou folga sobre uma ausência exige `substituirAusencia`. Devolve a agenda recalculada.
 */
export async function definirDia(
  clienteId: string,
  funcionarioId: string,
  data: DataISO,
  valor: ValorDia,
  opcoes: { substituirAusencia?: boolean } = {},
): Promise<AgendaMesDto> {
  const ctx = await carregarContexto(prisma, clienteId);
  const { ano, mes } = mesGeradoDaData(ctx, data, "ajustar");
  const funcionario = ctx.funcionarios.find((f) => f.id === funcionarioId);
  if (!funcionario) throw new ErroAgenda("Funcionário não encontrado.");
  const turno = valor.tipo === "turno" ? ctx.turnosDb.find((t) => t.id === valor.turnoId && !t.arquivado) : undefined;
  if (valor.tipo === "turno" && !turno) throw new ErroAgenda("Turno não encontrado.");
  if (valor.tipo === "turno" && ctx.diasFechados.has(data)) throw new ErroAgenda("Dia fechado: reabra o dia antes de escalar.");
  if ((valor.tipo === "turno" || valor.tipo === "folga") && !opcoes.substituirAusencia) {
    const aus = ausenciaNoDia(funcionario, data);
    if (aus) {
      const motivo = aus.motivo?.trim();
      throw new ErroAgenda(
        `Esse dia está marcado como ${aus.justificada ? "atestado" : "falta"}${motivo ? ` (${motivo})` : ""}. Substituir?`,
        "diaComAusencia",
      );
    }
  }

  const dia = deISO(data);
  await prisma.$transaction(async (tx) => {
    await tx.alocacao.deleteMany({ where: { funcionarioId, data: dia } });
    if (valor.tipo !== "limpar") await removerAusenciaDoDia(tx, funcionarioId, data);
    if (valor.tipo === "turno" && turno) {
      // A hora não trabalhada da pessoa vale no lugar do intervalo da loja só para ela.
      const intervaloMin = intervaloDoFuncionario(funcionario, turno.intervaloMin);
      const jornada = { inicioMin: turno.inicioMin, fimMin: turno.fimMin, intervaloMin };
      await tx.alocacao.create({
        data: {
          clienteId,
          funcionarioId,
          turnoId: turno.id,
          data: dia,
          ...jornada,
          origem: "normal",
          minutosTrabalhados: minutosDoTurno(jornada),
        },
      });
    } else if (valor.tipo === "falta") {
      await tx.ausencia.create({ data: { funcionarioId, inicio: dia, fim: dia, justificada: false } });
    } else if (valor.tipo === "justificada") {
      const motivo = valor.motivo?.trim().slice(0, 80);
      await tx.ausencia.create({ data: { funcionarioId, inicio: dia, fim: dia, justificada: true, motivo: motivo ? motivo : null } });
    }
    if (valor.tipo === "limpar") {
      await tx.ajusteManual.deleteMany({ where: { funcionarioId, data: dia } });
    } else {
      await tx.ajusteManual.upsert({
        where: { funcionarioId_data: { funcionarioId, data: dia } },
        create: { clienteId, funcionarioId, data: dia },
        update: {},
      });
    }
    // Avisos que dependem do quadro atual são refeitos ao vivo; os de carga ficam defasados.
    await tx.avisoMes.deleteMany({ where: { clienteId, ano, mes, tipo: { in: TIPOS_DEFASAM_NO_AJUSTE } } });
    await gravarPrevistos(tx, clienteId, ano, mes, { soSemanaDe: data, manterMenor: true });
  }, { maxWait: 10_000, timeout: 30_000 });
  return obterAgenda(clienteId, ano, mes);
}

/**
 * Troca o que duas pessoas têm no mesmo dia (jornada ↔ jornada ou jornada ↔ folga). Recusa se
 * alguma delas tem ausência no dia ou se o dia está fechado. Marca os dois como ajuste manual.
 */
export async function trocarDia(clienteId: string, data: DataISO, funcionarioA: string, funcionarioB: string): Promise<AgendaMesDto> {
  const ctx = await carregarContexto(prisma, clienteId);
  const { ano, mes } = mesGeradoDaData(ctx, data, "trocar");
  if (funcionarioA === funcionarioB) throw new ErroAgenda("Escolha duas pessoas diferentes para trocar.");
  const a = ctx.funcionarios.find((f) => f.id === funcionarioA);
  const b = ctx.funcionarios.find((f) => f.id === funcionarioB);
  if (!a || !b) throw new ErroAgenda("Funcionário não encontrado.");
  if (ctx.diasFechados.has(data)) throw new ErroAgenda("Dia fechado: não há o que trocar.");
  for (const f of [a, b]) {
    const aus = ausenciaNoDia(f, data);
    if (aus) throw new ErroAgenda(`${f.nome} ${aus.justificada ? "está de atestado" : "tem falta registrada"} nesse dia.`);
  }

  const dia = deISO(data);
  await prisma.$transaction(async (tx) => {
    const existentes = await tx.alocacao.findMany({ where: { clienteId, data: dia, funcionarioId: { in: [funcionarioA, funcionarioB] } } });
    const deA = existentes.find((x) => x.funcionarioId === funcionarioA);
    const deB = existentes.find((x) => x.funcionarioId === funcionarioB);
    if (!deA && !deB) throw new ErroAgenda("As duas pessoas estão de folga nesse dia; não há o que trocar.");
    await tx.alocacao.deleteMany({ where: { id: { in: existentes.map((x) => x.id) } } });
    const turnosPorId = new Map(ctx.turnosDb.map((t) => [t.id, t]));
    const recriar = async (origem: (typeof existentes)[number], destino: string): Promise<void> => {
      // A jornada vai para o outro, mas a hora não trabalhada é de cada um: o intervalo do
      // turno é trocado pelo almoço de quem passa a cumprir o dia.
      const pessoa = destino === funcionarioA ? a : b;
      const doTurno = turnosPorId.get(origem.turnoId)?.intervaloMin ?? origem.intervaloMin;
      const intervaloMin = origem.intervaloMin === doTurno ? intervaloDoFuncionario(pessoa, doTurno) : origem.intervaloMin;
      const jornada = { inicioMin: origem.inicioMin, fimMin: origem.fimMin, intervaloMin };
      await tx.alocacao.create({
        data: {
          clienteId,
          funcionarioId: destino,
          turnoId: origem.turnoId,
          data: dia,
          ...jornada,
          minutosTrabalhados: minutosDoTurno(jornada),
          origem: origem.origem,
        },
      });
    };
    if (deA) await recriar(deA, funcionarioB);
    if (deB) await recriar(deB, funcionarioA);
    for (const funcionarioId of [funcionarioA, funcionarioB]) {
      await tx.ajusteManual.upsert({
        where: { funcionarioId_data: { funcionarioId, data: dia } },
        create: { clienteId, funcionarioId, data: dia },
        update: {},
      });
    }
    await tx.avisoMes.deleteMany({ where: { clienteId, ano, mes, tipo: { in: TIPOS_DEFASAM_NO_AJUSTE } } });
    await gravarPrevistos(tx, clienteId, ano, mes, { soSemanaDe: data, manterMenor: true });
  }, { maxWait: 10_000, timeout: 30_000 });
  return obterAgenda(clienteId, ano, mes);
}

/**
 * Fecha o dia (feriado, inventário): ninguém é escalado nele. Num mês gerado, apaga as jornadas
 * e os ajustes do dia (nada vira ajuste manual) e refaz o previsto da semana.
 */
export async function fecharDia(clienteId: string, data: DataISO, motivo: string | null): Promise<AgendaMesDto> {
  if (!ehValida(data)) throw new ErroAgenda("Data inválida.");
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  validarAnoMes(ano, mes);
  const ctx = await carregarContexto(prisma, clienteId);
  const dia = deISO(data);
  const texto = motivo?.trim().slice(0, 80) || null;
  const gerado = ctx.meses.some((m) => m.ano === ano && m.mes === mes);
  await prisma.$transaction(async (tx) => {
    await tx.diaFechado.upsert({
      where: { clienteId_data: { clienteId, data: dia } },
      create: { clienteId, data: dia, motivo: texto },
      update: { motivo: texto },
    });
    if (!gerado) return;
    await tx.alocacao.deleteMany({ where: { clienteId, data: dia } });
    await tx.ajusteManual.deleteMany({ where: { clienteId, data: dia } });
    await tx.avisoMes.deleteMany({ where: { clienteId, ano, mes, tipo: { in: TIPOS_DEFASAM_NO_AJUSTE } } });
    await gravarPrevistos(tx, clienteId, ano, mes, { soSemanaDe: data, manterMenor: true });
  }, { maxWait: 10_000, timeout: 30_000 });
  return obterAgenda(clienteId, ano, mes);
}

/** Reabre um dia fechado. O dia volta sem ninguém escalado; reequilibre para redistribuir. */
export async function reabrirDia(clienteId: string, data: DataISO): Promise<AgendaMesDto> {
  if (!ehValida(data)) throw new ErroAgenda("Data inválida.");
  const ano = Number(data.slice(0, 4));
  const mes = Number(data.slice(5, 7));
  validarAnoMes(ano, mes);
  const ctx = await carregarContexto(prisma, clienteId);
  const gerado = ctx.meses.some((m) => m.ano === ano && m.mes === mes);
  await prisma.$transaction(async (tx) => {
    await tx.diaFechado.deleteMany({ where: { clienteId, data: deISO(data) } });
    if (!gerado) return;
    await tx.avisoMes.deleteMany({ where: { clienteId, ano, mes, tipo: { in: TIPOS_DEFASAM_NO_AJUSTE } } });
    await gravarPrevistos(tx, clienteId, ano, mes, { soSemanaDe: data, manterMenor: true });
  }, { maxWait: 10_000, timeout: 30_000 });
  return obterAgenda(clienteId, ano, mes);
}

/** Apaga o mês gerado (alocações, avisos e ajustes). Ausências e faltas marcadas continuam. */
export async function excluirMes(clienteId: string, ano: number, mes: number): Promise<void> {
  validarAnoMes(ano, mes);
  const { inicio, fim } = limitesDoMes(ano, mes);
  await prisma.$transaction(async (tx) => {
    const periodo = { gte: deISO(inicio), lte: deISO(fim) };
    await tx.alocacao.deleteMany({ where: { clienteId, data: periodo } });
    await tx.ajusteManual.deleteMany({ where: { clienteId, data: periodo } });
    await tx.avisoMes.deleteMany({ where: { clienteId, ano, mes } });
    await tx.mesGerado.deleteMany({ where: { clienteId, ano, mes } });
    // Semanas que deixaram de estar fechadas perdem o previsto gravado.
    const ctx = await carregarContexto(tx, clienteId);
    const diaPlanejado = criarDiaPlanejado(ctx.meses);
    const abertas = semanasCobrindo(inicio, fim, ctx.regras.inicioSemana).filter((s) => !semanaFechada(s, diaPlanejado));
    if (abertas.length > 0) {
      await tx.previstoSemana.deleteMany({ where: { clienteId, inicio: { in: abertas.map((s) => deISO(s.inicio)) } } });
    }
  });
}
