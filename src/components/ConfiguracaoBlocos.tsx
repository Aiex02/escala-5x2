// Blocos de leitura compartilhados pelos dois modos da configuração (modelo e personalizado):
// fases da EC 141, horas por semana e prévia dos turnos.

import type { CSSProperties } from "react";
import type { FaseRegime, Turno } from "../api/types";
import { hojeISO } from "../util/datas";
import { formatarMinutos, pluralizar } from "../util/formato";
import type { PreviaTurno } from "../util/funcionamento";
import type { ResumoSemanal } from "../util/modelosFuncionamento";
import { faseEmVigor, periodoDaFase } from "../util/regime";
import { DiasCompactos, PALETA_TURNOS, resumoDias } from "./base/Escolhas";
import { Selo } from "./ui";

/** Linha do tempo das fases da transição (regra anterior, 42h e 40h), com a que vale hoje em destaque. */
export function FasesRegime({ fases }: { fases: readonly FaseRegime[] }) {
  if (fases.length === 0) return null;
  const atual = faseEmVigor(fases, hojeISO());
  return (
    <ol className="fases" aria-label="Fases da transição" style={{ "--colunas": fases.length } as CSSProperties}>
      {fases.map((f, i) => {
        const vigente = i === atual;
        return (
          <li key={`${f.desde}-${f.ate}`} className={vigente ? "fase atual" : "fase"} aria-current={vigente ? "step" : undefined}>
            <span className="fase-periodo">{periodoDaFase(f)}</span>
            <span className="fase-texto">{f.descricao}</span>
            {vigente && <span className="fase-marca">Em vigor hoje</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Horas por semana de quem trabalha em tempo integral: hoje e na regra final. */
export function HorasSemana({ resumo }: { resumo: ResumoSemanal }) {
  return (
    <div className="horas-semana">
      <span className="campo-rotulo">Horas por semana de quem trabalha em tempo integral</span>
      <ul className="horas-semana-lista">
        {resumo.fases.map((f) => (
          <li key={f.rotulo}>
            <span className="texto-suave">{f.rotulo}</span>
            <span className="num-tab">{f.texto}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Turnos que a configuração gera, com a cor dos turnos atuais de mesmo horário. */
export function PreviaTurnosLista({ previa, turnos }: { previa: readonly PreviaTurno[]; turnos: readonly Turno[] }) {
  return (
    <>
      <ul className="previa-turnos">
        {previa.map((t, i) => {
          const cor = turnos.find((x) => x.inicio === t.inicio && x.fim === t.fim)?.cor ?? PALETA_TURNOS[i % PALETA_TURNOS.length] ?? "#64748B";
          return (
            <li key={`${t.inicio}-${t.fim}`} style={{ "--cor-turno": cor } as CSSProperties}>
              <span className="turno-nome-linha">
                <span className="barra-cor" aria-hidden="true" />
                {t.nome}
              </span>
              <span className="num-tab">
                {t.inicio}–{t.fim}
              </span>
              <span className="texto-suave">
                {formatarMinutos(t.trabalhadasMin)} trabalhadas
                {t.intervalo > 0 && ` (${t.intervalo} min de intervalo)`}
              </span>
              <span className="dias-com-texto">
                <DiasCompactos dias={t.dias} rotulo={`${t.nome} funciona`} />
                <span className="texto-suave">{resumoDias(t.dias)}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="campo-dica">Turnos com o mesmo horário são mantidos; os que deixam de existir só continuam aparecendo nas escalas já geradas.</p>
    </>
  );
}

/** Cabeçalho da prévia: título e quantidade de turnos. */
export function CabecalhoPrevia({ titulo, total }: { titulo: string; total: number | null }) {
  return (
    <div className="previa-cab">
      <h3 className="painel-subtitulo">{titulo}</h3>
      {total !== null && <Selo>{pluralizar(total, "turno", "turnos")}</Selo>}
    </div>
  );
}
