import type { CSSProperties } from "react";
import { formatarHora, formatarMinutos } from "@/lib/formato";
import { nomeDiaCurto } from "@/lib/datas";
import type { AgendaMesDto, CelulaDto, TipoAvisoDto, TurnoAgendaDto, ValorDia } from "@/servicos/agendaDto";

/** Estilo de um turno a partir da cor do banco: fundo suave, borda sólida, texto legível em claro e escuro. */
export function estiloTurno(cor: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in oklch, ${cor} 30%, var(--superficie))`,
    borderColor: cor,
    color: `color-mix(in oklch, ${cor} 35%, var(--texto))`,
  };
}

export const NOMES_TIPO_AVISO: Record<TipoAvisoDto, string> = {
  coberturaInsuficiente: "Cobertura do turno",
  funcaoDescoberta: "Função sem cobertura",
  violacaoRegra: "Regra violada",
  cargaAbaixoDoAlvo: "Carga abaixo do alvo",
  turnoExcedeJornada: "Turno acima da jornada",
  funcionarioSemTurno: "Sem turno possível",
  coberturaParcial: "Cobertura parcial",
  horaExtra: "Hora extra",
  excessoSemanal: "Semana acima do limite",
};

export const NOMES_DIA_LONGO = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"];

export function formatarDiaMesBR(data: string): string {
  return `${data.slice(8, 10)}/${data.slice(5, 7)}`;
}

export function faixaHorario(inicioMin: number, fimMin: number): string {
  return `${formatarHora(inicioMin)}–${formatarHora(fimMin)}`;
}

/** Texto de uma célula para leitores de tela e dicas. */
export function descreverCelula(c: CelulaDto, turnos: ReadonlyMap<string, TurnoAgendaDto>): string {
  let texto: string;
  switch (c.tipo) {
    case "turno": {
      const t = turnos.get(c.turnoId);
      texto = `${t?.nome ?? "Turno"}, ${faixaHorario(c.inicioMin, c.fimMin)}`;
      if (c.origem === "horaExtra") texto += `, hora extra: +${formatarMinutos(c.extraMin)} (${faixaHorario(c.inicioMin, c.fimMin)})`;
      else if (c.compensada) texto += ", jornada compensada";
      break;
    }
    case "folga":
      texto = "Folga";
      break;
    case "falta":
      texto = "Falta";
      break;
    case "justificada":
      texto = c.motivo ? `Ausência justificada: ${c.motivo}` : "Ausência justificada";
      break;
    case "fechado":
      texto = "Estabelecimento fechado";
      break;
  }
  return c.ajustada ? `${texto}, ajustado manualmente` : texto;
}

/** Alguma pessoa da agenda tem hora extra no mês. */
export function temHoraExtra(agenda: AgendaMesDto): boolean {
  return agenda.grupos.some((g) => g.linhas.some((l) => l.horaExtraMesMin > 0));
}

export function classeSaldo(minutos: number): string {
  if (minutos < 0) return "text-critico";
  if (minutos > 0) return "text-atencao";
  return "text-texto-suave";
}

/** "+1h30", "−2h" ou "0h". */
export function textoSaldo(minutos: number): string {
  if (minutos === 0) return "0h";
  return `${minutos < 0 ? "−" : "+"}${formatarMinutos(minutos)}`;
}

export function celulaDoValor(valor: ValorDia, agenda: AgendaMesDto, indiceDia: number, antiga?: CelulaDto): CelulaDto {
  switch (valor.tipo) {
    case "turno": {
      const t = agenda.turnos.find((x) => x.id === valor.turnoId);
      return {
        tipo: "turno",
        turnoId: valor.turnoId,
        inicioMin: t?.inicioMin ?? 0,
        fimMin: t?.fimMin ?? 0,
        intervaloMin: t?.intervaloMin ?? 0,
        compensada: false,
        origem: "normal",
        extraMin: 0,
        ajustada: true,
      };
    }
    case "folga":
      return { tipo: "folga", ajustada: true };
    case "falta":
      return { tipo: "falta", ajustada: true };
    case "justificada":
      return { tipo: "justificada", motivo: valor.motivo?.trim() || null, ajustada: true };
    case "limpar":
      // Limpar nunca apaga a ausência cadastrada: só tira o ajuste.
      if (antiga?.tipo === "falta" || antiga?.tipo === "justificada") return { ...antiga, ajustada: false };
      return agenda.dias[indiceDia]?.aberto === false ? { tipo: "fechado", ajustada: false } : { tipo: "folga", ajustada: false };
  }
}

function minutosDaCelula(c: CelulaDto): number {
  if (c.tipo !== "turno") return 0;
  const bruto = c.fimMin <= c.inicioMin ? 1440 - c.inicioMin + c.fimMin : c.fimMin - c.inicioMin;
  return Math.max(0, bruto - c.intervaloMin);
}

/** Aplica um ajuste na agenda localmente (atualização otimista): a célula, os totais do dia e as horas do mês. */
export function aplicarOtimista(agenda: AgendaMesDto, funcionarioId: string, data: string, valor: ValorDia): AgendaMesDto {
  const i = agenda.dias.findIndex((d) => d.data === data);
  if (i < 0) return agenda;
  const antiga = agenda.grupos.flatMap((g) => g.linhas).find((l) => l.funcionarioId === funcionarioId)?.celulas[i];
  const nova = celulaDoValor(valor, agenda, i, antiga);
  const grupos = agenda.grupos.map((g) => {
    if (!g.linhas.some((l) => l.funcionarioId === funcionarioId)) return g;
    return {
      ...g,
      linhas: g.linhas.map((l) => {
        if (l.funcionarioId !== funcionarioId) return l;
        const celulas = l.celulas.slice();
        celulas[i] = nova;
        const delta = minutosDaCelula(nova) - (antiga ? minutosDaCelula(antiga) : 0);
        const extraAntiga = antiga?.tipo === "turno" ? antiga.extraMin : 0;
        return { ...l, celulas, horasMesMin: l.horasMesMin + delta, horaExtraMesMin: Math.max(0, l.horaExtraMesMin - extraAntiga) };
      }),
    };
  });
  const turnoAntigo = antiga?.tipo === "turno" ? antiga.turnoId : null;
  const turnoNovo = nova.tipo === "turno" ? nova.turnoId : null;
  const totaisPorTurno =
    turnoAntigo === turnoNovo
      ? agenda.totaisPorTurno
      : agenda.totaisPorTurno.map((t) => {
          if (t.turnoId !== turnoAntigo && t.turnoId !== turnoNovo) return t;
          const porDia = t.porDia.slice();
          porDia[i] = (porDia[i] ?? 0) + (t.turnoId === turnoNovo ? 1 : 0) - (t.turnoId === turnoAntigo ? 1 : 0);
          return { ...t, porDia };
        });
  const trabalhandoPorDia = agenda.trabalhandoPorDia.slice();
  trabalhandoPorDia[i] = (trabalhandoPorDia[i] ?? 0) + (turnoNovo ? 1 : 0) - (turnoAntigo ? 1 : 0);
  return { ...agenda, grupos, totaisPorTurno, trabalhandoPorDia };
}

/** Célula que pode participar de uma troca (jornada ou folga). */
export function celulaTrocavel(c: CelulaDto | undefined): boolean {
  return c?.tipo === "turno" || c?.tipo === "folga";
}

/** Troca otimista do dia entre duas pessoas: as células trocam de dono; os totais do dia não mudam. */
export function aplicarTrocaOtimista(agenda: AgendaMesDto, data: string, funcionarioA: string, funcionarioB: string): AgendaMesDto {
  const i = agenda.dias.findIndex((d) => d.data === data);
  if (i < 0) return agenda;
  const linhas = agenda.grupos.flatMap((g) => g.linhas);
  const celulaA = linhas.find((l) => l.funcionarioId === funcionarioA)?.celulas[i];
  const celulaB = linhas.find((l) => l.funcionarioId === funcionarioB)?.celulas[i];
  if (!celulaA || !celulaB || !celulaTrocavel(celulaA) || !celulaTrocavel(celulaB)) return agenda;
  const extra = (c: CelulaDto): number => (c.tipo === "turno" ? c.extraMin : 0);
  const grupos = agenda.grupos.map((g) => ({
    ...g,
    linhas: g.linhas.map((l) => {
      const [minha, outra] = l.funcionarioId === funcionarioA ? [celulaA, celulaB] : l.funcionarioId === funcionarioB ? [celulaB, celulaA] : [null, null];
      if (!minha || !outra) return l;
      const celulas = l.celulas.slice();
      celulas[i] = { ...outra, ajustada: true };
      return {
        ...l,
        celulas,
        horasMesMin: l.horasMesMin + minutosDaCelula(outra) - minutosDaCelula(minha),
        horaExtraMesMin: Math.max(0, l.horaExtraMesMin - extra(minha) + extra(outra)),
      };
    }),
  }));
  return { ...agenda, grupos };
}

export function rotuloDia(data: string, diaSemana: number): string {
  return `${nomeDiaCurto(diaSemana)} ${formatarDiaMesBR(data)}`;
}
