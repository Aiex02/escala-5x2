// Horário de funcionamento do estabelecimento e os turnos que saem dele.
//
// O estabelecimento informa, por dia da semana, a abertura e o fechamento, e a jornada dos
// funcionários (ex.: 6h com 15 min de intervalo). Abertura igual ao fechamento é funcionamento
// de 24h. Os turnos são intercalados para cobrir todo o horário aberto: o primeiro começa na
// abertura, o último termina no fechamento e os do meio ficam espaçados por igual, em
// múltiplos de 15 minutos.

import { ErroMotor } from "./erros";
import { formatarHora, formatarHorario, formatarMinutos, type Horario, MINUTOS_DIA, minutosTrabalhados, tentarCriarHorario } from "./hora";
import { type DiasSemana, diasDeIndices, NENHUM_DIA, type RegrasCarga, uniaoDias } from "./modelo";
import { type EtapaRegime } from "./regime";

/** Período do dia usado nas preferências dos funcionários. */
export type Periodo = "manha" | "tarde" | "noite";

export const PERIODOS: readonly Periodo[] = ["manha", "tarde", "noite"];

/** Pela hora de início: das 5h às 12h manhã, até 18h tarde; depois (e de madrugada) noite. */
export function periodoDeInicio(inicioMin: number): Periodo {
  if (inicioMin < 5 * 60) return "noite";
  if (inicioMin < 12 * 60) return "manha";
  if (inicioMin < 18 * 60) return "tarde";
  return "noite";
}

export function nomePeriodo(periodo: Periodo): string {
  return periodo === "manha" ? "Manhã" : periodo === "tarde" ? "Tarde" : "Noite";
}

/** Aceita "manha", "manhã", "Tarde", "NOITE", "M", "T", "N"; `null` se não reconhecer. */
export function analisarPeriodo(texto: string): Periodo | null {
  const t = texto
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
  if (t === "manha" || t === "m") return "manha";
  if (t === "tarde" || t === "t") return "tarde";
  if (t === "noite" || t === "n") return "noite";
  return null;
}

/** Distância entre períodos (manhã–tarde = 1, manhã–noite = 2). */
export function distanciaPeriodo(a: Periodo, b: Periodo): number {
  return Math.abs(PERIODOS.indexOf(a) - PERIODOS.indexOf(b));
}

/** Abertura e fechamento num dia da semana (0 = segunda ... 6 = domingo). `abreMin === fechaMin` = 24h. */
export interface JanelaDia {
  dia: number;
  abreMin: number;
  fechaMin: number;
}

/** Turno calculado a partir do funcionamento. */
export interface TurnoGerado {
  nome: string;
  horario: Horario;
  dias: DiasSemana;
  periodo: Periodo;
}

/** Minutos abertos; fechamento igual (ou antes) da abertura atravessa a meia-noite (24h se igual). */
function duracaoJanela(abreMin: number, fechaMin: number): number {
  return fechaMin > abreMin ? fechaMin - abreMin : MINUTOS_DIA - abreMin + fechaMin;
}

/** Intervalo padrão da CLT (art. 71): até 4h nenhum, até 6h 15 min, acima disso 1h. */
export function intervaloPadrao(jornadaMin: number): number {
  if (jornadaMin <= 4 * 60) return 0;
  if (jornadaMin <= 6 * 60) return 15;
  return 60;
}

/** "6h com 15 min de intervalo" */
export function descreverJornada(jornadaMin: number, intervaloMin: number): string {
  return intervaloMin === 0 ? formatarMinutos(jornadaMin) : `${formatarMinutos(jornadaMin)} com ${intervaloMin} min de intervalo`;
}

/**
 * Turnos intercalados que cobrem cada janela de funcionamento. Janelas iguais em dias
 * diferentes viram um só turno com vários dias. Lança `ErroMotor` se a entrada for inválida.
 */
