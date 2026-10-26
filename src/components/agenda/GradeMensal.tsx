import { useMemo, type CSSProperties } from "react";
import { TriangleAlert } from "lucide-react";
import type { AgendaMes, Alocacao, Turno } from "../../api/types";
import { celulasCalendario, dataNoMes, DIAS_SEMANA_CURTO, formatarDataExtenso, ordemDiasSemana, separarData, tituloMes } from "../../util/datas";
import { nomeFuncionario, turnoFuncionaEm, type IndiceAgenda } from "./indice";

interface Props {
  agenda: AgendaMes;
  indice: IndiceAgenda;
  turnosVisiveis: Set<number>;
  filtro: ((a: Alocacao) => boolean) | null;
  compacto: boolean;
  hoje: string;
  onAbrirDia: (data: string) => void;
}

/** Calendário do mês: em cada dia, os plantões agrupados por turno. */
export function GradeMensal({ agenda, indice, turnosVisiveis, filtro, compacto, hoje, onAbrirDia }: Props) {
  const celulas = useMemo(() => celulasCalendario(agenda.ano, agenda.mes, agenda.inicioSemana), [agenda.ano, agenda.mes, agenda.inicioSemana]);
  const cabecalho = ordemDiasSemana(agenda.inicioSemana).map((i) => DIAS_SEMANA_CURTO[i] ?? "");
  const turnos = indice.turnosOrdenados.filter((t) => turnosVisiveis.has(t.id));
  const classes = ["grade-mes", compacto && "compacta", filtro && "buscando"].filter(Boolean).join(" ");

  return (
    <div className={classes} role="grid" aria-label={`Calendário de ${tituloMes(agenda.ano, agenda.mes)}`}>
      <div className="grade-mes-cab" role="row">
        {cabecalho.map((nome) => (
          <div key={nome} role="columnheader" className="grade-mes-dia-semana">
            {nome}
          </div>
        ))}
      </div>
      <div className="grade-mes-corpo">
        {celulas.map((data) => {
          const { dia } = separarData(data);
          if (!dataNoMes(data, agenda.ano, agenda.mes)) {
            return (
              <div key={data} className="dia dia-fora" aria-hidden="true">
                <span className="dia-numero">{dia}</span>
              </div>
            );
          }
          const doDia = indice.porDia.get(data);
          const ehHoje = data === hoje;
          return (
            <div key={data} role="gridcell" className={ehHoje ? "dia dia-hoje" : "dia"} onClick={() => onAbrirDia(data)}>
              <div className="dia-topo">
                <button type="button" className="dia-numero" aria-label={`Abrir ${formatarDataExtenso(data)}`} onClick={(e) => (e.stopPropagation(), onAbrirDia(data))}>
                  {dia}
                </button>
                {ehHoje && <span className="marca-hoje">Hoje</span>}
              </div>
              <div className="dia-turnos">
                {turnos
                  .filter((t) => turnoFuncionaEm(t, data))
                  .map((turno) => (
                    <GrupoTurno key={turno.id} turno={turno} alocacoes={doDia?.get(turno.id) ?? []} indice={indice} filtro={filtro} compacto={compacto} />
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface GrupoProps {
  turno: Turno;
  alocacoes: Alocacao[];
  indice: IndiceAgenda;
  filtro: ((a: Alocacao) => boolean) | null;
  compacto: boolean;
}

function GrupoTurno({ turno, alocacoes, indice, filtro, compacto }: GrupoProps) {
  const abaixo = turno.efetivoMinimo > 0 && alocacoes.length < turno.efetivoMinimo;
  // No modo compacto, só aparecem os nomes encontrados pela busca.
  const visiveis = compacto ? (filtro ? alocacoes.filter(filtro) : []) : alocacoes;
  const dica = abaixo
    ? `${turno.nome}: ${alocacoes.length} de ${turno.efetivoMinimo} pessoas (abaixo do mínimo)`
    : `${turno.nome}: ${alocacoes.length} ${alocacoes.length === 1 ? "pessoa" : "pessoas"}`;

  return (
    <div className={abaixo ? "turno-bloco abaixo" : "turno-bloco"} style={{ "--cor-turno": turno.cor } as CSSProperties}>
      <div className="turno-faixa" data-dica={dica}>
        <span className="turno-faixa-nome">{turno.nome}</span>
        <span className="turno-faixa-total">
          {abaixo && <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />}
          {alocacoes.length}
        </span>
      </div>
      {visiveis.length > 0 && (
        <ul className="turno-nomes">
          {visiveis.map((a) => {
            const nome = nomeFuncionario(indice, a.funcionarioId);
            const achado = filtro?.(a) ?? false;
            return (
              <li key={a.id} className={achado ? "achado" : undefined} data-dica={`${nome}, ${a.inicio}–${a.fim}`}>
                {nome}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
