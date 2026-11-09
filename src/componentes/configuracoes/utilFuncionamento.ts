// Utilitários de apresentação do funcionamento (puros, usados no servidor e no cliente).

import { CORES_TURNO, proximaCorLivre } from "@/lib/coresTurno";
import {
  formatarHora,
  indicesDias,
  tentarAnalisarHora,
  type JanelaDia,
  type TurnoGerado,
} from "@/motor";
import { nomeDiaCurto } from "@/lib/datas";

export const DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"] as const;

/** Rótulo curto de um conjunto de dias: "todos os dias", "seg–sáb", "seg, qua e sex". */
export function descreverDias(dias: readonly number[]): string {
  const ordenados = [...new Set(dias)].sort((a, b) => a - b);
  if (ordenados.length === 0) return "nenhum dia";
  if (ordenados.length === 7) return "todos os dias";
  if (ordenados.length === 1) return nomeDiaCurto(ordenados[0] as number);
  const consecutivos = ordenados.every((d, i) => i === 0 || d === (ordenados[i - 1] as number) + 1);
  if (consecutivos && ordenados.length > 2) {
    return `${nomeDiaCurto(ordenados[0] as number)}–${nomeDiaCurto(ordenados[ordenados.length - 1] as number)}`;
  }
  const nomes = ordenados.map(nomeDiaCurto);
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

export function descreverMascaraDias(mascara: number): string {
  return descreverDias(indicesDias(mascara));
}

/** Resumo do horário de funcionamento: "seg–sáb 10:00–22:00 · dom 14:00–20:15". */
export function resumirHorario(janelas: readonly JanelaDia[]): string {
  if (janelas.length === 0) return "Fechado";
  const grupos = new Map<string, number[]>();
  for (const j of [...janelas].sort((a, b) => a.dia - b.dia)) {
    const faixa = j.abreMin === j.fechaMin ? "24 horas" : `${formatarHora(j.abreMin)}–${formatarHora(j.fechaMin)}`;
    grupos.set(faixa, [...(grupos.get(faixa) ?? []), j.dia]);
  }
  return [...grupos.entries()].map(([faixa, dias]) => `${descreverDias(dias)} ${faixa}`).join(" · ");
}

export interface TurnoParaExibir {
  nome: string;
  inicioMin: number;
  fimMin: number;
  intervaloMin: number;
  diasSemana: number;
  cor: string;
}

/**
 * Cores da pré-visualização dos turnos gerados, no mesmo critério do servidor: horário igual a um
 * turno existente mantém a cor dele; os novos recebem a próxima cor livre da paleta.
 */
export function colorirTurnosGerados(
  gerados: readonly TurnoGerado[],
  existentes: readonly { inicioMin: number; fimMin: number; intervaloMin: number; cor: string }[] = [],
): TurnoParaExibir[] {
  const chave = (i: number, f: number, n: number) => `${i}|${f}|${n}`;
  const porHorario = new Map(existentes.map((t) => [chave(t.inicioMin, t.fimMin, t.intervaloMin), t.cor]));
  const usadas: string[] = [];
  const resultado = gerados.map((g) => {
    const h = g.horario;
    const cor = porHorario.get(chave(h.inicioMin, h.fimMin, h.intervaloMin)) ?? null;
    if (cor) usadas.push(cor);
    return { g, cor };
  });
  return resultado.map(({ g, cor }) => {
    let final = cor;
    if (!final) {
      final = proximaCorLivre(usadas);
      usadas.push(final);
    }
    return {
      nome: g.nome,
      inicioMin: g.horario.inicioMin,
      fimMin: g.horario.fimMin,
      intervaloMin: g.horario.intervaloMin,
      diasSemana: g.dias,
      cor: final,
    };
  });
}

/** Cor da paleta por posição (para pré-visualizações sem turnos existentes). */
export function corPorPosicao(i: number): string {
  return CORES_TURNO[i % CORES_TURNO.length];
}

/** "HH:MM" → minutos do dia, ou `null` se vazio/inválido. */
export function minutosDeHora(texto: string): number | null {
  return tentarAnalisarHora(texto);
}
