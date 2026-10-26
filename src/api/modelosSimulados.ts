// Modelos de funcionamento do backend simulado (`mock.ts`), usado fora do Tauri.
//
// Espelha `crates/escala-app/src/modelos.rs`: mesmos ids, horários, jornada e intervalo, e
// as mesmas regras da empresa (44h, 8h por dia, 11h entre jornadas, 6 dias seguidos, 1 folga
// mínima, semana de segunda), no regime da EC 141 com a publicação padrão. Só muda, por
// modelo, o limite de domingos seguidos. A interface não usa esta lista: ela vem de
// `api.listarModelos()`. Ao alterar um lado, altere o outro.

import { comFases, PUBLICACAO_EC141_PADRAO } from "../util/regime";
import type { DiaFuncionamento, ModeloFuncionamento, Regras } from "./types";

type Horario = readonly [abre: string, fecha: string];

const TODOS = [0, 1, 2, 3, 4, 5, 6];
const SEG_SAB = [0, 1, 2, 3, 4, 5];
const SEG_SEX = [0, 1, 2, 3, 4];
const TER_DOM = [1, 2, 3, 4, 5, 6];

/**
 * Monta os 7 dias: os `abertos` seguem o horário `padrao` e `especiais` troca o de
 * dias isolados. Dia fechado guarda o horário padrão, que reaparece se ele for aberto.
 */
function semana(abertos: readonly number[], padrao: Horario, especiais: Readonly<Record<number, Horario>> = {}): DiaFuncionamento[] {
  return Array.from({ length: 7 }, (_, dia) => {
    const [abre, fecha] = especiais[dia] ?? padrao;
    return { dia, aberto: abertos.includes(dia), abre, fecha };
  });
}

function regrasDoModelo(domingosSeguidosMax: number, jornadaPadraoHoras: number, intervaloPadraoMin: number): Regras {
  return comFases({
    cargaSemanalMaxHoras: 44,
    jornadaDiariaMaxHoras: 8,
    descansoEntreJornadasHoras: 11,
    maxDiasConsecutivos: 6,
    inicioSemana: "segunda",
    folgasSemanaisMin: 1,
    domingosSeguidosMax,
    regime: "ec141",
    ec141Publicacao: PUBLICACAO_EC141_PADRAO,
    fases: [],
    jornadaPadraoHoras,
    intervaloPadraoMin,
  });
}

function modelo(id: string, nome: string, descricao: string, dias: DiaFuncionamento[], jornadaHoras: number, intervaloMin: number, domingosSeguidosMax: number): ModeloFuncionamento {
  return { id, nome, descricao, dias, jornadaHoras, intervaloMin, regras: regrasDoModelo(domingosSeguidosMax, jornadaHoras, intervaloMin) };
}

/** Modelo de cliente novo (o mesmo `MODELO_PADRAO` do backend). */
export const MODELO_SIMULADO_PADRAO = "shopping";

export const MODELOS_SIMULADOS: readonly ModeloFuncionamento[] = [
  modelo("shopping", "Shopping", "Lojas de shopping e galerias, abertas todos os dias.", semana(TODOS, ["10:00", "22:00"]), 6, 15, 2),
  modelo(
    "shopping-domingo-reduzido",
    "Shopping com domingo reduzido",
    "Shopping que abre só à tarde aos domingos.",
    // Domingo até 20:15: o turno de 6h + 15 min só cabe inteiro em 6h15.
    semana(TODOS, ["10:00", "22:00"], { 6: ["14:00", "20:15"] }),
    6,
    15,
    2,
  ),
  modelo("comercio", "Comércio / varejo", "Loja de rua, de segunda a sábado.", semana(SEG_SAB, ["09:00", "19:00"]), 8, 60, 0),
  modelo("supermercado", "Supermercado", "Supermercado e atacado, em horário estendido todos os dias.", semana(TODOS, ["07:00", "22:00"]), 8, 60, 2),
  modelo("administrativo", "Administrativo (CLT)", "Escritório em horário comercial, com 1h de almoço.", semana(SEG_SEX, ["08:00", "17:00"]), 8, 60, 0),
  modelo("restaurante", "Restaurante", "Restaurante com almoço e jantar; fecha às segundas.", semana(TER_DOM, ["11:00", "23:00"]), 8, 60, 2),
  // Escala de revezamento: folga em ao menos um domingo a cada 7 semanas.
  modelo("24-horas", "24 horas", "Farmácia, posto ou hospital: abre sem parar, em três turnos de 8h.", semana(TODOS, ["06:00", "06:00"]), 8, 60, 6),
];
