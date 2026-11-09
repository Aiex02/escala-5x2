// Exportação da escala do mês para Excel.

import { exportarEscala, type CelulaExportavel, type EscalaExportavel } from "@/excel";
import type { AgendaMesDto, CelulaDto } from "./agendaDto";
import { obterAgenda } from "./agenda";
import { ErroAgenda } from "./planejamento";

function celulaParaExportacao(c: CelulaDto): CelulaExportavel {
  switch (c.tipo) {
    case "turno":
      return { tipo: "turno", turnoId: c.turnoId, inicioMin: c.inicioMin, fimMin: c.fimMin, intervaloMin: c.intervaloMin, compensada: c.compensada, ...(c.origem === "horaExtra" ? { horaExtra: true } : {}) };
    case "folga":
      return { tipo: "folga" };
    case "falta":
      return { tipo: "falta" };
    case "justificada":
      return c.motivo ? { tipo: "justificada", motivo: c.motivo } : { tipo: "justificada" };
    case "fechado":
      return { tipo: "vazio" };
  }
}

/** Monta o DTO de exportação a partir da agenda. */
export function agendaParaExportavel(agenda: AgendaMesDto): EscalaExportavel {
  const linhas = agenda.grupos.flatMap((g) => g.linhas);
  const semanas = agenda.semanas.map((s) => ({ inicio: s.inicio, fim: s.fim }));
  return {
    cliente: agenda.clienteNome,
    ano: agenda.ano,
    mes: agenda.mes,
    dias: agenda.dias.map((d) => ({ data: d.data, diaSemana: d.diaSemana })),
    turnos: agenda.turnos.map((t) => ({
      id: t.id,
      nome: t.nome,
      sigla: t.sigla,
      cor: t.cor,
      inicioMin: t.inicioMin,
      fimMin: t.fimMin,
      intervaloMin: t.intervaloMin,
    })),
    linhas: linhas.map((l) => ({
      funcionario: l.nome,
      ...(l.cargo ? { cargo: l.cargo } : {}),
      dias: l.celulas.map(celulaParaExportacao),
      horasMesMin: l.horasMesMin,
      saldoMin: l.saldoMesMin,
      acumuladoMin: l.acumuladoMin,
    })),
    semanas,
    horasSemana: linhas.map((l) => ({
      funcionario: l.nome,
      semanas: agenda.semanas.map((s) => {
        const h = s.porFuncionario[l.funcionarioId];
        return { feitoMin: h?.feitoMin ?? 0, previstoMin: h?.previstoMin ?? 0 };
      }),
    })),
  };
}

export type ArquivoExportado = { nome: string; conteudo: Uint8Array };

/** Gera o .xlsx da escala do mês. */
export async function exportarMes(clienteId: string, ano: number, mes: number): Promise<ArquivoExportado> {
  const agenda = await obterAgenda(clienteId, ano, mes);
  if (!agenda.gerado) throw new ErroAgenda("Gere a escala deste mês antes de exportar.");
  const conteudo = await exportarEscala(agendaParaExportavel(agenda));
  const nomeCliente = agenda.clienteNome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return { nome: `escala-${nomeCliente || "cliente"}-${ano}-${String(mes).padStart(2, "0")}.xlsx`, conteudo };
}
