import type { AgendaMes, HorasSemanaFuncionario } from "../../api/types";
import { formatarDiaMes, montarData, nomeMes, separarData, ultimoDiaDoMes } from "../../util/datas";
import { compararTexto, formatarMinutos } from "../../util/formato";

interface Props {
  agenda: AgendaMes;
  /** Início da semana em destaque (visão semanal). */
  destaque?: string;
}

type Situacao = "ok" | "falta" | "excesso" | "andamento";

function situacao(h: HorasSemanaFuncionario, pendente: boolean): Situacao {
  if (h.minutos > h.limiteMin || (!pendente && h.minutos > h.previstoMin)) return "excesso";
  if (pendente) return "andamento";
  if (h.minutos < h.previstoMin) return "falta";
  return "ok";
}

/** "+2h", "−1h30", "0h" */
export function saldoTexto(minutos: number): string {
  if (minutos === 0) return "0h";
  return `${minutos > 0 ? "+" : "−"}${formatarMinutos(Math.abs(minutos))}`;
}

/** Classe de cor de um saldo: 0h verde, devendo âmbar, horas a mais vermelho. */
export function classeSaldo(minutos: number): string {
  return minutos === 0 ? "saldo-zero" : minutos < 0 ? "saldo-negativo" : "saldo-positivo";
}

/**
 * Horas de cada pessoa por semana de apuração, comparadas às horas previstas
 * (limite em jornadas inteiras, descontando folgas obrigatórias e ausências justificadas).
 * O saldo do mês soma as semanas já fechadas: 0h = nem hora a menos, nem a mais. O saldo
 * anterior vem dos meses já gerados e o acumulado soma os dois.
 */
export function ResumoSemanal({ agenda, destaque }: Props) {
  if (agenda.semanas.length === 0) return null;
  const primeiroDia = montarData(agenda.ano, agenda.mes, 1);
  const ultimoDia = ultimoDiaDoMes(agenda.ano, agenda.mes);

  const horas = agenda.semanas.map((s) => new Map(s.funcionarios.map((h) => [h.funcionarioId, h])));
  const linhas = agenda.funcionarios.filter((f) => horas.some((m) => m.has(f.id))).sort((a, b) => compararTexto(a.nome, b.nome));
  const temPendente = agenda.semanas.some((s) => s.pendente);

  function rotuloPendente(inicio: string, fim: string): string {
    const outro = inicio < primeiroDia ? inicio : fim;
    return `Semana continua em ${nomeMes(separarData(outro).mes).toLowerCase()}, que ainda não tem escala`;
  }

  return (
    <section className="painel" aria-labelledby="titulo-resumo">
      <header className="painel-cab">
        <div>
          <h2 id="titulo-resumo">Horas por semana</h2>
          <p className="painel-sub">
            Horas escaladas sobre as horas previstas de cada pessoa. O saldo soma as semanas fechadas do mês: 0h significa nenhuma hora a menos ou a mais. O anterior vem dos
            meses já gerados (+ horas a mais, − devendo) e o acumulado soma os dois.
            {temPendente && " Semanas em cinza continuam num mês ainda sem escala e se completam quando ele for gerado."}
          </p>
          <p className="painel-sub">
            A geração do mês compensa o saldo anterior quando as regras permitem: uma folga extra para quem tem horas a mais; turnos mais longos, até a jornada máxima do dia,
            para quem está devendo.
          </p>
        </div>
      </header>
      <div className="tabela-rolagem">
        <table className="tabela tabela-horas">
          <thead>
            <tr>
              <th scope="col" className="coluna-fixa">
                Funcionário
              </th>
              <th scope="col" className="num coluna-saldo" data-dica="Saldo dos meses anteriores (semanas fechadas antes deste mês): horas a mais (+) ou devendo (−)">
                Anterior
              </th>
              {agenda.semanas.map((s) => {
                const parcial = s.inicio < primeiroDia || s.fim > ultimoDia;
                return (
                  <th
                    key={s.inicio}
                    scope="col"
                    className={[s.inicio === destaque && "destaque", "num", s.pendente && "pendente"].filter(Boolean).join(" ")}
                    data-dica={s.pendente ? rotuloPendente(s.inicio, s.fim) : parcial ? "Semana completa, somando o mês vizinho" : undefined}
                  >
                    {formatarDiaMes(s.inicio)}–{formatarDiaMes(s.fim)}
                  </th>
                );
              })}
              <th scope="col" className="num coluna-saldo" data-dica="Soma das semanas fechadas do mês">
                Saldo
              </th>
              <th scope="col" className="num coluna-saldo coluna-acumulado" data-dica="Saldo anterior mais o saldo do mês">
                Acumulado
              </th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((f) => {
              let saldo = 0;
              const celulas = horas.map((porFunc, i) => {
                const semana = agenda.semanas[i];
                const h = porFunc.get(f.id);
                const classeDestaque = semana?.inicio === destaque ? " destaque" : "";
                if (!h || !semana) {
                  return (
                    <td key={i} className={`num texto-fraco${classeDestaque}`}>
                      —
                    </td>
                  );
                }
                const s = situacao(h, semana.pendente);
                if (!semana.pendente) saldo += h.minutos - h.previstoMin;
                const pct = h.previstoMin > 0 ? Math.min(100, Math.round((h.minutos / h.previstoMin) * 100)) : h.minutos > 0 ? 100 : 0;
                const dica =
                  s === "andamento"
                    ? `${formatarMinutos(h.minutos)} até agora; a semana continua no mês vizinho`
                    : s === "ok"
                      ? "Horas previstas cumpridas"
                      : s === "falta"
                        ? `Faltam ${formatarMinutos(h.previstoMin - h.minutos)}`
                        : `Passou ${formatarMinutos(h.minutos - Math.min(h.previstoMin, h.limiteMin))}`;
                return (
                  <td key={i} className={`num horas horas-${s}${classeDestaque}`} data-dica={dica}>
                    <span className="horas-texto">
                      {formatarMinutos(h.minutos)}
                      <span className="horas-limite"> / {formatarMinutos(h.previstoMin)}</span>
                    </span>
                    <span className="horas-barra" aria-hidden="true">
                      <span style={{ width: `${pct}%` }} />
                    </span>
                  </td>
                );
              });
              return (
                <tr key={f.id}>
                  <th scope="row" className="coluna-fixa">
                    <span className="nome-linha">{f.nome}</span>
                    <span className="matricula-linha">{f.matricula}</span>
                  </th>
                  <td className={`num saldo ${classeSaldo(f.saldoAnteriorMin)}`}>{saldoTexto(f.saldoAnteriorMin)}</td>
                  {celulas}
                  <td className={`num saldo ${classeSaldo(saldo)}`}>{saldoTexto(saldo)}</td>
                  <td className={`num saldo acumulado ${classeSaldo(f.saldoAnteriorMin + saldo)}`}>{saldoTexto(f.saldoAnteriorMin + saldo)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
