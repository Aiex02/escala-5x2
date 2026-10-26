// Backend simulado em memória, usado quando o app roda fora do Tauri
// (ex.: `npm run dev` no navegador). Segue o mesmo contrato do backend Rust,
// com um gerador de escala simplificado. Erros são lançados como string.

import type { Backend } from "./client";
import type {
  AgendaMes,
  Alocacao,
  Ausencia,
  Aviso,
  Cliente,
  Configuracao,
  DiaFuncionamento,
  DiaQuadro,
  Funcao,
  Funcionario,
  FuncionamentoEntrada,
  HorasSemanaFuncionario,
  MesGerado,
  ModeloFuncionamento,
  Periodo,
  Regras,
  RelatorioImportacao,
  ResultadoGeracao,
  ResumoSemanal,
  Turno,
  TurnoEntrada,
} from "./types";
import {
  adicionarDias,
  chaveMes,
  dataNoMes,
  dataParaDias,
  diaDaSemana,
  diasNoMes,
  formatarDiaMes,
  hojeISO,
  inicioDaSemana,
  montarData,
  separarData,
  ultimoDiaDoMes,
} from "../util/datas";
import { duracaoTurnoMinutos, formatarHoras, normalizarTexto } from "../util/formato";
import { gerarTurnos, nomesTurnos, periodoDe } from "../util/funcionamento";
import { chaveFuncao, nomeMaisComum } from "../util/funcoes";
import { comFases } from "../util/regime";
import { MODELOS_SIMULADOS, MODELO_SIMULADO_PADRAO } from "./modelosSimulados";

interface MesArmazenado {
  ano: number;
  mes: number;
  geradoEm: string;
  alocacoes: Alocacao[];
  avisos: Aviso[];
  /** Células ajustadas à mão no Quadro (`definirDia`): ficam travadas ao reequilibrar; gerar o mês de novo as descarta. */
  ajustes: { funcionarioId: number; data: string }[];
}

interface DadosCliente {
  cliente: Cliente;
  /** Id do modelo em uso; null = configuração personalizada. */
  modelo: string | null;
  regras: Regras;
  funcionamento: DiaFuncionamento[];
  turnos: Turno[];
  funcionarios: Funcionario[];
  /** Mínimo por turno de cada função, pela chave (`chaveFuncao`); sem registro vale 1. */
  minimosFuncao: Record<string, number>;
  meses: Map<string, MesArmazenado>;
}

const MINIMO_FUNCAO_MAX = 20;

const copiar = <T>(valor: T): T => structuredClone(valor);
const atraso = (ms = 90) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const CORES = ["#F2B705", "#F2780C", "#3B5BDB", "#0F9E9A", "#D63A7A", "#8E4DC4"];
const dois = (n: number) => String(n).padStart(2, "0");

function limitesEm(r: Regras, data: string): { horas: number; folgas: number } {
  const fase = [...r.fases].reverse().find((f) => f.desde === null || f.desde <= data);
  return fase ? { horas: fase.cargaSemanalMaxHoras, folgas: fase.folgasSemanaisMin } : { horas: r.cargaSemanalMaxHoras, folgas: r.folgasSemanaisMin };
}

const INDICE_PERIODO: Record<Periodo, number> = { manha: 0, tarde: 1, noite: 2 };

function montarTurno(id: number, nome: string, inicio: string, fim: string, intervaloMin: number, efetivoMinimo: number, ordem: number, cor: string, diasSemana: number[], arquivado = false): Turno {
  const duracao = duracaoTurnoMinutos(inicio, fim) ?? 0;
  return {
    id,
    nome,
    inicio,
    fim,
    intervaloMin,
    efetivoMinimo,
    ordem,
    cor,
    diasSemana: [...diasSemana].sort((a, b) => a - b),
    minutosTrabalhados: duracao - intervaloMin,
    periodo: periodoDe(inicio),
    arquivado,
  };
}

/** Recria os turnos a partir do funcionamento: mantém os de mesmo horário, arquiva os usados em escalas. */
function aplicarFuncionamento(dados: DadosCliente, novoId: () => number) {
  const jornada = Math.round(dados.regras.jornadaPadraoHoras * 60);
  const gerados = gerarTurnos(dados.funcionamento, jornada, dados.regras.intervaloPadraoMin);
  const nomes = nomesTurnos(gerados);
  const usados = new Set([...dados.meses.values()].flatMap((m) => m.alocacoes.map((a) => a.turnoId)));
  const novos = gerados.map((g, i) => {
    const existente = dados.turnos.find((t) => !t.arquivado && t.inicio === g.inicio && t.fim === g.fim);
    return montarTurno(
      existente?.id ?? novoId(),
      nomes[i] ?? "Turno",
      g.inicio,
      g.fim,
      g.intervalo,
      existente?.efetivoMinimo ?? 1,
      i,
      existente?.cor ?? CORES[i % CORES.length] ?? "#64748B",
      g.dias,
    );
  });
  const arquivados = dados.turnos.filter((t) => !novos.some((n) => n.id === t.id) && usados.has(t.id)).map((t) => ({ ...t, arquivado: true }));
  dados.turnos = [...novos, ...arquivados];
}

