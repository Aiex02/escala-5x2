import type { CSSProperties } from "react";
import { TriangleAlert } from "lucide-react";
import type { AgendaMes } from "../../api/types";
import { DIAS_SEMANA_LONGO, diaDaSemana, formatarDataExtenso } from "../../util/datas";
import { compararTexto, formatarMinutos, pluralizar } from "../../util/formato";
import { Botao } from "../base/Botao";
import { Modal } from "../Modal";
import { Alerta, Selo } from "../ui";
import { nomeFuncionario, turnoFuncionaEm, type IndiceAgenda } from "./indice";

interface Props {
  data: string;
  agenda: AgendaMes;
  indice: IndiceAgenda;
  onFechar: () => void;
}

/** Detalhe de um dia: quem trabalha em cada turno, com horário e horas, e quem está ausente. */
export function DiaModal({ data, agenda, indice, onFechar }: Props) {
  const doDia = indice.porDia.get(data);
  const avisosDoDia = agenda.avisos.filter((a) => a.data === data);
  const total = doDia ? [...doDia.values()].reduce((soma, l) => soma + l.length, 0) : 0;
  const turnos = indice.turnosOrdenados.filter((t) => turnoFuncionaEm(t, data));
  const ausentes = agenda.ausencias
    .filter((a) => a.inicio <= data && data <= a.fim)
    .sort((a, b) => compararTexto(nomeFuncionario(indice, a.funcionarioId), nomeFuncionario(indice, b.funcionarioId)));

  return (
    <Modal
      titulo={`${DIAS_SEMANA_LONGO[diaDaSemana(data)] ?? ""}, ${formatarDataExtenso(data)}`}
      subtitulo={pluralizar(total, "pessoa escalada", "pessoas escaladas")}
      onFechar={onFechar}
      largura="larga"
      rodape={
        <Botao onClick={onFechar} data-autofocus>
          Fechar
        </Botao>
      }
    >
      <div className="dia-detalhe">
        {turnos.map((turno) => {
          const lista = doDia?.get(turno.id) ?? [];
          const abaixo = turno.efetivoMinimo > 0 && lista.length < turno.efetivoMinimo;
          return (
            <section key={turno.id} className="dia-detalhe-turno" style={{ "--cor-turno": turno.cor } as CSSProperties}>
              <header className="dia-detalhe-cab">
                <span className="ponto-cor" aria-hidden="true" />
                <h3>{turno.nome}</h3>
                <span className="dia-detalhe-horario">
                  {turno.inicio}–{turno.fim}
                </span>
                <span className={abaixo ? "selo selo-perigo" : "selo selo-neutro"}>
                  {abaixo && <TriangleAlert size={12} strokeWidth={2.2} aria-hidden="true" />}
                  {lista.length}
                  {turno.efetivoMinimo > 0 && ` de ${turno.efetivoMinimo} mín.`}
                </span>
              </header>
              {lista.length === 0 ? (
                <p className="dia-detalhe-vazio">Ninguém escalado neste turno.</p>
              ) : (
                <table className="tabela tabela-compacta">
                  <thead>
                    <tr>
                      <th scope="col">Nome</th>
                      <th scope="col">Matrícula</th>
                      <th scope="col">Horário</th>
                      <th scope="col" className="num">
                        Horas
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((a) => (
                      <tr key={a.id}>
                        <td>{nomeFuncionario(indice, a.funcionarioId)}</td>
                        <td className="texto-suave">{indice.funcionarios.get(a.funcionarioId)?.matricula ?? "—"}</td>
                        <td className="num-tab">
                          {a.inicio}–{a.fim}
                        </td>
                        <td className="num">{formatarMinutos(a.minutosTrabalhados)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
        {turnos.length === 0 && <p className="dia-detalhe-vazio">Nenhum turno funciona neste dia.</p>}
        {ausentes.length > 0 && (
          <section className="dia-detalhe-turno">
            <header className="dia-detalhe-cab">
              <h3>Ausências</h3>
              <span className="selo selo-neutro">{ausentes.length}</span>
            </header>
            <table className="tabela tabela-compacta">
              <thead>
                <tr>
                  <th scope="col">Nome</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {ausentes.map((a) => (
                  <tr key={`${a.funcionarioId}|${a.inicio}`}>
                    <td>{nomeFuncionario(indice, a.funcionarioId)}</td>
                    <td>
                      {a.justificada ? (
                        <Selo dica="As horas do dia são abonadas">Justificada</Selo>
                      ) : (
                        <Selo tom="perigo" dica="As horas do dia ficam devendo">
                          Falta
                        </Selo>
                      )}
                    </td>
                    <td className="texto-suave">{a.motivo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
        {avisosDoDia.length > 0 && (
          <Alerta tipo="atencao">
            <ul className="lista-simples">
              {avisosDoDia.map((a, i) => (
                <li key={i}>{a.mensagem}</li>
              ))}
            </ul>
          </Alerta>
        )}
      </div>
    </Modal>
  );
}
