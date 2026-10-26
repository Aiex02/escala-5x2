import type { ReactNode } from "react";
import { Copy, Moon, Scale } from "lucide-react";
import type { DiaFuncionamento, FaseRegime, InicioSemana, RegimeLegal } from "../api/types";
import { DIAS_SEMANA_LONGO } from "../util/datas";
import { atravessaMeiaNoite, duracaoTurnoMinutos, formatarMinutos } from "../util/formato";
import type { ResumoSemanal } from "../util/modelosFuncionamento";
import { Botao } from "./base/Botao";
import { Campo } from "./base/Campo";
import { CampoData, CampoHora, CampoNumero } from "./base/CampoNumero";
import { Interruptor } from "./base/Marcacao";
import { Selecao } from "./base/Selecao";
import { FasesRegime, HorasSemana } from "./ConfiguracaoBlocos";
import type { AvisoConfiguracao, Campos, CampoAviso, Erros } from "./configuracaoCampos";
import { Alerta } from "./ui";

interface Props {
  campos: Campos;
  erros: Erros;
  avisos: readonly AvisoConfiguracao[];
  /** Horas por semana com os valores dos campos; `null` enquanto algum campo está inválido. */
  resumo: ResumoSemanal | null;
  /** Fases da EC 141 com os valores dos campos (vazio no regime livre). */
  fases: readonly FaseRegime[];
  onMudar: (mudanca: Partial<Campos>) => void;
  onMudarDia: (indice: number, mudanca: Partial<DiaFuncionamento>) => void;
  onMudarJornada: (jornada: string) => void;
  onMudarIntervalo: (intervalo: string) => void;
  onCopiarSegunda: () => void;
}

function Avisos({ avisos, campo }: { avisos: readonly AvisoConfiguracao[]; campo: CampoAviso }) {
  const daqui = avisos.filter((a) => a.campo === campo);
  if (daqui.length === 0) return null;
  return (
    <div className="config-avisos">
      {daqui.map((a) => (
        <Alerta key={a.texto} tipo={a.tipo}>
          {a.texto}
        </Alerta>
      ))}
    </div>
  );
}

/** Um campo e, ao lado dele, os avisos que se referem a ele. */
function Linha({ campo, avisos, children }: { campo: CampoAviso; avisos: readonly AvisoConfiguracao[]; children: ReactNode }) {
  return (
    <div className="config-linha">
      <div className="config-linha-campo">{children}</div>
      <Avisos avisos={avisos} campo={campo} />
    </div>
  );
}

