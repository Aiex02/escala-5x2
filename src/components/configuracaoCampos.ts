// Campos, validação e avisos da configuração personalizada (Configurações > Funcionamento e
// jornada). Os campos ficam como texto enquanto o usuário digita; `paraEntrada` os converte
// no corpo do `salvarConfiguracao`. As regras de validação espelham as do backend: o que ele
// recusaria é erro (impede salvar); o que só foge da lei ou da CLT é aviso (não impede).

import type { ConfiguracaoEntrada, DiaFuncionamento, InicioSemana, ModeloFuncionamento, RegimeLegal, Regras } from "../api/types";
import { formatarHoras, formatarMinutos, formatarNumero, horaParaMinutos } from "../util/formato";
import { paraHora, type PreviaTurno } from "../util/funcionamento";
import { regrasAoAplicar, type ResumoSemanal } from "../util/modelosFuncionamento";
import { calcularFases, PUBLICACAO_EC141_PADRAO } from "../util/regime";
import { brParaIso, isoParaBr, lerNumero } from "./base/CampoNumero";

export interface Campos {
  /** Sempre os 7 dias, de segunda (0) a domingo (6). */
  dias: DiaFuncionamento[];
  jornada: string;
  intervalo: string;
  carga: string;
  jornadaMax: string;
  descanso: string;
  diasSeguidos: string;
  folgas: string;
  domingos: string;
  inicio: InicioSemana;
  regime: RegimeLegal;
  /** "dd/mm/aaaa" enquanto digita. */
  publicacao: string;
}

export interface ErroDia {
  abre?: string;
  fecha?: string;
}

export interface Erros {
  /** Problema que não pertence a um campo só (nenhum dia aberto). */
  geral?: string;
  /** Um item por dia da semana, na mesma ordem de `Campos.dias`. */
  dias: ErroDia[];
  jornada?: string;
  intervalo?: string;
  carga?: string;
  jornadaMax?: string;
  descanso?: string;
  diasSeguidos?: string;
  folgas?: string;
  domingos?: string;
  publicacao?: string;
}

const ABRE_PADRAO = 8 * 60;
const FECHA_PADRAO = 18 * 60;

/** Sempre sete dias, de segunda a domingo, mesmo que o backend devolva menos. */
export function camposDe(funcionamento: readonly DiaFuncionamento[], regras: Regras): Campos {
  return {
    dias: Array.from({ length: 7 }, (_, dia) => {
      const salvo = funcionamento.find((d) => d.dia === dia);
      return salvo ? { ...salvo } : { dia, aberto: false, abre: paraHora(ABRE_PADRAO), fecha: paraHora(FECHA_PADRAO) };
    }),
    jornada: formatarNumero(regras.jornadaPadraoHoras),
    intervalo: String(regras.intervaloPadraoMin),
    carga: formatarNumero(regras.cargaSemanalMaxHoras),
    jornadaMax: formatarNumero(regras.jornadaDiariaMaxHoras),
    descanso: formatarNumero(regras.descansoEntreJornadasHoras),
    diasSeguidos: String(regras.maxDiasConsecutivos),
    folgas: String(regras.folgasSemanaisMin),
    domingos: String(regras.domingosSeguidosMax),
    inicio: regras.inicioSemana,
    regime: regras.regime,
    publicacao: isoParaBr(regras.ec141Publicacao ?? PUBLICACAO_EC141_PADRAO),
  };
}

/** Os valores do modelo como ficam ao aplicá-lo a um cliente com as regras `salvas`. */
export function camposDoModelo(modelo: ModeloFuncionamento, salvas: Regras): Campos {
  return camposDe(modelo.dias, { ...regrasAoAplicar(modelo, salvas), jornadaPadraoHoras: modelo.jornadaHoras, intervaloPadraoMin: modelo.intervaloMin });
}

/** Horários em "HH:MM" completo (o campo aceita "7:00" até perder o foco). */
export function normalizarDia(d: DiaFuncionamento): DiaFuncionamento {
  return { ...d, abre: paraHora(horaParaMinutos(d.abre) ?? ABRE_PADRAO), fecha: paraHora(horaParaMinutos(d.fecha) ?? FECHA_PADRAO) };
}

