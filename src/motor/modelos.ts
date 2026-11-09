// Modelos de funcionamento prontos: horário do estabelecimento, jornada dos funcionários e
// regras de jornada já alinhadas ao fim da escala 6x1 (EC 141/2026).
//
// Todos cabem na regra final da lei (40h e 2 folgas por semana): jornada × 5 dias ≤ 40h,
// intervalo da CLT (até 4h sem intervalo; até 6h, 15 min; acima, 1h) e nenhum turno mais curto
// que a jornada. As regras da empresa ficam no teto da CLT (44h, 8h por dia, 11h entre
// jornadas, folga a cada 6 dias); o regime da EC 141 reduz para 42h e depois 40h, com 2 folgas,
// nas datas da lei.

import { ErroMotor } from "./erros";
import { intervaloPadrao, type JanelaDia } from "./funcionamento";
import { analisarHora } from "./hora";
import type { RegrasCarga } from "./modelo";

/** Modelo de cliente novo. */
export const MODELO_PADRAO = "shopping";

export interface FuncionamentoDoModelo {
  janelas: JanelaDia[];
  jornadaMin: number;
  intervaloMin: number;
}

export interface ModeloFuncionamento {
  id: string;
  nome: string;
  /** Para quem serve, em uma frase. */
  descricao: string;
  /** Janelas dos dias em que abre (0 = segunda ... 6 = domingo). */
  janelas: JanelaDia[];
  jornadaMin: number;
  intervaloMin: number;
  /** Domingos seguidos de trabalho (0 = sem limite). Lei 10.101/2000: use 2 no comércio. */
  domingosSeguidosMax: number;
}

type Faixa = readonly [abre: string, fecha: string];

const TODOS = [0, 1, 2, 3, 4, 5, 6];
const SEG_SAB = [0, 1, 2, 3, 4, 5];
const SEG_SEX = [0, 1, 2, 3, 4];
const TER_DOM = [1, 2, 3, 4, 5, 6];

/** Janelas dos `abertos` com `padrao`, e `especiais` em dias isolados. */
function semana(abertos: readonly number[], padrao: Faixa, especiais: ReadonlyArray<readonly [number, Faixa]> = []): JanelaDia[] {
  return abertos.map((dia) => {
    const [abre, fecha] = especiais.find(([d]) => d === dia)?.[1] ?? padrao;
    return { dia, abreMin: analisarHora(abre), fechaMin: analisarHora(fecha) };
  });
}

export const MODELOS: readonly ModeloFuncionamento[] = [
  {
    id: MODELO_PADRAO,
    nome: "Shopping",
    descricao: "Lojas de shopping e galerias, abertas todos os dias.",
    janelas: semana(TODOS, ["10:00", "22:00"]),
    jornadaMin: 6 * 60,
    intervaloMin: 15,
    domingosSeguidosMax: 2,
  },
  {
    id: "shopping-domingo-reduzido",
    nome: "Shopping com domingo reduzido",
    descricao: "Shopping que abre só à tarde aos domingos.",
    // Domingo até 20:15: o turno de 6h + 15 min só cabe inteiro em 6h15.
    janelas: semana(TODOS, ["10:00", "22:00"], [[6, ["14:00", "20:15"]]]),
    jornadaMin: 6 * 60,
    intervaloMin: 15,
    domingosSeguidosMax: 2,
  },
  {
    id: "comercio",
    nome: "Comércio / varejo",
    descricao: "Loja de rua, de segunda a sábado.",
    janelas: semana(SEG_SAB, ["09:00", "19:00"]),
    jornadaMin: 8 * 60,
    intervaloMin: 60,
    domingosSeguidosMax: 0,
  },
  {
    id: "supermercado",
    nome: "Supermercado",
    descricao: "Supermercado e atacado, em horário estendido todos os dias.",
    janelas: semana(TODOS, ["07:00", "22:00"]),
    jornadaMin: 8 * 60,
    intervaloMin: 60,
    domingosSeguidosMax: 2,
  },
  {
    id: "administrativo",
    nome: "Administrativo (CLT)",
    descricao: "Escritório em horário comercial, com 1h de almoço.",
    janelas: semana(SEG_SEX, ["08:00", "17:00"]),
    jornadaMin: 8 * 60,
    intervaloMin: 60,
    domingosSeguidosMax: 0,
  },
  {
    id: "restaurante",
    nome: "Restaurante",
    descricao: "Restaurante com almoço e jantar; fecha às segundas.",
    janelas: semana(TER_DOM, ["11:00", "23:00"]),
    jornadaMin: 8 * 60,
    intervaloMin: 60,
    domingosSeguidosMax: 2,
  },
  {
    id: "24-horas",
    nome: "24 horas",
    descricao: "Farmácia, posto ou hospital: abre sem parar, em três turnos de 8h.",
    janelas: semana(TODOS, ["06:00", "06:00"]),
    jornadaMin: 8 * 60,
    intervaloMin: 60,
    // Escala de revezamento: folga em ao menos um domingo a cada 7 semanas.
    domingosSeguidosMax: 6,
  },
];

// Garante em tempo de carga que a jornada de cada modelo usa o intervalo padrão da CLT.
for (const m of MODELOS) {
  if (m.intervaloMin !== intervaloPadrao(m.jornadaMin)) {
    throw new ErroMotor("modeloInvalido", `Modelo ${m.id}: o intervalo não segue o padrão da CLT.`);
  }
}

export function listarModelos(): readonly ModeloFuncionamento[] {
  return MODELOS;
}

/** O modelo, ou `undefined` se o id não existir. */
export function buscarModelo(id: string): ModeloFuncionamento | undefined {
  return MODELOS.find((m) => m.id === id);
}

/** O modelo; lança `ErroMotor` ("modeloDesconhecido") se o id não existir. */
export function modeloPorId(id: string): ModeloFuncionamento {
  const modelo = buscarModelo(id);
  if (!modelo) throw new ErroMotor("modeloDesconhecido", `Modelo de funcionamento "${id}" desconhecido.`);
  return modelo;
}

/** Regras da empresa do modelo; o regime da EC 141 aplica os limites da lei por cima. */
export function regrasDoModelo(id: string): RegrasCarga {
  const modelo = modeloPorId(id);
  return {
    cargaSemanalMaxMin: 44 * 60,
    jornadaDiariaMaxMin: 8 * 60,
    descansoEntreJornadasMin: 11 * 60,
    maxDiasConsecutivos: 6,
    inicioSemana: "segunda",
    folgasSemanaisMin: 1,
    domingosSeguidosMax: modelo.domingosSeguidosMax,
    jornadaContratualMin: modelo.jornadaMin,
    permitirHoraExtra: true,
    horaExtraDiariaMaxMin: 120,
  };
}

/** Janelas, jornada e intervalo do modelo (cópia, pode ser alterada pelo chamador). */
export function funcionamentoDoModelo(id: string): FuncionamentoDoModelo {
  const modelo = modeloPorId(id);
  return {
    janelas: modelo.janelas.map((j) => ({ ...j })),
    jornadaMin: modelo.jornadaMin,
    intervaloMin: modelo.intervaloMin,
  };
}
