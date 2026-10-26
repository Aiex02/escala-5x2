// Turnos intercalados a partir do funcionamento do estabelecimento.
// Mesma regra do backend: a tela de configurações mostra a prévia antes de
// salvar e o backend simulado (`api/mock.ts`) gera os turnos com a mesma função.

import type { DiaFuncionamento, Periodo } from "../api/types";
import { duracaoTurnoMinutos, horaParaMinutos } from "./formato";

const dois = (n: number) => String(n).padStart(2, "0");

/** Minutos desde a meia-noite -> "HH:MM" (dá a volta após 24h). */
export function paraHora(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${dois(Math.floor(m / 60))}:${dois(m % 60)}`;
}

/** Período do dia pela hora de início: manhã até 12h, tarde até 18h, depois noite. */
export function periodoDe(inicio: string): Periodo {
  const m = horaParaMinutos(inicio) ?? 0;
  // Início de madrugada (antes das 5h) conta como noite.
  return m < 300 ? "noite" : m < 720 ? "manha" : m < 1080 ? "tarde" : "noite";
}

export const NOME_PERIODO: Record<Periodo, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };

export interface TurnoCalculado {
  inicio: string;
  fim: string;
  /** Intervalo não remunerado, em minutos. */
  intervalo: number;
  /** Dias da semana (0 = segunda ... 6 = domingo) em que o turno existe. */
  dias: number[];
}

/**
 * Turnos intercalados cobrindo a janela de cada dia aberto. Cada turno dura a
 * jornada mais o intervalo; o último termina no fechamento e os demais se
 * distribuem em passos de 15 minutos. Turnos iguais de dias diferentes se juntam.
 */
export function gerarTurnos(dias: DiaFuncionamento[], jornadaMin: number, intervaloMin: number): TurnoCalculado[] {
  const permanencia = jornadaMin + intervaloMin;
  const mapa = new Map<string, TurnoCalculado>();
  for (const d of dias.filter((x) => x.aberto)) {
    const abre = horaParaMinutos(d.abre) ?? 0;
    const aberto = duracaoTurnoMinutos(d.abre, d.fecha) ?? 0;
    const blocos: [number, number, number][] = [];
    if (aberto <= permanencia) {
      blocos.push([abre, abre + aberto, aberto > intervaloMin ? intervaloMin : 0]);
    } else {
      const n = Math.ceil(aberto / permanencia);
      const folga = aberto - permanencia;
      for (let i = 0; i < n; i++) {
        const desloc = i === n - 1 ? folga : Math.floor(((folga * i) / (n - 1) + 7) / 15) * 15;
        blocos.push([abre + desloc, abre + desloc + permanencia, intervaloMin]);
      }
    }
    for (const [ini, fim, iv] of blocos) {
      const chave = `${paraHora(ini)}-${paraHora(fim)}-${iv}`;
      const item = mapa.get(chave) ?? { inicio: paraHora(ini), fim: paraHora(fim), intervalo: iv, dias: [] };
      item.dias.push(d.dia);
      mapa.set(chave, item);
    }
  }
  return [...mapa.values()].sort((a, b) => a.inicio.localeCompare(b.inicio) || a.fim.localeCompare(b.fim));
}

/** Nome de cada turno pelo período; se dois caem no mesmo período, o horário de início desempata. */
export function nomesTurnos(lista: TurnoCalculado[]): string[] {
  // Mesma regra do backend: nomes repetidos ganham o início e, se ainda repetirem, o fim.
  const desempatar = (nomes: string[], novo: (n: string, t: TurnoCalculado) => string) =>
    nomes.map((n, i) => {
      const t = lista[i];
      return t && nomes.filter((x) => x === n).length > 1 ? novo(n, t) : n;
    });
  const base = lista.map((t) => NOME_PERIODO[periodoDe(t.inicio)]);
  return desempatar(
    desempatar(base, (n, t) => `${n} ${t.inicio}`),
    (n, t) => `${n}–${t.fim}`,
  );
}

/** Intervalo sugerido pela CLT: até 4h sem intervalo, até 6h 15 min, acima disso 1h. */
export function intervaloSugerido(jornadaHoras: number): number {
  return jornadaHoras <= 4 ? 0 : jornadaHoras <= 6 ? 15 : 60;
}

export interface PreviaTurno extends TurnoCalculado {
  nome: string;
  periodo: Periodo;
  /** Duração do turno menos o intervalo, em minutos. */
  trabalhadasMin: number;
}

/** Turnos que o backend vai gerar para o funcionamento e a jornada informados. */
export function previaTurnos(dias: DiaFuncionamento[], jornadaHoras: number, intervaloMin: number): PreviaTurno[] {
  const lista = gerarTurnos(dias, Math.round(jornadaHoras * 60), intervaloMin);
  const nomes = nomesTurnos(lista);
  return lista.map((t, i) => ({
    ...t,
    nome: nomes[i] ?? "Turno",
    periodo: periodoDe(t.inicio),
    trabalhadasMin: (duracaoTurnoMinutos(t.inicio, t.fim) ?? 0) - t.intervalo,
  }));
}
