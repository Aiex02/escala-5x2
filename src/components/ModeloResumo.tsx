import { Moon } from "lucide-react";
import type { ModeloFuncionamento, Regras } from "../api/types";
import { DIAS_SEMANA_LONGO, formatarData } from "../util/datas";
import { atravessaMeiaNoite, duracaoTurnoMinutos, formatarHoras, formatarMinutos } from "../util/formato";
import { resumoRegras, resumoSemanal } from "../util/modelosFuncionamento";
import { FasesRegime, HorasSemana } from "./ConfiguracaoBlocos";
import { Alerta } from "./ui";

interface Props {
  modelo: ModeloFuncionamento;
  /** Regras do modelo (as salvas, se ele já está em uso; senão as que passam a valer ao aplicá-lo). */
  regras: Regras;
}

/** Tudo o que o modelo define, só para leitura: horário, jornada, EC 141, regras da empresa e horas por semana. */
export function ModeloResumo({ modelo, regras }: Props) {
  const resumo = resumoSemanal({ dias: modelo.dias, jornadaHoras: modelo.jornadaHoras }, regras);
  const domingoAberto = modelo.dias.some((d) => d.dia === 6 && d.aberto);

  return (
    <>
      <div className="painel-corpo painel-corpo-dividido">
        <h3 className="painel-subtitulo">Dias e horários</h3>
        <div className="funcionamento-dias">
          <ul className="funcionamento-lista funcionamento-leitura" aria-label="Funcionamento por dia da semana">
            {modelo.dias.map((d) => {
              const nome = DIAS_SEMANA_LONGO[d.dia] ?? `Dia ${d.dia + 1}`;
              const duracao = duracaoTurnoMinutos(d.abre, d.fecha);
              const vinteQuatro = d.abre === d.fecha;
              return (
                <li key={d.dia} className={d.aberto ? "funcionamento-linha" : "funcionamento-linha fechado"}>
                  <span className="funcionamento-nome">{nome}</span>
                  <div className="funcionamento-horas">
                    {d.aberto ? (
                      <>
                        <span className="num-tab">{vinteQuatro ? `24 horas, a partir das ${d.abre}` : `${d.abre} às ${d.fecha}`}</span>
                        {!vinteQuatro && duracao !== null && (
                          <span className="funcionamento-duracao texto-suave num-tab">
                            {formatarMinutos(duracao)} abertos
                            {atravessaMeiaNoite(d.abre, d.fecha) && <Moon size={14} strokeWidth={2} aria-label="fecha no dia seguinte" data-dica="Fecha no dia seguinte" />}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="texto-fraco">Fechado</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="painel-corpo painel-corpo-dividido">
        <h3 className="painel-subtitulo">Jornada dos funcionários</h3>
        <dl className="config-valores">
          <div>
            <dt>Jornada</dt>
            <dd className="num-tab">{formatarHoras(modelo.jornadaHoras)} por dia</dd>
          </div>
          <div>
            <dt>Intervalo</dt>
            <dd className="num-tab">{modelo.intervaloMin > 0 ? `${modelo.intervaloMin} min por jornada` : "Sem intervalo"}</dd>
          </div>
        </dl>
      </div>

      <div className="painel-corpo painel-corpo-dividido">
        <h3 className="painel-subtitulo">Fim da escala 6x1 (EC 141/2026)</h3>
        {regras.fases.length > 0 ? (
          <>
            <FasesRegime fases={regras.fases} />
            <p className="regime-nota">
              Dois dias de descanso por semana, um deles de preferência no domingo, e até 8h por dia. Os prazos contam da publicação da emenda
              {regras.ec141Publicacao ? `, em ${formatarData(regras.ec141Publicacao)}` : ""}. As regras da empresa abaixo valem junto com a lei: vence a mais restritiva.
            </p>
          </>
        ) : (
          <p className="texto-suave">Este modelo não segue a EC 141: valem só as regras da empresa abaixo.</p>
        )}
        <HorasSemana resumo={resumo} />
        {resumo.avisos.map((aviso) => (
          <Alerta key={aviso} tipo="atencao">
            {aviso}
          </Alerta>
        ))}
      </div>

      <div className="painel-corpo painel-corpo-dividido">
        <h3 className="painel-subtitulo">Regras da empresa</h3>
        <ul className="config-regras">
          {resumoRegras(regras, domingoAberto).map((texto) => (
            <li key={texto}>{texto}</li>
          ))}
        </ul>
        <p className="campo-dica">Para mudar horários, jornada ou regras, use Personalizar: a escala continua nunca passando do limite semanal, e os avisos mostram onde a configuração foge da lei.</p>
      </div>
    </>
  );
}
