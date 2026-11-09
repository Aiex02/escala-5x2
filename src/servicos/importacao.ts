// Importação de funcionários e ausências a partir de planilha xlsx.
//
// A matrícula identifica o funcionário dentro do cliente. Cria os novos; atualiza nome e cargo;
// preferência, carga, CTPS e seção só mudam quando a planilha traz valor; nunca apaga quem falta.
// As ausências de uma matrícula presente na aba de ausências substituem as dela.

import { prisma } from "@/lib/db";
import { deISO } from "@/lib/datas";
import { lerPlanilhaFuncionarios, type FuncionarioLido } from "@/excel";
import type { ResultadoImportacaoDto } from "./dto";

function ctpsCompleta(f: FuncionarioLido): string | undefined {
  if (!f.ctps) return undefined;
  return f.ctpsSerie ? `${f.ctps} série ${f.ctpsSerie}` : f.ctps;
}

/** Valida (`simular`) ou grava a planilha. Lança `ErroPlanilha` quando o arquivo inteiro é inválido. */
export async function importarPlanilha(
  clienteId: string,
  bytes: Uint8Array,
  simular: boolean,
): Promise<ResultadoImportacaoDto> {
  const leitura = await lerPlanilhaFuncionarios(bytes);
  const avisos = [...leitura.avisos];

  const existentes = await prisma.funcionario.findMany({
    where: { clienteId },
    select: { id: true, matricula: true },
  });
  const idPorMatricula = new Map(existentes.map((f) => [f.matricula, f.id]));
  const novas = leitura.funcionarios.filter((f) => !idPorMatricula.has(f.matricula));
  const atualizadas = leitura.funcionarios.filter((f) => idPorMatricula.has(f.matricula));

  // Ausências cuja matrícula não existe (nem na planilha, nem no cliente) são ignoradas com aviso.
  const matriculasConhecidas = new Set([...idPorMatricula.keys(), ...leitura.funcionarios.map((f) => f.matricula)]);
  const ausencias = leitura.ausencias.filter((a) => {
    if (matriculasConhecidas.has(a.matricula)) return true;
    avisos.push(`Ausências (linha ${a.linha}): matrícula ${a.matricula} não encontrada; ausência ignorada.`);
    return false;
  });

  if (!simular && (leitura.funcionarios.length > 0 || ausencias.length > 0)) {
    await prisma.$transaction(
      async (tx) => {
        for (const f of leitura.funcionarios) {
          const ctps = ctpsCompleta(f);
          const id = idPorMatricula.get(f.matricula);
          if (id) {
            await tx.funcionario.update({
              where: { id },
              data: {
                nome: f.nome,
                cargo: f.cargo ?? null,
                ...(f.secao !== undefined && { secao: f.secao }),
                ...(ctps !== undefined && { ctps }),
                ...(f.preferencia !== undefined && { preferencia: f.preferencia }),
                ...(f.cargaSemanalMin !== undefined && { cargaSemanalMin: f.cargaSemanalMin }),
              },
            });
          } else {
            const criado = await tx.funcionario.create({
              data: {
                clienteId,
                matricula: f.matricula,
                nome: f.nome,
                cargo: f.cargo ?? null,
                secao: f.secao ?? null,
                ctps: ctps ?? null,
                preferencia: f.preferencia ?? null,
                cargaSemanalMin: f.cargaSemanalMin ?? null,
              },
              select: { id: true },
            });
            idPorMatricula.set(f.matricula, criado.id);
          }
        }

        const matriculasComAusencia = [...new Set(ausencias.map((a) => a.matricula))];
        const ids = matriculasComAusencia.map((m) => idPorMatricula.get(m)).filter((id): id is string => id !== undefined);
        if (ids.length > 0) {
          await tx.ausencia.deleteMany({ where: { funcionarioId: { in: ids } } });
          await tx.ausencia.createMany({
            data: ausencias.flatMap((a) => {
              const funcionarioId = idPorMatricula.get(a.matricula);
              if (!funcionarioId) return [];
              return [
                {
                  funcionarioId,
                  inicio: deISO(a.inicio),
                  fim: deISO(a.fim),
                  motivo: a.motivo ?? null,
                  justificada: a.justificada,
                },
              ];
            }),
          });
        }
      },
      { timeout: 60_000 },
    );
  }

  return {
    formato: leitura.formato,
    simulado: simular,
    lidas: leitura.funcionarios.length,
    novas: novas.length,
    atualizadas: atualizadas.length,
    ausenciasGravadas: ausencias.length,
    rejeitadas: leitura.rejeitadas.map((r) => ({
      aba: r.aba,
      linha: r.linha,
      matricula: r.matricula ?? null,
      erros: r.erros,
    })),
    avisos,
  };
}