function distanciaPreferencia(t: Turno, pref: Periodo | null): number {
  return pref ? Math.abs(INDICE_PERIODO[t.periodo] - INDICE_PERIODO[pref]) : 0;
}

function ordemPorPreferencia(turnos: Turno[], pref: Periodo | null): Turno[] {
  return [...turnos].sort((a, b) => distanciaPreferencia(a, pref) - distanciaPreferencia(b, pref) || a.ordem - b.ordem);
}

function todasAlocacoes(dados: DadosCliente): Alocacao[] {
  return [...dados.meses.values()].flatMap((m) => m.alocacoes);
}

/** Gerador simplificado: um horário por pessoa no mês (preferência quando há vaga) e folgas rotativas. */
function gerarEscala(dados: DadosCliente, ano: number, mes: number, novoId: () => number): { alocacoes: Alocacao[]; avisos: Aviso[] } {
  const ativos = dados.funcionarios.filter((f) => f.ativo).sort((a, b) => a.id - b.id);
  const turnos = dados.turnos.filter((t) => !t.arquivado);
  const ocupacao = new Map<number, number>(turnos.map((t) => [t.id, 0]));
  const fixo = new Map<number, Turno>();
  // Quem tem preferência escolhe primeiro; o restante equilibra.
  const ordem = [...ativos].sort((a, b) => Number(a.preferencia === null) - Number(b.preferencia === null));
  for (const f of ordem) {
    const menor = Math.min(...turnos.map((t) => ocupacao.get(t.id) ?? 0));
    const opcoes = ordemPorPreferencia(turnos, f.preferencia);
    const escolhido = opcoes.find((t) => (ocupacao.get(t.id) ?? 0) <= menor) ?? opcoes[0];
    if (!escolhido) continue;
    fixo.set(f.id, escolhido);
    ocupacao.set(escolhido.id, (ocupacao.get(escolhido.id) ?? 0) + 1);
  }

  const alocacoes: Alocacao[] = [];
  const dias = diasNoMes(ano, mes);
  ativos.forEach((f, i) => {
    for (let d = 1; d <= dias; d++) {
      const data = montarData(ano, mes, d);
      // Folgas rotativas: tantos dias por semana quanto a regra vigente e o limite de horas permitem.
      const lim = limitesEm(dados.regras, data);
      const jornada = Math.max(1, Math.round(dados.regras.jornadaPadraoHoras * 60));
      const diasTrabalho = Math.min(7 - lim.folgas, Math.floor((Math.min(f.cargaSemanalHoras ?? lim.horas, lim.horas) * 60) / jornada));
      if ((dataParaDias(data) + i) % 7 >= diasTrabalho) continue;
      if (f.ausencias.some((a) => data >= a.inicio && data <= a.fim)) continue;
      const ds = diaDaSemana(data);
      const turno = [fixo.get(f.id), ...ordemPorPreferencia(turnos, f.preferencia)].find((t) => t?.diasSemana.includes(ds));
      if (!turno) continue;
      alocacoes.push({ id: novoId(), funcionarioId: f.id, turnoId: turno.id, data, inicio: turno.inicio, fim: turno.fim, minutosTrabalhados: turno.minutosTrabalhados });
    }
  });

  return { alocacoes, avisos: avisosDeCobertura(dados, ano, mes, alocacoes) };
}

/** Turnos com menos pessoas que o efetivo mínimo em algum dia do mês. */
function avisosDeCobertura(dados: DadosCliente, ano: number, mes: number, alocacoes: Alocacao[]): Aviso[] {
  const turnos = dados.turnos.filter((t) => !t.arquivado);
  const avisos: Aviso[] = [];
  for (let d = 1; d <= diasNoMes(ano, mes); d++) {
    const data = montarData(ano, mes, d);
    for (const t of turnos) {
      if (t.efetivoMinimo <= 0 || !t.diasSemana.includes(diaDaSemana(data))) continue;
      const n = alocacoes.filter((a) => a.data === data && a.turnoId === t.id).length;
      if (n < t.efetivoMinimo) {
        avisos.push({ tipo: "coberturaInsuficiente", data, turnoId: t.id, funcionarioId: null, mensagem: `${formatarDiaMes(data)}: turno ${t.nome} com ${n} de ${t.efetivoMinimo} pessoa(s).` });
      }
    }
  }
  return avisos;
}

/** Chave da função da pessoa; vazio = sem cargo. */
function funcaoDe(f: Funcionario): string {
  return f.cargo ? chaveFuncao(f.cargo) : "";
}

/**
 * Funções dos funcionários ativos, com o mínimo gravado (padrão 1) e quantas pessoas cobrem esse mínimo em todos
 * os turnos abertos da semana, com as folgas da regra final (mesma conta do backend).
 */