export function gerarTurnos(janelas: readonly JanelaDia[], jornadaMin: number, intervaloMin: number): TurnoGerado[] {
  if (janelas.length === 0) throw new ErroMotor("semDias", "Marque ao menos um dia de funcionamento.");
  if (!Number.isInteger(jornadaMin) || jornadaMin < 60 || jornadaMin > 12 * 60) {
    throw new ErroMotor("jornadaInvalida", "A jornada deve ficar entre 1h e 12h.");
  }
  if (!Number.isInteger(intervaloMin) || intervaloMin < 0 || intervaloMin > 120) {
    throw new ErroMotor("intervaloInvalido", "O intervalo deve ficar entre 0 e 2h.");
  }
  const permanencia = jornadaMin + intervaloMin;
  const turnos = new Map<string, { inicio: number; fim: number; intervalo: number; dias: DiasSemana }>();

  const incluir = (inicio: number, fim: number, intervalo: number, dia: number) => {
    const chave = `${inicio}|${fim}|${intervalo}`;
    const atual = turnos.get(chave) ?? { inicio, fim, intervalo, dias: NENHUM_DIA };
    atual.dias = uniaoDias(atual.dias, diasDeIndices([dia]));
    turnos.set(chave, atual);
  };

  for (const j of janelas) {
    if (!Number.isInteger(j.dia) || j.dia < 0 || j.dia > 6) {
      throw new ErroMotor("diaInvalido", `Dia ${j.dia} inválido (use 0 = segunda ... 6 = domingo).`);
    }
    if (j.abreMin < 0 || j.abreMin >= MINUTOS_DIA || j.fechaMin < 0 || j.fechaMin >= MINUTOS_DIA) {
      throw new ErroMotor("horaInvalida", "Abertura e fechamento devem estar entre 00:00 e 23:59.");
    }
    const aberto = duracaoJanela(j.abreMin, j.fechaMin);
    if (aberto <= permanencia) {
      // A janela cabe numa jornada só: um turno do abre ao fecha.
      incluir(j.abreMin, j.fechaMin, aberto > intervaloMin ? intervaloMin : 0, j.dia);
      continue;
    }
    const quantidade = Math.ceil(aberto / permanencia);
    const folga = aberto - permanencia;
    for (let i = 0; i < quantidade; i++) {
      // Último turno encosta no fechamento; os demais, espaçamento igual em passos de 15 min.
      const deslocamento = i + 1 === quantidade ? folga : Math.floor((Math.floor((folga * i) / (quantidade - 1)) + 7) / 15) * 15;
      incluir((j.abreMin + deslocamento) % MINUTOS_DIA, (j.abreMin + deslocamento + permanencia) % MINUTOS_DIA, intervaloMin, j.dia);
    }
  }

  const gerados: TurnoGerado[] = [];
  const ordenados = [...turnos.values()].sort((a, b) => a.inicio - b.inicio || a.fim - b.fim || a.intervalo - b.intervalo);
  for (const t of ordenados) {
    const horario = tentarCriarHorario(t.inicio, t.fim, t.intervalo);
    if (!horario) continue;
    const periodo = periodoDeInicio(t.inicio);
    gerados.push({ nome: nomePeriodo(periodo), horario, dias: t.dias, periodo });
  }

  // Nomes repetidos ganham o início ("Manhã 10:00") e, se ainda repetirem, o horário inteiro.
  desempatar(gerados, (t) => `${t.nome} ${formatarHora(t.horario.inicioMin)}`);
  desempatar(gerados, (t) => `${t.nome}–${formatarHora(t.horario.fimMin)}`);
  return gerados;
}

function desempatar(turnos: TurnoGerado[], novoNome: (t: TurnoGerado) => string): void {
  const contagem = new Map<string, number>();
  for (const t of turnos) contagem.set(t.nome, (contagem.get(t.nome) ?? 0) + 1);
  for (const t of turnos) {
    if ((contagem.get(t.nome) ?? 0) > 1) t.nome = novoNome(t);
  }
}

/** Turnos mais curtos que a jornada (quem os faz fica com horas a menos na semana). */
export function turnosMaisCurtosQueAJornada(turnos: readonly TurnoGerado[], jornadaMin: number): TurnoGerado[] {
  return turnos.filter((t) => minutosTrabalhados(t.horario) < jornadaMin);
}

// ---------------------------------------------------------------------------
// Avisos da configuração de funcionamento
// ---------------------------------------------------------------------------

export type CampoAvisoFuncionamento =
  | "regime"
  | "carga"
  | "jornadaMax"
  | "folgas"
  | "descanso"
  | "diasSeguidos"
  | "domingos"
  | "jornada"
  | "intervalo"
  | "turnos";

/** Afastamento da lei ou da CLT que não impede de salvar. */
export interface AvisoFuncionamento {
  campo: CampoAvisoFuncionamento;
  tipo: "atencao" | "info";
  texto: string;
}

export interface EntradaAvisosFuncionamento {
  regras: RegrasCarga;
  /** Etapas do regime legal (vazio = só as regras da empresa). */
  regime: readonly EtapaRegime[];
  janelas: readonly JanelaDia[];
  jornadaMin: number;
  intervaloMin: number;
}

/**
 * O que a configuração tem de diferente da lei e da CLT. São avisos, não erros: não impedem salvar.
 */
