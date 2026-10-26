import { useMemo, useState, type CSSProperties, type FormEvent } from "react";
import { Moon, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { api, mensagemErro } from "../api/client";
import type { Turno, TurnoEntrada } from "../api/types";
import { atravessaMeiaNoite, corHexValida, duracaoTurnoMinutos, formatarHoras, formatarMinutos, horaParaMinutos, normalizarTexto } from "../util/formato";
import { Botao, BotaoIcone } from "./base/Botao";
import { Campo, Entrada } from "./base/Campo";
import { CampoHora, CampoNumero, lerNumero } from "./base/CampoNumero";
import { DiasCompactos, PALETA_TURNOS, resumoDias, SeletorCor, SeletorDias } from "./base/Escolhas";
import { ChipPeriodo } from "./ChipPeriodo";
import { ConfirmModal, Modal } from "./Modal";
import { useNotificar } from "./Toast";
import { Alerta } from "./ui";

interface Props {
  clienteId: number;
  /** Turnos em uso; o estado fica em quem renderiza, pois salvar o funcionamento também os troca. */
  turnos: Turno[];
  onMudar: (atualizar: (lista: Turno[]) => Turno[]) => void;
  jornadaMaxHoras: number;
}

/** Lista de turnos do cliente; criar e editar acontecem num diálogo. */
export function Turnos({ clienteId, turnos: turnosRecebidos, onMudar, jornadaMaxHoras }: Props) {
  const notificar = useNotificar();
  const turnos = useMemo(() => [...turnosRecebidos].sort((a, b) => a.ordem - b.ordem), [turnosRecebidos]);
  const [editando, setEditando] = useState<Turno | "novo" | null>(null);
  const [excluindo, setExcluindo] = useState<Turno | null>(null);

  function aoSalvar(salvo: Turno) {
    onMudar((lista) => {
      const existe = lista.some((t) => t.id === salvo.id);
      const nova = existe ? lista.map((t) => (t.id === salvo.id ? salvo : t)) : [...lista, salvo];
      return nova.sort((a, b) => a.ordem - b.ordem);
    });
    notificar.sucesso(`Turno “${salvo.nome}” salvo. Gere os meses de novo para aplicar.`);
  }

  async function excluir(turno: Turno) {
    await api.excluirTurno(clienteId, turno.id);
    onMudar((lista) => lista.filter((t) => t.id !== turno.id));
    notificar.sucesso(`Turno “${turno.nome}” excluído.`);
  }

  return (
    <section className="painel" aria-labelledby="titulo-turnos">
      <header className="painel-cab">
        <div>
          <h2 id="titulo-turnos">Turnos</h2>
          <p className="painel-sub">Os turnos vêm do modelo (ou do funcionamento personalizado) e são gerados de novo quando ele é salvo. Aqui você ajusta nome, cor e pessoas mínimas.</p>
        </div>
        <Botao icone={Plus} onClick={() => setEditando("novo")}>
          Novo turno
        </Botao>
      </header>

      {turnos.length === 0 ? (
        <p className="painel-corpo texto-suave">Nenhum turno cadastrado. Aplique um modelo ou salve o funcionamento acima para gerar os turnos.</p>
      ) : (
        <div className="tabela-rolagem">
          <table className="tabela tabela-turnos">
            <thead>
              <tr>
                <th scope="col">Turno</th>
                <th scope="col" data-dica="Pela hora de início; casa com a preferência dos funcionários">
                  Período
                </th>
                <th scope="col">Horário</th>
                <th scope="col">Trabalhadas</th>
                <th scope="col">Funciona</th>
                <th scope="col" className="num">
                  Mínimo/dia
                </th>
                <th scope="col" className="coluna-acoes">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {turnos.map((t) => {
                const excede = t.minutosTrabalhados > jornadaMaxHoras * 60;
                return (
                  <tr key={t.id} style={{ "--cor-turno": t.cor } as CSSProperties}>
                    <th scope="row">
                      <span className="turno-nome-linha">
                        <span className="barra-cor" aria-hidden="true" />
                        {t.nome}
                      </span>
                    </th>
                    <td>
                      <ChipPeriodo periodo={t.periodo} />
                    </td>
                    <td className="num-tab">
                      {t.inicio}–{t.fim}
                      {atravessaMeiaNoite(t.inicio, t.fim) && <Moon className="icone-noturno" size={14} strokeWidth={2} aria-label="atravessa a meia-noite" data-dica="Termina no dia seguinte" />}
                    </td>
                    <td className="num-tab">
                      {formatarMinutos(t.minutosTrabalhados)}
                      {t.intervaloMin > 0 && <span className="texto-suave"> ({t.intervaloMin} min de intervalo)</span>}
                      {excede && (
                        <span className="selo selo-perigo" data-dica={`Acima da jornada máxima de ${formatarHoras(jornadaMaxHoras)}`}>
                          acima
                        </span>
                      )}
                    </td>
                    <td>
                      <span className="dias-com-texto">
                        <DiasCompactos dias={t.diasSemana} rotulo="Funciona" />
                        <span className="texto-suave">{resumoDias(t.diasSemana)}</span>
                      </span>
                    </td>
                    <td className="num">{t.efetivoMinimo > 0 ? t.efetivoMinimo : <span className="texto-fraco">—</span>}</td>
                    <td className="coluna-acoes">
                      <div className="acoes-linha">
                        <BotaoIcone icone={Pencil} rotulo={`Editar ${t.nome}`} onClick={() => setEditando(t)} />
                        <BotaoIcone icone={Trash2} variante="perigo" rotulo={`Excluir ${t.nome}`} onClick={() => setExcluindo(t)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editando && (
        <TurnoModal
          clienteId={clienteId}
          turno={editando === "novo" ? null : editando}
          proximaOrdem={turnos.reduce((m, t) => Math.max(m, t.ordem), -1) + 1}
          corSugerida={PALETA_TURNOS.find((c) => !turnos.some((t) => t.cor.toLowerCase() === c.toLowerCase())) ?? "#64748B"}
          outrosNomes={turnos.filter((t) => editando === "novo" || t.id !== editando.id).map((t) => t.nome)}
          jornadaMaxHoras={jornadaMaxHoras}
          onSalvo={aoSalvar}
          onFechar={() => setEditando(null)}
        />
      )}

      {excluindo && (
        <ConfirmModal titulo="Excluir turno" rotuloConfirmar="Excluir turno" perigo onConfirmar={() => excluir(excluindo)} onFechar={() => setExcluindo(null)}>
          <p>
            O turno <strong>{excluindo.nome}</strong> sai do cadastro. Se ele aparece em escalas já geradas, exclua esses meses antes. Salvar o funcionamento e jornada de novo cria os turnos outra vez.
          </p>
        </ConfirmModal>
      )}
    </section>
  );
}

interface ModalProps {
  clienteId: number;
  turno: Turno | null;
  proximaOrdem: number;
  corSugerida: string;
  outrosNomes: string[];
  jornadaMaxHoras: number;
  onSalvo: (turno: Turno) => void;
  onFechar: () => void;
}

interface Rascunho {
  nome: string;
  inicio: string;
  fim: string;
  intervalo: string;
  efetivo: string;
  cor: string;
  dias: number[];
}

function TurnoModal({ clienteId, turno, proximaOrdem, corSugerida, outrosNomes, jornadaMaxHoras, onSalvo, onFechar }: ModalProps) {
  const [r, setR] = useState<Rascunho>(() =>
    turno
      ? {
          nome: turno.nome,
          inicio: turno.inicio,
          fim: turno.fim,
          intervalo: String(turno.intervaloMin),
          efetivo: String(turno.efetivoMinimo),
          cor: turno.cor,
          dias: turno.diasSemana ?? [0, 1, 2, 3, 4, 5, 6],
        }
      : { nome: "", inicio: "08:00", fim: "16:00", intervalo: "0", efetivo: "1", cor: corSugerida, dias: [0, 1, 2, 3, 4] },
  );
  const [tentou, setTentou] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erroServidor, setErroServidor] = useState<string | null>(null);

  const mudar = (m: Partial<Rascunho>) => setR((atual) => ({ ...atual, ...m }));

  const duracao = duracaoTurnoMinutos(r.inicio, r.fim);
  const intervalo = lerNumero(r.intervalo);
  const efetivo = lerNumero(r.efetivo);
  const trabalhadas = duracao !== null && Number.isInteger(intervalo) ? duracao - intervalo : null;

  const erros: Partial<Record<keyof Rascunho, string>> = {};
  if (!r.nome.trim()) erros.nome = "Dê um nome ao turno.";
  else if (outrosNomes.some((n) => normalizarTexto(n) === normalizarTexto(r.nome))) erros.nome = "Já existe um turno com este nome.";
  if (horaParaMinutos(r.inicio) === null) erros.inicio = "Use HH:MM, ex. 06:00.";
  if (horaParaMinutos(r.fim) === null) erros.fim = "Use HH:MM, ex. 14:00.";
  else if (r.inicio === r.fim) erros.fim = "O fim precisa ser diferente do início.";
  if (!Number.isInteger(intervalo) || intervalo < 0) erros.intervalo = "Minutos inteiros (0 ou mais).";
  else if (duracao !== null && intervalo >= duracao) erros.intervalo = "Precisa ser menor que a duração do turno.";
  if (!Number.isInteger(efetivo) || efetivo < 0) erros.efetivo = "Número inteiro (0 = sem mínimo).";
  if (!corHexValida(r.cor)) erros.cor = "Escolha uma cor.";
  if (r.dias.length === 0) erros.dias = "Marque ao menos um dia.";
  const valido = Object.keys(erros).length === 0;
  const mostrar = (campo: keyof Rascunho) => (tentou ? erros[campo] : undefined);
  const excede = trabalhadas !== null && trabalhadas > jornadaMaxHoras * 60;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setTentou(true);
    if (!valido) return;
    setSalvando(true);
    setErroServidor(null);
    const entrada: TurnoEntrada = {
      id: turno?.id ?? null,
      nome: r.nome.trim(),
      inicio: r.inicio,
      fim: r.fim,
      intervaloMin: intervalo,
      efetivoMinimo: efetivo,
      ordem: turno?.ordem ?? proximaOrdem,
      cor: r.cor,
      diasSemana: [...r.dias].sort((a, b) => a - b),
    };
    try {
      onSalvo(await api.salvarTurno(clienteId, entrada));
      onFechar();
    } catch (err) {
      setErroServidor(mensagemErro(err));
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo={turno ? `Editar ${turno.nome}` : "Novo turno"}
      subtitulo="As escalas já geradas só mudam quando o mês é gerado de novo."
      onFechar={salvando ? () => undefined : onFechar}
      largura="media"
      rodape={
        <>
          <Botao onClick={onFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-turno" variante="primario" icone={Save} carregando={salvando}>
            Salvar turno
          </Botao>
        </>
      }
    >
      <form id="form-turno" className="form-turno" onSubmit={(e) => void salvar(e)} noValidate>
        <div className="form-linha form-linha-nome">
          <Campo id="turno-nome" rotulo="Nome" erro={mostrar("nome")}>
            <Entrada id="turno-nome" value={r.nome} maxLength={40} placeholder="Ex.: Manhã" invalido={!!mostrar("nome")} onChange={(e) => mudar({ nome: e.target.value })} />
          </Campo>
          <Campo id="turno-cor" rotulo="Cor na agenda" erro={mostrar("cor")}>
            <SeletorCor id="turno-cor" valor={r.cor} onMudar={(cor) => mudar({ cor })} />
          </Campo>
        </div>

        <div className="form-linha form-linha-horario">
          <Campo id="turno-inicio" rotulo="Início" erro={mostrar("inicio")}>
            <CampoHora id="turno-inicio" valor={r.inicio} onMudar={(inicio) => mudar({ inicio })} invalido={!!mostrar("inicio")} />
          </Campo>
          <Campo id="turno-fim" rotulo="Fim" erro={mostrar("fim")}>
            <CampoHora id="turno-fim" valor={r.fim} onMudar={(fim) => mudar({ fim })} invalido={!!mostrar("fim")} />
          </Campo>
          <Campo id="turno-intervalo" rotulo="Intervalo" erro={mostrar("intervalo")}>
            <CampoNumero id="turno-intervalo" valor={r.intervalo} onMudar={(intervalo) => mudar({ intervalo })} passo={15} max={720} sufixo="min" invalido={!!mostrar("intervalo")} />
          </Campo>
        </div>

        <div className="resumo-turno" style={{ "--cor-turno": corHexValida(r.cor) ? r.cor : "#64748B" } as CSSProperties}>
          <span className="barra-cor" aria-hidden="true" />
          {trabalhadas !== null && trabalhadas > 0 ? (
            <span>
              <strong>{formatarMinutos(trabalhadas)}</strong> trabalhadas por dia
              {atravessaMeiaNoite(r.inicio, r.fim) && ", terminando no dia seguinte"}
            </span>
          ) : (
            <span className="texto-suave">Informe início e fim para ver a duração.</span>
          )}
        </div>
        {excede && (
          <Alerta tipo="atencao">
            {formatarMinutos(trabalhadas ?? 0)} passa da jornada diária máxima de {formatarHoras(jornadaMaxHoras)}. Ajuste o horário ou a regra de carga.
          </Alerta>
        )}

        <div className="campo">
          <span id="turno-dias-rotulo" className="campo-rotulo">
            Dias em que o turno funciona
          </span>
          <SeletorDias idRotulo="turno-dias-rotulo" valor={r.dias} onMudar={(dias) => mudar({ dias })} />
          {mostrar("dias") ? <p className="campo-erro">{mostrar("dias")}</p> : <p className="campo-dica">{resumoDias(r.dias)}. Nos outros dias ninguém é escalado neste turno.</p>}
        </div>

        <Campo id="turno-efetivo" rotulo="Pessoas mínimas por dia" erro={mostrar("efetivo")} dica="Use 0 para não exigir mínimo." className="campo-estreito">
          <CampoNumero id="turno-efetivo" valor={r.efetivo} onMudar={(efetivo) => mudar({ efetivo })} max={999} sufixo="pessoas" invalido={!!mostrar("efetivo")} />
        </Campo>

        {erroServidor && <Alerta tipo="erro">{erroServidor}</Alerta>}
      </form>
    </Modal>
  );
}