function funcoesDoCliente(dados: DadosCliente): Funcao[] {
  const cargos = new Map<string, string[]>();
  for (const f of dados.funcionarios) {
    const chave = funcaoDe(f);
    if (f.ativo && f.cargo && chave) cargos.set(chave, [...(cargos.get(chave) ?? []), f.cargo]);
  }
  const turnos = dados.turnos.filter((t) => !t.arquivado);
  const turnosSemana = [0, 1, 2, 3, 4, 5, 6].reduce((soma, dia) => soma + turnos.filter((t) => t.diasSemana.includes(dia)).length, 0);
  const fases = dados.regras.fases;
  const ultima = fases[fases.length - 1];
  const folgas = ultima ? Math.max(ultima.folgasSemanaisMin, dados.regras.folgasSemanaisMin) : dados.regras.folgasSemanaisMin;
  const diasDeTrabalho = Math.max(1, 7 - folgas);
  return [...cargos]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([chave, lista]) => {
      const minimo = dados.minimosFuncao[chave] ?? 1;
      return { chave, nome: nomeMaisComum(lista), pessoas: lista.length, minimo, pessoasNecessarias: Math.ceil((turnosSemana * minimo) / diasDeTrabalho) };
    });
}

/** Um aviso por função, turno e semana com os dias em que o turno ficou sem o mínimo da função (mesmo texto do backend). */
function avisosDeFuncao(dados: DadosCliente, ano: number, mes: number, alocacoes: Alocacao[]): Aviso[] {
  const funcoes = funcoesDoCliente(dados).filter((f) => f.minimo > 0);
  if (funcoes.length === 0) return [];
  const turnos = dados.turnos.filter((t) => !t.arquivado);
  const funcaoPorPessoa = new Map(dados.funcionarios.map((f) => [f.id, funcaoDe(f)]));
  const faltas = new Map<string, { funcao: Funcao; turno: Turno; dias: string[] }>();
  for (let d = 1; d <= diasNoMes(ano, mes); d++) {
    const data = montarData(ano, mes, d);
    const semana = inicioDaSemana(data, dados.regras.inicioSemana);
    for (const turno of turnos) {
      if (!turno.diasSemana.includes(diaDaSemana(data))) continue;
      for (const funcao of funcoes) {
        const presentes = alocacoes.filter((a) => a.data === data && a.turnoId === turno.id && funcaoPorPessoa.get(a.funcionarioId) === funcao.chave).length;
        if (presentes >= funcao.minimo) continue;
        const chave = `${semana}|${funcao.chave}|${String(turno.id).padStart(9, "0")}`;
        const atual = faltas.get(chave);
        if (atual) atual.dias.push(data);
        else faltas.set(chave, { funcao, turno, dias: [data] });
      }
    }
  }
  return [...faltas]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { funcao, turno, dias }]): Aviso => ({
      tipo: "funcaoDescoberta",
      data: dias[0] ?? null,
      turnoId: turno.id,
      funcionarioId: null,
      mensagem: `${funcao.nome}: turno ${turno.nome} sem o mínimo de ${funcao.minimo} pessoa(s) da função em ${dias.map(formatarDiaMes).join(", ")}.`,
    }));
}

/** O estabelecimento abre neste dia? (só os dias abertos contam para as horas previstas) */
function abertoEm(dados: DadosCliente, data: string): boolean {
  const dia = diaDaSemana(data);
  return dados.funcionamento.find((d) => d.dia === dia)?.aberto ?? false;
}

/**
 * Horas de uma pessoa numa semana completa. Dias de ausência justificada (com a loja aberta)
 * abonam uma jornada cada; falta não abona nada: a pessoa continua devendo o dia.
 */
function horasDaSemana(dados: DadosCliente, f: Funcionario, inicio: string, todas: Alocacao[]): HorasSemanaFuncionario {
  const fim = adicionarDias(inicio, 6);
  const jornada = Math.max(1, Math.round(dados.regras.jornadaPadraoHoras * 60));
  const lim = limitesEm(dados.regras, fim);
  const limiteMin = Math.round(Math.min(f.cargaSemanalHoras ?? lim.horas, lim.horas) * 60);
  const abonados = [0, 1, 2, 3, 4, 5, 6].filter((i) => {
    const dia = adicionarDias(inicio, i);
    return abertoEm(dados, dia) && f.ausencias.some((a) => a.justificada && dia >= a.inicio && dia <= a.fim);
  }).length;
  const jornadas = Math.min(Math.floor(limiteMin / jornada), 7 - lim.folgas);
  const previstoMin = Math.max(0, (jornadas - abonados) * jornada);
  const minutos = todas.filter((a) => a.funcionarioId === f.id && a.data >= inicio && a.data <= fim).reduce((soma, a) => soma + a.minutosTrabalhados, 0);
  return { funcionarioId: f.id, minutos, limiteMin, previstoMin };
}

/** A semana ainda depende de um mês sem escala? */
function semanaPendente(dados: DadosCliente, inicio: string): boolean {
  return [0, 1, 2, 3, 4, 5, 6].some((i) => {
    const { ano, mes } = separarData(adicionarDias(inicio, i));
    return !dados.meses.has(chaveMes(ano, mes));
  });
}

/** A pessoa tem alocação ou falta na semana? Só essas semanas entram no saldo. */
function participouDaSemana(f: Funcionario, inicio: string, todas: Alocacao[]): boolean {
  const fim = adicionarDias(inicio, 6);
  return todas.some((a) => a.funcionarioId === f.id && a.data >= inicio && a.data <= fim) || f.ausencias.some((a) => !a.justificada && a.inicio <= fim && a.fim >= inicio);
}

/**
 * Saldo dos meses anteriores, em minutos: soma de (horas − previstas) das semanas fechadas
 * antes da primeira semana do mês (semanas que têm todos os seus dias em meses já gerados).
 */