export function avisosFuncionamento(entrada: EntradaAvisosFuncionamento): AvisoFuncionamento[] {
  const { regras, regime, janelas, jornadaMin, intervaloMin } = entrada;
  const avisos: AvisoFuncionamento[] = [];
  const adicionar = (campo: CampoAvisoFuncionamento, texto: string, tipo: AvisoFuncionamento["tipo"] = "atencao") =>
    avisos.push({ campo, tipo, texto });

  if (regime.length === 0) {
    adicionar(
      "regime",
      "Sem a EC 141, a escala não aplica as 42h e as 2 folgas por semana nas datas da lei (nem as 40h depois): vale só o que está nas regras da empresa.",
    );
  }
  if (regras.cargaSemanalMaxMin > 44 * 60) {
    adicionar(
      "carga",
      "Acima de 44h por semana, a Constituição (art. 7º, XIII) conta as horas como extras. A escala não passa deste limite, mas ele foge da lei.",
    );
  }
  if (regras.jornadaDiariaMaxMin > 8 * 60) {
    adicionar("jornadaMax", "A CLT (art. 58) e a EC 141 limitam a jornada a 8h por dia; passar disso só com acordo de compensação ou hora extra.");
  }
  if (regras.folgasSemanaisMin === 0) {
    adicionar(
      "folgas",
      `O descanso semanal é um direito (CLT art. 67): sem folga mínima, a escala pode deixar uma semana inteira sem folga.${regime.length > 0 ? " O regime da EC 141 ainda exige as folgas da lei." : ""}`,
    );
  }
  if (regras.descansoEntreJornadasMin < 11 * 60) {
    adicionar("descanso", "A CLT (art. 66) exige ao menos 11h de descanso entre duas jornadas.");
  }
  if (regras.maxDiasConsecutivos > 6) {
    adicionar("diasSeguidos", "A folga semanal deve vir até o 7º dia seguido de trabalho (CLT art. 67): mais de 6 dias seguidos foge disso.");
  }
  const abreDomingo = janelas.some((j) => j.dia === 6);
  const domingos = regras.domingosSeguidosMax;
  if (abreDomingo && !(domingos >= 1 && domingos <= 2)) {
    adicionar(
      "domingos",
      domingos === 0
        ? "Sem limite de domingos seguidos. No comércio, a Lei 10.101/2000 exige folga em ao menos 1 domingo a cada 3 semanas: use 2."
        : `${domingos} domingos seguidos passam do que a Lei 10.101/2000 permite no comércio (folga em ao menos 1 domingo a cada 3 semanas): use 2.`,
      "info",
    );
  }
  if (jornadaMin > 6 * 60 && (intervaloMin < 60 || intervaloMin > 120)) {
    adicionar("intervalo", "Para jornadas acima de 6h, a CLT (art. 71) pede de 1h a 2h de intervalo.");
  } else if (jornadaMin > 4 * 60 && jornadaMin <= 6 * 60 && intervaloMin < 15) {
    adicionar("intervalo", "Para jornadas de mais de 4h até 6h, a CLT (art. 71, § 1º) pede ao menos 15 min de intervalo.");
  }

  // A fase final do regime corta dias da jornada? (ex.: 8h × 5 dias = 40h cabe; 8h × 6 dias não)
  const diasAbertos = new Set(janelas.map((j) => j.dia)).size;
  const final = regime.reduce<EtapaRegime | undefined>((a, e) => (a === undefined || e.vigencia > a.vigencia ? e : a), undefined);
  const limiteFinal = Math.min(regras.cargaSemanalMaxMin, final?.cargaSemanalMaxMin ?? regras.cargaSemanalMaxMin);
  const folgasFinal = Math.max(regras.folgasSemanaisMin, final?.folgasSemanaisMin ?? regras.folgasSemanaisMin);
  if (jornadaMin > 0) {
    const possiveis = Math.max(0, Math.min(7 - folgasFinal, diasAbertos));
    const noLimite = Math.floor(limiteFinal / jornadaMin);
    if (noLimite < possiveis && noLimite > 0) {
      avisos.push({
        campo: "jornada",
        tipo: "atencao",
        texto: `Pelo limite de ${formatarMinutos(limiteFinal)} por semana, uma jornada de ${formatarMinutos(jornadaMin)} cabe em ${noLimite} ${
          noLimite === 1 ? "dia" : "dias"
        } (${formatarMinutos(noLimite * jornadaMin)}), menos que os ${possiveis} dias possíveis. Para usar os ${possiveis} dias, a jornada deve ser de até ${formatarMinutos(
          Math.floor(limiteFinal / possiveis),
        )}.`,
      });
    }
  }

  // Turnos mais curtos que a jornada.
  if (janelas.length > 0 && jornadaMin >= 60 && jornadaMin <= 12 * 60 && intervaloMin >= 0 && intervaloMin <= 120) {
    const curtos = turnosMaisCurtosQueAJornada(gerarTurnos(janelas, jornadaMin, intervaloMin), jornadaMin);
    if (curtos.length > 0) {
      adicionar(
        "turnos",
        `${curtos.map((t) => `${t.nome} (${formatarHorario(t.horario)})`).join(", ")} ${curtos.length === 1 ? "tem" : "têm"} menos horas que a jornada de ${formatarMinutos(
          jornadaMin,
        )}: quem trabalhar nele fica com horas a menos na semana (o saldo é compensado depois, se as regras deixarem). Para cobrir esse dia sem perder horas, abra o dia por pelo menos ${formatarMinutos(
          jornadaMin + intervaloMin,
        )} ou ajuste no Quadro.`,
      );
    }
  }
  return avisos;
}