/** Todos os campos editáveis: horário, jornada, regime da EC 141 e regras da empresa, com os avisos ao lado. */
export function ConfiguracaoPersonalizada({ campos, erros, avisos, resumo, fases, onMudar, onMudarDia, onMudarJornada, onMudarIntervalo, onCopiarSegunda }: Props) {
  const segunda = campos.dias[0];
  const podeCopiar = !!segunda?.aberto && campos.dias.some((d) => d.aberto && (d.abre !== segunda.abre || d.fecha !== segunda.fecha));

  return (
    <>
      <div className="painel-corpo painel-corpo-dividido funcionamento">
        <div className="funcionamento-barra">
          <h3 className="painel-subtitulo">Dias e horários</h3>
          <Botao
            tamanho="p"
            icone={Copy}
            disabled={!podeCopiar}
            data-dica={segunda?.aberto ? "Usa o horário de segunda em todos os dias abertos" : "Abra a segunda-feira para copiar o horário dela"}
            onClick={onCopiarSegunda}
          >
            Copiar para todos
          </Botao>
        </div>

        <div className="funcionamento-dias">
          <div className="funcionamento-linha funcionamento-cabecalho" aria-hidden="true">
            <span>Dia</span>
            <span>Aberto</span>
            <span className="funcionamento-horas">
              <span>Abre</span>
              <span>Fecha</span>
            </span>
          </div>
          <ul className="funcionamento-lista" aria-label="Funcionamento por dia da semana">
            {campos.dias.map((d, i) => {
              const nome = DIAS_SEMANA_LONGO[d.dia] ?? `Dia ${d.dia + 1}`;
              const erro = erros.dias[i] ?? {};
              const duracao = duracaoTurnoMinutos(d.abre, d.fecha);
              return (
                <li key={d.dia} className={d.aberto ? "funcionamento-linha" : "funcionamento-linha fechado"}>
                  <span className="funcionamento-nome">{nome}</span>
                  <Interruptor ligado={d.aberto} rotuloAria={`${nome} aberto`} onMudar={(aberto) => onMudarDia(i, { aberto })} />
                  <div className="funcionamento-horas">
                    {d.aberto ? (
                      <>
                        <div className="funcionamento-hora">
                          <CampoHora id={`func-abre-${d.dia}`} valor={d.abre} onMudar={(abre) => onMudarDia(i, { abre })} invalido={!!erro.abre} rotuloAria={`${nome}: abre às`} />
                        </div>
                        <div className="funcionamento-hora">
                          <CampoHora id={`func-fecha-${d.dia}`} valor={d.fecha} onMudar={(fecha) => onMudarDia(i, { fecha })} invalido={!!erro.fecha} rotuloAria={`${nome}: fecha às`} />
                        </div>
                        {!erro.abre && !erro.fecha && duracao !== null && (
                          <span className="funcionamento-duracao texto-suave num-tab">
                            {formatarMinutos(duracao)} abertos
                            {duracao < 1440 && atravessaMeiaNoite(d.abre, d.fecha) && <Moon size={14} strokeWidth={2} aria-label="fecha no dia seguinte" data-dica="Fecha no dia seguinte" />}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="texto-fraco">Fechado</span>
                    )}
                  </div>
                  {(erro.abre || erro.fecha) && (
                    <div className="funcionamento-erros">
                      {erro.abre && (
                        <p id={`func-abre-${d.dia}-erro`} className="campo-erro">
                          Abertura: {erro.abre}
                        </p>
                      )}
                      {erro.fecha && (
                        <p id={`func-fecha-${d.dia}-erro`} className="campo-erro">
                          Fechamento: {erro.fecha}
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        {erros.geral && <p className="campo-erro">{erros.geral}</p>}
      </div>

      <div className="painel-corpo painel-corpo-dividido">
        <h3 className="painel-subtitulo">Jornada dos funcionários</h3>
        <Linha campo="jornada" avisos={avisos}>
          <Campo id="config-jornada" rotulo="Jornada" erro={erros.jornada} dica="Horas trabalhadas por dia, sem contar o intervalo.">
            <CampoNumero id="config-jornada" valor={campos.jornada} onMudar={onMudarJornada} decimais passo={0.5} min={1} max={12} sufixo="horas" invalido={!!erros.jornada} />
          </Campo>
        </Linha>
        <Linha campo="intervalo" avisos={avisos}>
          <Campo id="config-intervalo" rotulo="Intervalo" erro={erros.intervalo} dica="CLT: até 4h sem intervalo; até 6h, 15 min; acima de 6h, 1h a 2h.">
            <CampoNumero id="config-intervalo" valor={campos.intervalo} onMudar={onMudarIntervalo} passo={15} max={120} sufixo="min" invalido={!!erros.intervalo} />
          </Campo>
        </Linha>
      </div>

      <div className="painel-corpo painel-corpo-dividido">
        <h3 className="painel-subtitulo">Fim da escala 6x1 (EC 141/2026)</h3>
        <div className="regime-escolha">
          <span className="regime-icone" aria-hidden="true">
            <Scale size={20} strokeWidth={1.8} />
          </span>
          <Campo id="config-regime" rotulo="Regime legal" className="regime-campo">
            <Selecao<RegimeLegal>
              id="config-regime"
              valor={campos.regime}
              onMudar={(regime) => onMudar({ regime })}
              opcoes={[
                { valor: "ec141", rotulo: "Fim da escala 6x1 (EC 141/2026)" },
                { valor: "livre", rotulo: "Só as regras da empresa" },
              ]}
            />
          </Campo>
          {campos.regime === "ec141" && (
            <Campo id="config-publicacao" rotulo="Publicação da emenda" erro={erros.publicacao} dica="Os prazos contam a partir desta data." className="regime-data">
              <CampoData id="config-publicacao" valor={campos.publicacao} onMudar={(publicacao) => onMudar({ publicacao })} invalido={!!erros.publicacao} />
            </Campo>
          )}
        </div>
        <Avisos avisos={avisos} campo="regime" />
        <FasesRegime fases={fases} />
        {campos.regime === "ec141" && (
          <p className="regime-nota">
            Dois dias de descanso por semana, um deles de preferência no domingo, e até 8h por dia. As regras da empresa abaixo podem ser mais restritivas que a lei, nunca mais
            permissivas.
          </p>
        )}
        {resumo && <HorasSemana resumo={resumo} />}
      </div>

      <div className="painel-corpo painel-corpo-dividido">
        <h3 className="painel-subtitulo">Regras da empresa</h3>
        <Linha campo="carga" avisos={avisos}>
          <Campo id="config-carga" rotulo="Carga semanal máxima" erro={erros.carga} dica="A escala nunca passa deste limite: ninguém faz hora extra.">
            <CampoNumero id="config-carga" valor={campos.carga} onMudar={(carga) => onMudar({ carga })} decimais passo={0.5} max={168} sufixo="horas" invalido={!!erros.carga} />
          </Campo>
        </Linha>
        <Linha campo="jornadaMax" avisos={avisos}>
          <Campo id="config-jornada-max" rotulo="Jornada diária máxima" erro={erros.jornadaMax} dica="Limite de horas trabalhadas em um único dia.">
            <CampoNumero id="config-jornada-max" valor={campos.jornadaMax} onMudar={(jornadaMax) => onMudar({ jornadaMax })} decimais passo={0.5} max={24} sufixo="horas" invalido={!!erros.jornadaMax} />
          </Campo>
        </Linha>
        <Linha campo="folgas" avisos={avisos}>
          <Campo id="config-folgas" rotulo="Folgas mínimas por semana" erro={erros.folgas} dica="Mínimo da empresa; a lei pode exigir mais.">
            <CampoNumero id="config-folgas" valor={campos.folgas} onMudar={(folgas) => onMudar({ folgas })} max={6} sufixo="dias" invalido={!!erros.folgas} />
          </Campo>
        </Linha>
        <Linha campo="descanso" avisos={avisos}>
          <Campo id="config-descanso" rotulo="Descanso entre jornadas" erro={erros.descanso} dica="Do fim de uma jornada ao início da próxima.">
            <CampoNumero id="config-descanso" valor={campos.descanso} onMudar={(descanso) => onMudar({ descanso })} decimais passo={0.5} max={48} sufixo="horas" invalido={!!erros.descanso} />
          </Campo>
        </Linha>
        <Linha campo="diasSeguidos" avisos={avisos}>
          <Campo id="config-dias-seguidos" rotulo="Dias seguidos de trabalho" erro={erros.diasSeguidos} dica="Depois disso, folga obrigatória.">
            <CampoNumero id="config-dias-seguidos" valor={campos.diasSeguidos} onMudar={(diasSeguidos) => onMudar({ diasSeguidos })} min={1} max={31} sufixo="dias" invalido={!!erros.diasSeguidos} />
          </Campo>
        </Linha>
        <Linha campo="domingos" avisos={avisos}>
          <Campo id="config-domingos" rotulo="Domingos seguidos de trabalho" erro={erros.domingos} dica="0 = sem limite. No comércio, use 2 (Lei 10.101: folga em 1 domingo a cada 3 semanas).">
            <CampoNumero id="config-domingos" valor={campos.domingos} onMudar={(domingos) => onMudar({ domingos })} max={52} sufixo="domingos" invalido={!!erros.domingos} />
          </Campo>
        </Linha>
        <div className="config-linha">
          <div className="config-linha-campo">
            <Campo id="config-inicio" rotulo="A semana começa na" dica="Semana usada para somar horas e folgas.">
              <Selecao<InicioSemana>
                id="config-inicio"
                valor={campos.inicio}
                onMudar={(inicio) => onMudar({ inicio })}
                opcoes={[
                  { valor: "segunda", rotulo: "Segunda-feira" },
                  { valor: "domingo", rotulo: "Domingo" },
                ]}
              />
            </Campo>
          </div>
        </div>
      </div>
    </>
  );
}
