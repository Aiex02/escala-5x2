import type { CSSProperties } from "react";
import { TriangleAlert } from "lucide-react";
import type { AgendaMes, Alocacao } from "../../api/types";
import { adicionarDias, dataNoMes, DIAS_SEMANA_CURTO, diaDaSemana, formatarDataExtenso, separarData } from "../../util/datas";
import { formatarMinutos } from "../../util/formato";
import { nomeFuncionario, turnoFuncionaEm, type IndiceAgenda } from "./indice";

interface Props {
  agenda: AgendaMes;
  indice: IndiceAgenda;
  /** Primeiro dia da semana exibida. */
  inicio: string;
  turnosVisiveis: Set<number>;
  filtro: ((a: Alocacao) => boolean) | null;
  hoje: string;
  onAbrirDia: (data: string) => void;
}

/** Semana em quadro: uma linha por turno, uma coluna por dia, com nome e horário de cada pessoa. */
export function GradeSemanal({ agenda, indice, inicio, turnosVisiveis, filtro, hoje, onAbrirDia }: Props) {
  const dias = Array.from({ length: 7 }, (_, i) => adicionarDias(inicio, i));
  const turnos = indice.turnosOrdenados.filter((t) => turnosVisiveis.has(t.id));

  return (
    <div className={filtro ? "grade-semana buscando" : "grade-semana"} role="table" aria-label="Escala da semana">
      <div className="semana-linha semana-cab" role="row">
        <div className="semana-canto" role="columnheader">
          Turno
        </div>
        {dias.map((data) => {
          const noMes = dataNoMes(data, agenda.ano, agenda.mes);
          const total = noMes ? [...(indice.porDia.get(data)?.values() ?? [])].reduce((s, l) => s + l.length, 0) : 0;
          const classes = ["semana-dia", !noMes && "fora", data === hoje && "hoje"].filter(Boolean).join(" ");
          return (
            <div key={data} role="columnheader" className={classes}>
              <button type="button" className="semana-dia-botao" disabled={!noMes} aria-label={`Abrir ${formatarDataExtenso(data)}`} onClick={() => onAbrirDia(data)}>
                <span className="semana-dia-nome">{DIAS_SEMANA_CURTO[diaDaSemana(data)]}</span>
                <span className="semana-dia-numero">{separarData(data).dia}</span>
              </button>
              <span className="semana-dia-total">{noMes ? `${total} ${total === 1 ? "pessoa" : "pessoas"}` : "Outro mês"}</span>
            </div>
          );
        })}
      </div>

      {turnos.map((turno) => (
        <div key={turno.id} className="semana-linha" role="row" style={{ "--cor-turno": turno.cor } as CSSProperties}>
          <div className="semana-turno" role="rowheader">
            <span className="semana-turno-nome">{turno.nome}</span>
            <span className="semana-turno-horario">
              {turno.inicio}–{turno.fim}
            </span>
            {turno.efetivoMinimo > 0 && <span className="semana-turno-minimo">mín. {turno.efetivoMinimo}/dia</span>}
          </div>
          {dias.map((data) => {
            if (!dataNoMes(data, agenda.ano, agenda.mes)) {
              return <div key={data} role="cell" className="semana-celula fora" aria-label="Fora do mês" />;
            }
            if (!turnoFuncionaEm(turno, data)) {
              return (
                <div key={data} role="cell" className="semana-celula fechado">
                  <span>Não funciona</span>
                </div>
              );
            }
            const lista = indice.porDia.get(data)?.get(turno.id) ?? [];
            const abaixo = turno.efetivoMinimo > 0 && lista.length < turno.efetivoMinimo;
            return (
              <div key={data} role="cell" className={abaixo ? "semana-celula abaixo" : "semana-celula"}>
                {abaixo && (
                  <span className="semana-alerta" data-dica={`${lista.length} de ${turno.efetivoMinimo} pessoas mínimas`}>
                    <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />
                    {lista.length}/{turno.efetivoMinimo}
                  </span>
                )}
                {lista.length === 0 && !abaixo && <span className="semana-vazio">Ninguém</span>}
                <ul className="semana-pessoas">
                  {lista.map((a) => {
                    const proprio = a.inicio !== turno.inicio || a.fim !== turno.fim;
                    const achado = filtro?.(a) ?? false;
                    return (
                      <li key={a.id} className={achado ? "pessoa achado" : "pessoa"}>
                        <span className="pessoa-nome">{nomeFuncionario(indice, a.funcionarioId)}</span>
                        {proprio && (
                          <span className="pessoa-horario" data-dica={`Horário próprio: ${formatarMinutos(a.minutosTrabalhados)} trabalhadas`}>
                            {a.inicio}–{a.fim}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
