// Auxiliares dos modelos de funcionamento. Os modelos em si (horário, jornada e regras
// alinhados ao fim da escala 6x1, EC 141) vêm do backend em `api.listarModelos()`; aqui
// ficam as contas e os textos que a interface faz com eles.

import type { DiaFuncionamento, ModeloFuncionamento, Regras } from "../api/types";
import { formatarData, hojeISO } from "./datas";
import { formatarHoras, formatarNumero } from "./formato";
import { calcularFases, faseEmVigor } from "./regime";

/** Modelo que o cliente novo recebe quando nenhum é escolhido (o mesmo do backend). */
export const MODELO_PADRAO_ID = "shopping";

/**
 * Regras que ficam em vigor ao aplicar o modelo a um cliente com as regras `salvas`: as do
 * modelo, mas o regime da EC 141 mantém a data de publicação que o cliente já tem.
 */
export function regrasAoAplicar(modelo: ModeloFuncionamento, salvas: Regras): Regras {
  const m = modelo.regras;
  const publicacao = salvas.regime === "ec141" && salvas.ec141Publicacao ? salvas.ec141Publicacao : m.ec141Publicacao;
  return { ...m, ec141Publicacao: publicacao, fases: calcularFases(m.regime, publicacao, m.cargaSemanalMaxHoras, m.folgasSemanaisMin) };
}

/** As regras da empresa em frases curtas (a EC 141 aparece à parte, nas fases). */
export function resumoRegras(regras: Regras, domingoAberto: boolean): string[] {
  const dias = regras.maxDiasConsecutivos;
  const folgas = regras.folgasSemanaisMin;
  const maisFolgas = regras.fases.find((f) => f.desde !== null && f.folgasSemanaisMin > folgas);
  const domingos = regras.domingosSeguidosMax;
  return [
    `Até ${formatarHoras(regras.cargaSemanalMaxHoras)} por semana e ${formatarHoras(regras.jornadaDiariaMaxHoras)} por dia.`,
    `${formatarHoras(regras.descansoEntreJornadasHoras)} de descanso entre uma jornada e a seguinte.`,
    `No máximo ${dias} ${dias === 1 ? "dia seguido" : "dias seguidos"} de trabalho: folga até o ${dias + 1}º dia.`,
    folgas === 0
      ? "Sem folga mínima por semana definida pela empresa."
      : `Ao menos ${folgas} ${folgas === 1 ? "folga" : "folgas"} por semana${
          maisFolgas?.desde ? `; ${maisFolgas.folgasSemanaisMin} a partir de ${formatarData(maisFolgas.desde)} (EC 141)` : ""
        }.`,
    !domingoAberto
      ? "Não abre aos domingos."
      : domingos === 0
        ? "Sem limite de domingos seguidos de trabalho."
        : `No máximo ${domingos} ${domingos === 1 ? "domingo seguido" : "domingos seguidos"} de trabalho${domingos === 2 ? " (folga em 1 a cada 3, Lei 10.101)" : ""}.`,
    `A semana de apuração começa na ${regras.inicioSemana === "segunda" ? "segunda-feira" : "domingo"}.`,
  ];
}

// ---------- Horas por semana ----------

/** Horas por semana de uma pessoa em tempo integral, numa fase das regras. */
export interface ResumoFase {
  /** "Hoje, até 15/12/2026", "A partir de 16/12/2027"... */
  rotulo: string;
  limiteHoras: number;
  folgas: number;
  /** Dias de trabalho por semana: jornadas inteiras dentro do limite, das folgas e dos dias abertos. */
  dias: number;
  /** `dias` × jornada. */
  horas: number;
  /** O limite semanal tira jornadas: com ele caberiam menos dias do que as folgas e o funcionamento permitem. */
  cortadoPeloLimite: boolean;
  /** Ex.: "5 dias × 8h = 40h por semana (limite 42h)". */
  texto: string;
}

export interface ResumoSemanal {
  /** A fase em vigor hoje e a final; uma só quando coincidem ou não há fases. */
  fases: ResumoFase[];
  /** Problemas a mostrar ao usuário (o limite final corta dias da jornada). */
  avisos: string[];
}