export function validar(c: Campos): Erros {
  const erros: Erros = { dias: c.dias.map(() => ({})) };
  if (!c.dias.some((d) => d.aberto)) erros.geral = "Marque ao menos um dia de funcionamento.";
  c.dias.forEach((d, i) => {
    if (!d.aberto) return;
    const erro: ErroDia = {};
    if (horaParaMinutos(d.abre) === null) erro.abre = "Use HH:MM, ex. 10:00.";
    if (horaParaMinutos(d.fecha) === null) erro.fecha = "Use HH:MM, ex. 22:00.";
    erros.dias[i] = erro;
  });

  const jornada = lerNumero(c.jornada);
  const intervalo = lerNumero(c.intervalo);
  const carga = lerNumero(c.carga);
  const jornadaMax = lerNumero(c.jornadaMax);
  const descanso = lerNumero(c.descanso);
  const diasSeguidos = lerNumero(c.diasSeguidos);
  const folgas = lerNumero(c.folgas);
  const domingos = lerNumero(c.domingos);

  if (Number.isNaN(jornada) || jornada < 1 || jornada > 12) erros.jornada = "Use de 1 a 12 horas.";
  if (!Number.isInteger(intervalo) || intervalo < 0 || intervalo > 120) erros.intervalo = "Minutos inteiros, de 0 a 120.";

  if (!(carga > 0)) erros.carga = "Informe um valor maior que zero.";
  else if (carga > 168) erros.carga = "A semana tem 168 horas.";
  if (!(jornadaMax > 0)) erros.jornadaMax = "Informe um valor maior que zero.";
  else if (jornadaMax > 24) erros.jornadaMax = "No máximo 24 horas.";
  else if (carga > 0 && jornadaMax > carga) erros.jornadaMax = "Não pode passar da carga semanal.";
  if (Number.isNaN(descanso) || descanso < 0) erros.descanso = "Informe zero ou mais horas.";
  else if (descanso > 48) erros.descanso = "No máximo 48 horas.";
  if (!Number.isInteger(diasSeguidos) || diasSeguidos < 1 || diasSeguidos > 31) erros.diasSeguidos = "Número inteiro de 1 a 31.";
  if (!Number.isInteger(folgas) || folgas < 0 || folgas > 6) erros.folgas = "Número inteiro de 0 a 6.";
  if (!Number.isInteger(domingos) || domingos < 0 || domingos > 52) erros.domingos = "Número inteiro de 0 a 52.";
  if (c.regime === "ec141" && brParaIso(c.publicacao) === null) erros.publicacao = "Use dd/mm/aaaa.";

  // O backend recusa jornada acima do máximo diário: marca os dois campos envolvidos.
  if (!erros.jornada && !erros.jornadaMax && jornada > jornadaMax + 1e-9) {
    erros.jornada = `Passa da jornada diária máxima de ${formatarHoras(jornadaMax)}. Reduza a jornada ou aumente o máximo.`;
    erros.jornadaMax = `Menor que a jornada de ${formatarHoras(jornada)} dos funcionários. Aumente o máximo ou reduza a jornada.`;
  }
  return erros;
}

export function temErro(e: Erros): boolean {
  return (
    !!e.geral ||
    e.dias.some((d) => !!d.abre || !!d.fecha) ||
    !!(e.jornada || e.intervalo || e.carga || e.jornadaMax || e.descanso || e.diasSeguidos || e.folgas || e.domingos || e.publicacao)
  );
}

/** As regras dos campos (válidos), com as fases da EC 141 recalculadas aqui; o backend as confirma ao salvar. */
export function regrasDeCampos(c: Campos): Regras {
  const carga = lerNumero(c.carga);
  const folgas = lerNumero(c.folgas);
  const publicacao = c.regime === "ec141" ? brParaIso(c.publicacao) : null;
  return {
    cargaSemanalMaxHoras: carga,
    jornadaDiariaMaxHoras: lerNumero(c.jornadaMax),
    descansoEntreJornadasHoras: lerNumero(c.descanso),
    maxDiasConsecutivos: lerNumero(c.diasSeguidos),
    inicioSemana: c.inicio,
    folgasSemanaisMin: folgas,
    domingosSeguidosMax: lerNumero(c.domingos),
    regime: c.regime,
    ec141Publicacao: publicacao,
    fases: calcularFases(c.regime, publicacao, carga, folgas),
    jornadaPadraoHoras: lerNumero(c.jornada),
    intervaloPadraoMin: lerNumero(c.intervalo),
  };
}

/** Corpo do `salvarConfiguracao` para a configuração personalizada. */
export function paraEntrada(c: Campos): ConfiguracaoEntrada {
  return {
    modelo: null,
    regras: regrasDeCampos(c),
    funcionamento: { dias: c.dias.map(normalizarDia), jornadaHoras: lerNumero(c.jornada), intervaloMin: lerNumero(c.intervalo) },
  };
}

// ---------- Avisos ----------