function saldoAnterior(dados: DadosCliente, f: Funcionario, ano: number, mes: number, todas: Alocacao[]): number {
  const primeiraSemana = inicioDaSemana(montarData(ano, mes, 1), dados.regras.inicioSemana);
  const semanas = new Set<string>();
  for (const anterior of dados.meses.values()) {
    if (chaveMes(anterior.ano, anterior.mes) >= chaveMes(ano, mes)) continue;
    const ultimo = ultimoDiaDoMes(anterior.ano, anterior.mes);
    for (let inicio = inicioDaSemana(montarData(anterior.ano, anterior.mes, 1), dados.regras.inicioSemana); inicio <= ultimo; inicio = adicionarDias(inicio, 7)) {
      if (adicionarDias(inicio, 6) < primeiraSemana && !semanaPendente(dados, inicio)) semanas.add(inicio);
    }
  }
  let saldo = 0;
  for (const inicio of semanas) {
    if (!participouDaSemana(f, inicio, todas)) continue;
    const h = horasDaSemana(dados, f, inicio, todas);
    saldo += h.minutos - h.previstoMin;
  }
  return saldo;
}

function montarAgenda(dados: DadosCliente, ano: number, mes: number): AgendaMes {
  const armazenado = dados.meses.get(chaveMes(ano, mes));
  const alocacoes = armazenado?.alocacoes ?? [];
  const ids = new Set(alocacoes.map((a) => a.funcionarioId));
  const cadastros = dados.funcionarios.filter((f) => f.ativo || ids.has(f.id)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const primeiro = montarData(ano, mes, 1);
  const ultimo = ultimoDiaDoMes(ano, mes);
  const todas = todasAlocacoes(dados);

  const funcionarios = cadastros.map((f) => ({
    id: f.id,
    nome: f.nome,
    matricula: f.matricula,
    cargo: f.cargo,
    preferencia: f.preferencia,
    saldoAnteriorMin: saldoAnterior(dados, f, ano, mes, todas),
    funcao: funcaoDe(f) || null,
  }));

  const semanas: ResumoSemanal[] = [];
  for (let inicio = inicioDaSemana(primeiro, dados.regras.inicioSemana); inicio <= ultimo; inicio = adicionarDias(inicio, 7)) {
    semanas.push({
      inicio,
      fim: adicionarDias(inicio, 6),
      pendente: semanaPendente(dados, inicio),
      funcionarios: cadastros.map((f) => horasDaSemana(dados, f, inicio, todas)),
    });
  }

  const fases = dados.regras.fases.filter((f) => (f.desde ?? "") <= ultimo && (f.ate ?? "9999") >= primeiro).map((f) => f.descricao);
  return copiar({
    ano,
    mes,
    geradoEm: armazenado?.geradoEm ?? null,
    inicioSemana: dados.regras.inicioSemana,
    turnos: dados.turnos.filter((t) => !t.arquivado || alocacoes.some((a) => a.turnoId === t.id)),
    funcionarios,
    alocacoes,
    ajustes: armazenado?.ajustes ?? [],
    semanas: armazenado ? semanas : [],
    // Os avisos de função são refeitos a cada leitura, para acompanhar os ajustes do Quadro.
    avisos: armazenado ? [...armazenado.avisos, ...avisosDeFuncao(dados, ano, mes, alocacoes)] : [],
    ausencias: dados.funcionarios.flatMap((f) => f.ausencias.filter((a) => a.fim >= primeiro && a.inicio <= ultimo).map((a) => ({ funcionarioId: f.id, ...a }))),
    funcoes: funcoesDoCliente(dados)
      .filter((f) => f.minimo > 0)
      .map((f) => ({ ...f, pessoasNecessarias: 0 })),
    regra: fases.length > 0 ? fases.join("; depois, ") : `Até ${dados.regras.cargaSemanalMaxHoras}h por semana`,
  });
}

/** Tira um dia de dentro dos períodos de ausência, dividindo em dois o que o atravessa. */
function tirarDiaDasAusencias(ausencias: Ausencia[], data: string): Ausencia[] {
  return ausencias.flatMap((a) => {
    if (data < a.inicio || data > a.fim) return [a];
    const partes: Ausencia[] = [];
    if (a.inicio < data) partes.push({ ...a, fim: adicionarDias(data, -1) });
    if (a.fim > data) partes.push({ ...a, inicio: adicionarDias(data, 1) });
    return partes;
  });
}

/** Junta períodos seguidos de mesmo tipo e motivo (os dias marcados um a um viram um período só). */
function unirAusencias(ausencias: Ausencia[]): Ausencia[] {
  const unidas: Ausencia[] = [];
  for (const a of [...ausencias].sort((x, y) => x.inicio.localeCompare(y.inicio))) {
    const anterior = unidas[unidas.length - 1];
    if (anterior && anterior.justificada === a.justificada && anterior.motivo === a.motivo && adicionarDias(anterior.fim, 1) >= a.inicio) {
      if (a.fim > anterior.fim) anterior.fim = a.fim;
    } else {
      unidas.push({ ...a });
    }
  }
  return unidas;
}

/** Carla (i = 2) está de férias (justificada); Diego (i = 3) faltou um dia, sem justificativa. */
function ausenciasDaSemente(i: number, ano: number, mes: number): Ausencia[] {
  if (i === 2) return [{ inicio: montarData(ano, mes, 8), fim: montarData(ano, mes, 14), motivo: "Férias", justificada: true }];
  if (i === 3) return [{ inicio: montarData(ano, mes, 5), fim: montarData(ano, mes, 5), motivo: null, justificada: false }];
  return [];
}

function modeloSimulado(id: string): ModeloFuncionamento {
  const modelo = MODELOS_SIMULADOS.find((m) => m.id === id);
  if (!modelo) throw `Modelo de funcionamento "${id}" desconhecido.`;
  return modelo;
}

/** Cliente novo já no modelo: horário, jornada e regras dele e os turnos gerados. */
function dadosDoModelo(nome: string, modelo: ModeloFuncionamento, novoId: () => number): DadosCliente {
  const dados: DadosCliente = { cliente: { id: novoId(), nome }, modelo: modelo.id, regras: copiar(modelo.regras), funcionamento: copiar(modelo.dias), turnos: [], funcionarios: [], minimosFuncao: {}, meses: new Map() };
  aplicarFuncionamento(dados, novoId);
  return dados;
}

function montarSemente(novoId: () => number): DadosCliente {
  const dados = dadosDoModelo("Loja do Shopping", modeloSimulado(MODELO_SIMULADO_PADRAO), novoId);
  const { ano, mes } = separarData(hojeISO());
  const pessoas: [string, string, Periodo | null][] = [
    ["Ana Souza", "Atendente", "manha"],
    ["Bruno Carvalho", "Atendente", "tarde"],
    ["Carla Mendes", "Atendente", null],
    ["Diego Ferreira", "Cozinheiro", "manha"],
    ["Eduarda Nunes", "Atendente", "noite"],
    ["Felipe Barbosa", "Cozinheiro", "manha"],
    ["Gabriela Rocha", "Gerente", "manha"],
    ["Henrique Lopes", "Atendente", "tarde"],
    // Cargo no formato do quadro de horário importado: conta como a mesma função de "Cozinheiro".
    ["Isabela Martins", "Cozinheiro (a)", "tarde"],
    ["João Pedro Silva", "Atendente", null],
  ];
  dados.funcionarios = pessoas.map(([nome, cargo, preferencia], i) => ({
    id: novoId(),
    matricula: String(1001 + i),
    nome,
    cargo,
    ctps: null,
    secao: null,
    cargaSemanalHoras: null,
    preferencia,
    ativo: true,
    ausencias: ausenciasDaSemente(i, ano, mes),
  }));
  return dados;
}

function validarNome(nome: string, rotulo: string): string {
  const limpo = nome.trim();
  if (!limpo) throw `O nome do ${rotulo} é obrigatório.`;
  if (limpo.length > 80) throw `O nome do ${rotulo} deve ter no máximo 80 caracteres.`;
  return limpo;
}

function agoraTexto(): string {
  const a = new Date();
  return `${montarData(a.getFullYear(), a.getMonth() + 1, a.getDate())} ${dois(a.getHours())}:${dois(a.getMinutes())}:${dois(a.getSeconds())}`;
}

function validarRegras(regras: Regras) {
  if (!(regras.cargaSemanalMaxHoras > 0 && regras.cargaSemanalMaxHoras <= 168)) throw "A carga semanal máxima deve estar entre 1 minuto e 168 horas.";
  if (!(regras.jornadaDiariaMaxHoras > 0 && regras.jornadaDiariaMaxHoras <= 24)) throw "A jornada diária máxima deve estar entre 1 minuto e 24 horas.";
  if (regras.jornadaDiariaMaxHoras > regras.cargaSemanalMaxHoras) throw "A jornada diária máxima não pode ser maior que a carga semanal.";
  if (!(regras.descansoEntreJornadasHoras >= 0 && regras.descansoEntreJornadasHoras <= 48)) throw "O descanso entre jornadas deve ser de no máximo 48 horas.";
  if (!(Number.isInteger(regras.maxDiasConsecutivos) && regras.maxDiasConsecutivos >= 1 && regras.maxDiasConsecutivos <= 31)) throw "O máximo de dias consecutivos deve estar entre 1 e 31.";
  if (!(Number.isInteger(regras.folgasSemanaisMin) && regras.folgasSemanaisMin >= 0 && regras.folgasSemanaisMin <= 6)) throw "As folgas semanais devem ficar entre 0 e 6.";
  if (!(Number.isInteger(regras.domingosSeguidosMax) && regras.domingosSeguidosMax >= 0 && regras.domingosSeguidosMax <= 52)) throw "O máximo de domingos seguidos deve ficar entre 0 (sem limite) e 52.";
}

function validarFuncionamento(entrada: FuncionamentoEntrada, regras: Regras) {
  if (!entrada.dias.some((d) => d.aberto)) throw "Marque ao menos um dia de funcionamento.";
  if (!(entrada.jornadaHoras >= 1 && entrada.jornadaHoras <= 12)) throw "A jornada deve ficar entre 1h e 12h.";
  if (!(entrada.intervaloMin >= 0 && entrada.intervaloMin <= 120)) throw "O intervalo deve ficar entre 0 e 2h.";
  if (entrada.jornadaHoras > regras.jornadaDiariaMaxHoras) throw `A jornada de ${formatarHoras(entrada.jornadaHoras)} passa da jornada diária máxima de ${formatarHoras(regras.jornadaDiariaMaxHoras)} definida nas regras.`;
}

/**
 * Refaz o mês a partir de `aPartir`: os dias anteriores e as células ajustadas à mão ficam como estão e
 * o resto vem do gerador (o simulado não compensa o saldo de horas como o backend real).
 */
function refazerMes(dados: DadosCliente, ano: number, mes: number, aPartir: string, novoId: () => number) {
  const armazenado = dados.meses.get(chaveMes(ano, mes));
  if (!armazenado) return;
  const travada = new Set(armazenado.ajustes.map((a) => `${a.funcionarioId}|${a.data}`));
  const chave = (a: Alocacao) => `${a.funcionarioId}|${a.data}`;
  const novas = gerarEscala(dados, ano, mes, novoId).alocacoes;
  armazenado.alocacoes = [
    ...armazenado.alocacoes.filter((a) => a.data < aPartir || travada.has(chave(a))),
    ...novas.filter((a) => a.data >= aPartir && !travada.has(chave(a))),
  ];
  armazenado.avisos = avisosDeCobertura(dados, ano, mes, armazenado.alocacoes);
}

export function criarBackendSimulado(): Backend {
  let sequencia = 1;
  const novoId = () => sequencia++;
  const clientes = new Map<number, DadosCliente>();

  function obter(clienteId: number): DadosCliente {
    const dados = clientes.get(clienteId);
    if (!dados) throw "Cliente não encontrado.";
    return dados;
  }

  function config(dados: DadosCliente): Configuracao {
    return copiar({
      regras: dados.regras,
      turnos: dados.turnos.filter((t) => !t.arquivado).sort((a, b) => a.ordem - b.ordem),
      funcionamento: dados.funcionamento,
      modelo: dados.modelo,
      funcoes: funcoesDoCliente(dados),
    });
  }

  function gerarEGravar(dados: DadosCliente, ano: number, mes: number): ResultadoGeracao {
    if (!dados.turnos.some((t) => !t.arquivado)) throw "Configure o funcionamento do estabelecimento antes de gerar a escala.";
    const { alocacoes, avisos } = gerarEscala(dados, ano, mes, novoId);
    const geradoEm = agoraTexto();
    // Gerar de novo descarta os ajustes à mão do mês (e, com eles, as travas do reequilíbrio).
    dados.meses.set(chaveMes(ano, mes), { ano, mes, geradoEm, alocacoes, avisos, ajustes: [] });
    return { mes: { ano, mes, geradoEm }, totalAlocacoes: alocacoes.length, avisos: [...avisos, ...avisosDeFuncao(dados, ano, mes, alocacoes)] };
  }

  const semente = montarSemente(novoId);
  clientes.set(semente.cliente.id, semente);
  const hoje = separarData(hojeISO());
  gerarEGravar(semente, hoje.ano, hoje.mes);

  return {
    async listarClientes() {
      await atraso();
      return [...clientes.values()].map((d) => copiar(d.cliente)).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
    },
    async criarCliente(nome, modelo) {
      await atraso();
      const limpo = validarNome(nome, "cliente");
      if ([...clientes.values()].some((d) => normalizarTexto(d.cliente.nome) === normalizarTexto(limpo))) throw "Já existe um cliente com este nome.";
      const dados = dadosDoModelo(limpo, modeloSimulado(modelo ?? MODELO_SIMULADO_PADRAO), novoId);
      clientes.set(dados.cliente.id, dados);
      return copiar(dados.cliente);
    },
    async renomearCliente(clienteId, nome) {
      await atraso();
      const dados = obter(clienteId);
      dados.cliente.nome = validarNome(nome, "cliente");
      return copiar(dados.cliente);
    },
    async excluirCliente(clienteId) {
      await atraso();
      obter(clienteId);
      clientes.delete(clienteId);
    },

    async obterConfiguracao(clienteId) {
      await atraso();
      return config(obter(clienteId));
    },
    async listarModelos() {
      await atraso(60);
      return copiar([...MODELOS_SIMULADOS]);
    },
    async salvarFuncoes(clienteId, funcoes) {
      await atraso(120);
      const dados = obter(clienteId);
      if (funcoes.some((f) => !(Number.isInteger(f.minimo) && f.minimo >= 0 && f.minimo <= MINIMO_FUNCAO_MAX))) throw `O mínimo por turno de cada função deve ficar entre 0 e ${MINIMO_FUNCAO_MAX}.`;
      for (const { chave, minimo } of funcoes) dados.minimosFuncao[chave] = minimo;
      return copiar(funcoesDoCliente(dados));
    },
    async salvarConfiguracao(clienteId, entrada) {
      await atraso(150);
      const dados = obter(clienteId);
      if (entrada.modelo !== null) {
        // Modelo: horário, jornada e regras vêm dele; o regime da EC 141 mantém a publicação do cliente.
        const modelo = modeloSimulado(entrada.modelo);
        const publicacao = dados.regras.regime === "ec141" && dados.regras.ec141Publicacao ? dados.regras.ec141Publicacao : modelo.regras.ec141Publicacao;
        dados.regras = comFases({ ...copiar(modelo.regras), ec141Publicacao: publicacao });
        dados.funcionamento = copiar(modelo.dias);
        dados.modelo = modelo.id;
      } else {
        // Personalizada: valida tudo antes de gravar, como o backend.
        if (!entrada.regras) throw "Informe as regras da configuração personalizada.";
        if (!entrada.funcionamento) throw "Informe o funcionamento da configuração personalizada.";
        const { regras, funcionamento } = entrada;
        validarRegras(regras);
        validarFuncionamento(funcionamento, regras);
        dados.regras = comFases(copiar({ ...regras, jornadaPadraoHoras: funcionamento.jornadaHoras, intervaloPadraoMin: funcionamento.intervaloMin }));
        dados.funcionamento = copiar(funcionamento.dias);
        dados.modelo = null;
      }
      aplicarFuncionamento(dados, novoId);
      return config(dados);
    },
    async salvarRegras(clienteId, regras) {
      await atraso();
      const dados = obter(clienteId);
      validarRegras(regras);
      dados.regras = comFases({ ...regras, jornadaPadraoHoras: dados.regras.jornadaPadraoHoras, intervaloPadraoMin: dados.regras.intervaloPadraoMin });
      // Mexer nas regras à mão sai do modelo.
      dados.modelo = null;
      return copiar(dados.regras);
    },
    async salvarFuncionamento(clienteId, entrada) {
      await atraso(150);
      const dados = obter(clienteId);
      validarFuncionamento(entrada, dados.regras);
      dados.funcionamento = copiar(entrada.dias);
      dados.regras = { ...dados.regras, jornadaPadraoHoras: entrada.jornadaHoras, intervaloPadraoMin: entrada.intervaloMin };
      // Mexer no funcionamento à mão sai do modelo.
      dados.modelo = null;
      aplicarFuncionamento(dados, novoId);
      return config(dados);
    },
    async salvarTurno(clienteId, entrada: TurnoEntrada) {
      await atraso();
      const dados = obter(clienteId);
      const nome = validarNome(entrada.nome, "turno");
      if (entrada.diasSemana.length === 0) throw "Selecione ao menos um dia de funcionamento do turno.";
      const id = entrada.id ?? novoId();
      const turno = montarTurno(id, nome, entrada.inicio, entrada.fim, entrada.intervaloMin, entrada.efetivoMinimo, entrada.ordem, entrada.cor, entrada.diasSemana);
      const pos = dados.turnos.findIndex((t) => t.id === id);
      if (pos >= 0) dados.turnos[pos] = turno;
      else dados.turnos.push(turno);
      return copiar(turno);
    },
    async excluirTurno(clienteId, turnoId) {
      await atraso();
      const dados = obter(clienteId);
      if (todasAlocacoes(dados).some((a) => a.turnoId === turnoId)) throw "Há escalas geradas com este turno; exclua esses meses antes.";
      dados.turnos = dados.turnos.filter((t) => t.id !== turnoId);
    },

    async listarFuncionarios(clienteId) {
      await atraso();
      return copiar([...obter(clienteId).funcionarios].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    },
    async definirFuncionarioAtivo(clienteId, funcionarioId, ativo) {
      await atraso(50);
      const f = obter(clienteId).funcionarios.find((x) => x.id === funcionarioId);
      if (!f) throw "Funcionário não encontrado.";
      f.ativo = ativo;
    },
    async excluirFuncionario(clienteId, funcionarioId) {
      await atraso();
      const dados = obter(clienteId);
      dados.funcionarios = dados.funcionarios.filter((f) => f.id !== funcionarioId);
      for (const m of dados.meses.values()) {
        m.alocacoes = m.alocacoes.filter((a) => a.funcionarioId !== funcionarioId);
        m.ajustes = m.ajustes.filter((a) => a.funcionarioId !== funcionarioId);
      }
    },
    async salvarFuncionario(clienteId, funcionarioId, edicao) {
      await atraso();
      const f = obter(clienteId).funcionarios.find((x) => x.id === funcionarioId);
      if (!f) throw "Funcionário não encontrado.";
      if (edicao.cargaSemanalHoras !== null && !(edicao.cargaSemanalHoras > 0 && edicao.cargaSemanalHoras <= 168)) throw "Carga semanal inválida.";
      f.cargo = edicao.cargo?.trim() || null;
      f.cargaSemanalHoras = edicao.cargaSemanalHoras;
      f.preferencia = edicao.preferencia;
      return copiar(f);
    },

    async importarPlanilha(clienteId, caminho, simular): Promise<RelatorioImportacao> {
      await atraso(400);
      const dados = obter(clienteId);
      if (!caminho.trim()) throw "Informe o caminho da planilha.";
      const arquivo = caminho.split(/[\\/]/).pop() || caminho;
      const quadro = normalizarTexto(arquivo).includes("quadro");
      const linhas: [string, string, string, Periodo | null][] = [
        ["2001", "Fernanda Lima", "Atendente", "manha"],
        ["2002", "Roberto Alves", "Cozinheiro", "tarde"],
        ["2003", "Camila Duarte", "Atendente", null],
      ];
      const importados = linhas.map(([matricula, nome, cargo, preferencia], i) => {
        const existente = dados.funcionarios.find((f) => f.matricula === matricula);
        if (!simular) {
          if (existente) Object.assign(existente, { nome, cargo, preferencia });
          else dados.funcionarios.push({ id: novoId(), matricula, nome, cargo, ctps: null, secao: null, cargaSemanalHoras: null, preferencia, ativo: true, ausencias: [] });
        }
        return { linha: i + 2, matricula, nome, acao: existente ? ("atualizado" as const) : ("criado" as const) };
      });
      return {
        arquivo,
        simulacao: simular,
        formato: quadro ? "quadro" : "padrao",
        empregador: quadro ? "LOJA EXEMPLO LTDA" : null,
        totalLinhas: 4,
        importados,
        rejeitados: [{ planilha: "Funcionarios", linha: 5, matricula: null, erros: ["matricula não informado(a)"] }],
        ausenciasImportadas: 0,
        avisos: quadro ? ["Os horários do quadro não são importados: só nome, função, seção e CTPS foram lidos."] : [],
      };
    },
    async salvarModeloPlanilha() {
      await atraso(150);
    },

    async listarMeses(clienteId): Promise<MesGerado[]> {
      await atraso(60);
      return [...obter(clienteId).meses.values()].map(({ ano, mes, geradoEm }) => ({ ano, mes, geradoEm })).sort((a, b) => b.ano - a.ano || b.mes - a.mes);
    },
    async gerarMes(clienteId, ano, mes) {
      await atraso(400);
      return copiar(gerarEGravar(obter(clienteId), ano, mes));
    },
    async excluirMes(clienteId, ano, mes) {
      await atraso();
      if (!obter(clienteId).meses.delete(chaveMes(ano, mes))) throw "Este mês ainda não foi gerado.";
    },
    async obterAgenda(clienteId, ano, mes) {
      await atraso();
      return montarAgenda(obter(clienteId), ano, mes);
    },
    async definirDia(clienteId, funcionarioId, data, dia: DiaQuadro) {
      await atraso(60);
      const dados = obter(clienteId);
      const { ano, mes } = separarData(data);
      const armazenado = dados.meses.get(chaveMes(ano, mes));
      if (!armazenado) throw "Gere a escala deste mês antes de ajustar.";
      const pessoa = dados.funcionarios.find((f) => f.id === funcionarioId);
      if (!pessoa) throw "Funcionário não encontrado.";
      const turno = dia.tipo === "turno" ? dados.turnos.find((x) => x.id === dia.turnoId && !x.arquivado) : undefined;
      if (dia.tipo === "turno" && !turno) throw "Turno não encontrado.";

      // O dia sai de qualquer período de ausência (que se divide); a ausência nova volta como período de um dia.
      pessoa.ausencias = tirarDiaDasAusencias(pessoa.ausencias, data);
      armazenado.alocacoes = armazenado.alocacoes.filter((a) => !(a.funcionarioId === funcionarioId && a.data === data));
      if (dia.tipo === "turno" && turno) {
        armazenado.alocacoes.push({ id: novoId(), funcionarioId, turnoId: turno.id, data, inicio: turno.inicio, fim: turno.fim, minutosTrabalhados: turno.minutosTrabalhados });
      } else if (dia.tipo === "ausencia") {
        pessoa.ausencias.push({ inicio: data, fim: data, motivo: dia.motivo?.trim() || null, justificada: dia.justificada });
      }
      pessoa.ausencias = unirAusencias(pessoa.ausencias);
      if (!armazenado.ajustes.some((a) => a.funcionarioId === funcionarioId && a.data === data)) armazenado.ajustes.push({ funcionarioId, data });
      return montarAgenda(dados, ano, mes);
    },
    async reequilibrar(clienteId, ano, mes, aPartir, seguintes) {
      await atraso(300);
      const dados = obter(clienteId);
      if (!dados.meses.has(chaveMes(ano, mes))) throw "Gere a escala deste mês antes de reequilibrar.";
      if (!dataNoMes(aPartir, ano, mes)) throw "Escolha um dia dentro do mês.";
      refazerMes(dados, ano, mes, aPartir, novoId);
      const refeitos = [chaveMes(ano, mes)];
      if (seguintes) {
        const posteriores = [...dados.meses.values()].filter((m) => chaveMes(m.ano, m.mes) > chaveMes(ano, mes)).sort((a, b) => chaveMes(a.ano, a.mes).localeCompare(chaveMes(b.ano, b.mes)));
        for (const m of posteriores) {
          refazerMes(dados, m.ano, m.mes, montarData(m.ano, m.mes, 1), novoId);
          refeitos.push(chaveMes(m.ano, m.mes));
        }
      }
      const meses = refeitos.flatMap((chave) => {
        const m = dados.meses.get(chave);
        return m ? [{ ano: m.ano, mes: m.mes, geradoEm: m.geradoEm }] : [];
      });
      return copiar({ agenda: montarAgenda(dados, ano, mes), meses });
    },
    async exportarEscala(clienteId, ano, mes) {
      await atraso(200);
      if (!obter(clienteId).meses.has(chaveMes(ano, mes))) throw "Gere a escala deste mês antes de exportar.";
    },
  };
}