interface LimiteFase {
  rotulo: string;
  limiteHoras: number;
  folgas: number;
}

/** A fase em vigor em `hoje` e a final das regras (ou o limite da empresa, no regime livre). */
function limitesDasFases(regras: Regras, hoje: string): LimiteFase[] {
  const fases = regras.fases;
  if (fases.length === 0) return [{ rotulo: "Regras da empresa", limiteHoras: regras.cargaSemanalMaxHoras, folgas: regras.folgasSemanaisMin }];
  const ultima = fases.length - 1;
  const atual = Math.max(0, faseEmVigor(fases, hoje));
  const dados = (i: number): LimiteFase => {
    const f = fases[i];
    const unica = atual === ultima;
    const rotulo =
      i === ultima
        ? f?.desde
          ? `${unica ? "Desde" : "A partir de"} ${formatarData(f.desde)}`
          : "Em vigor"
        : f?.ate
          ? `Hoje, até ${formatarData(f.ate)}`
          : "Hoje";
    return { rotulo, limiteHoras: f?.cargaSemanalMaxHoras ?? regras.cargaSemanalMaxHoras, folgas: f?.folgasSemanaisMin ?? regras.folgasSemanaisMin };
  };
  return atual === ultima ? [dados(ultima)] : [dados(atual), dados(ultima)];
}

function resumirFase(limite: LimiteFase, jornadaHoras: number, diasAbertos: number): ResumoFase {
  const possiveis = Math.max(0, Math.min(7 - limite.folgas, diasAbertos));
  const noLimite = jornadaHoras > 0 ? Math.floor(limite.limiteHoras / jornadaHoras + 1e-9) : 0;
  const dias = Math.min(possiveis, noLimite);
  const horas = dias * jornadaHoras;
  const cortadoPeloLimite = noLimite < possiveis;
  const texto =
    dias === 0
      ? `A jornada de ${formatarHoras(jornadaHoras)} é maior que o limite de ${formatarHoras(limite.limiteHoras)} por semana`
      : `${dias} ${dias === 1 ? "dia" : "dias"} × ${formatarHoras(jornadaHoras)} = ${formatarHoras(horas)} por semana (limite ${formatarHoras(limite.limiteHoras)}${
          cortadoPeloLimite ? `; um ${dias + 1}º dia passaria dele` : ""
        })`;
  return { rotulo: limite.rotulo, limiteHoras: limite.limiteHoras, folgas: limite.folgas, dias, horas, cortadoPeloLimite, texto };
}

/**
 * Horas por semana de quem trabalha em tempo integral com a jornada e os dias de
 * funcionamento informados, na fase das regras em vigor hoje e na final. Mesma conta do
 * motor: jornadas inteiras dentro do limite semanal, das folgas e dos dias abertos.
 */
export function resumoSemanal(entrada: { dias: readonly DiaFuncionamento[]; jornadaHoras: number }, regras: Regras, hoje: string = hojeISO()): ResumoSemanal {
  const diasAbertos = entrada.dias.filter((d) => d.aberto).length;
  const fases = limitesDasFases(regras, hoje).map((l) => resumirFase(l, entrada.jornadaHoras, diasAbertos));
  const avisos: string[] = [];

  // Só a fase final vira aviso: a atual passa, e é normal que o limite de hoje corte um dia.
  const final = fases[fases.length - 1];
  if (final?.cortadoPeloLimite && final.dias > 0) {
    const possiveis = Math.min(7 - final.folgas, diasAbertos);
    avisos.push(
      `Pelo limite de ${formatarHoras(final.limiteHoras)} por semana (${final.rotulo.toLowerCase()}), uma jornada de ${formatarHoras(entrada.jornadaHoras)} cabe em ${final.dias} ${
        final.dias === 1 ? "dia" : "dias"
      } (${formatarHoras(final.horas)}), menos que os ${possiveis} dias possíveis. Para usar os ${possiveis} dias, a jornada deve ser de até ${formatarNumero(final.limiteHoras / possiveis)}h.`,
    );
  }
  return { fases, avisos };
}