/** Campo a que o aviso se refere: ele aparece ao lado dele. */
export type CampoAviso = "regime" | "carga" | "jornadaMax" | "folgas" | "descanso" | "diasSeguidos" | "domingos" | "jornada" | "intervalo" | "turnos";

/** Afastamento da lei ou da CLT que não impede de salvar. */
export interface AvisoConfiguracao {
  campo: CampoAviso;
  tipo: "atencao" | "info";
  texto: string;
}

/**
 * O que a configuração tem de diferente da lei e da CLT. Só avalia números válidos: os campos
 * com erro já mostram o próprio problema. `resumo` e `curtos` vêm da mesma prévia da tela.
 */
export function avisosDe(c: Campos, resumo: ResumoSemanal | null, curtos: readonly PreviaTurno[]): AvisoConfiguracao[] {
  const avisos: AvisoConfiguracao[] = [];
  const adicionar = (campo: CampoAviso, texto: string, tipo: AvisoConfiguracao["tipo"] = "atencao") => avisos.push({ campo, tipo, texto });

  const jornada = lerNumero(c.jornada);
  const intervalo = lerNumero(c.intervalo);
  const carga = lerNumero(c.carga);
  const jornadaMax = lerNumero(c.jornadaMax);
  const descanso = lerNumero(c.descanso);
  const diasSeguidos = lerNumero(c.diasSeguidos);
  const folgas = lerNumero(c.folgas);
  const domingos = lerNumero(c.domingos);

  if (c.regime === "livre") {
    adicionar("regime", "Sem a EC 141, a escala não aplica as 42h e as 2 folgas por semana nas datas da lei (nem as 40h depois): vale só o que está nas regras da empresa.");
  }
  if (carga > 44) {
    adicionar("carga", "Acima de 44h por semana, a Constituição (art. 7º, XIII) conta as horas como extras. A escala não passa deste limite, mas ele foge da lei.");
  }
  if (jornadaMax > 8) {
    adicionar("jornadaMax", "A CLT (art. 58) e a EC 141 limitam a jornada a 8h por dia; passar disso só com acordo de compensação ou hora extra.");
  }
  if (folgas === 0) {
    adicionar(
      "folgas",
      `O descanso semanal é um direito (CLT art. 67): sem folga mínima, a escala pode deixar uma semana inteira sem folga.${c.regime === "ec141" ? " O regime da EC 141 ainda exige as folgas da lei." : ""}`,
    );
  }
  if (descanso < 11) {
    adicionar("descanso", "A CLT (art. 66) exige ao menos 11h de descanso entre duas jornadas.");
  }
  if (diasSeguidos > 6) {
    adicionar("diasSeguidos", "A folga semanal deve vir até o 7º dia seguido de trabalho (CLT art. 67): mais de 6 dias seguidos foge disso.");
  }
  if (c.dias[6]?.aberto && !Number.isNaN(domingos) && !(domingos >= 1 && domingos <= 2)) {
    adicionar(
      "domingos",
      domingos === 0
        ? "Sem limite de domingos seguidos. No comércio, a Lei 10.101/2000 exige folga em ao menos 1 domingo a cada 3 semanas: use 2."
        : `${domingos} domingos seguidos passam do que a Lei 10.101/2000 permite no comércio (folga em ao menos 1 domingo a cada 3 semanas): use 2.`,
      "info",
    );
  }
  if (jornada > 6 && (intervalo < 60 || intervalo > 120)) {
    adicionar("intervalo", "Para jornadas acima de 6h, a CLT (art. 71) pede de 1h a 2h de intervalo.");
  } else if (jornada > 4 && jornada <= 6 && intervalo < 15) {
    adicionar("intervalo", "Para jornadas de mais de 4h até 6h, a CLT (art. 71, § 1º) pede ao menos 15 min de intervalo.");
  }
  for (const texto of resumo?.avisos ?? []) adicionar("jornada", texto);
  if (curtos.length > 0) {
    const jornadaMin = Math.round(jornada * 60);
    adicionar(
      "turnos",
      `${curtos.map((t) => t.nome).join(", ")} ${curtos.length === 1 ? "tem" : "têm"} menos horas que a jornada de ${formatarMinutos(jornadaMin)}: quem trabalhar nele fica com horas a menos na semana, então a escala só usa ${
        curtos.length === 1 ? "esse turno" : "esses turnos"
      } quando não tira horas de ninguém e avisa a falta de cobertura. Para cobrir esse dia sem perder horas, abra o dia por pelo menos ${formatarMinutos(jornadaMin + intervalo)} ou ajuste no Quadro.`,
    );
  }
  return avisos;
}
