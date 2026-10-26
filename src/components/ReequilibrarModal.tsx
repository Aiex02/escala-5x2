import { useState, type FormEvent } from "react";
import { RefreshCcwDot } from "lucide-react";
import { mensagemErro } from "../api/client";
import type { AgendaMes, MesGerado } from "../api/types";
import { chaveMes, dataNoMes, montarData, nomeMes, tituloMes } from "../util/datas";
import { pluralizar } from "../util/formato";
import { pessoasComSaldoAcumulado } from "./agenda/saldos";
import { Botao } from "./base/Botao";
import { Campo } from "./base/Campo";
import { brParaIso, CampoData, isoParaBr } from "./base/CampoNumero";
import { CaixaMarcacao } from "./base/Marcacao";
import { Modal } from "./Modal";
import { Alerta } from "./ui";

interface Props {
  agenda: AgendaMes;
  /** Meses já gerados do cliente (para oferecer refazer os seguintes). */
  meses: MesGerado[];
  /** Hoje, "YYYY-MM-DD". */
  hoje: string;
  /** Reequilibra e atualiza a tela; lança em caso de erro. */
  onReequilibrar: (aPartir: string, seguintes: boolean) => Promise<void>;
  onFechar: () => void;
}

/** Primeiro ajuste à mão do mês; sem ajustes, hoje (se estiver no mês); senão o dia 1. */
function dataInicial(agenda: AgendaMes, hoje: string): string {
  const ajustes = agenda.ajustes.map((a) => a.data).filter((d) => dataNoMes(d, agenda.ano, agenda.mes));
  const primeiro = ajustes.reduce<string | null>((menor, d) => (menor === null || d < menor ? d : menor), null);
  if (primeiro) return primeiro;
  return dataNoMes(hoje, agenda.ano, agenda.mes) ? hoje : montarData(agenda.ano, agenda.mes, 1);
}

/** "nov/2026" */
function rotuloMesCurto(m: MesGerado): string {
  return `${nomeMes(m.mes).slice(0, 3).toLowerCase()}/${m.ano}`;
}

/**
 * Reequilibra o mês a partir de uma data: os dias antes dela e os dias ajustados à mão no Quadro
 * ficam como estão; o resto é refeito compensando o saldo de horas dentro das regras.
 */
export function ReequilibrarModal({ agenda, meses, hoje, onReequilibrar, onFechar }: Props) {
  const [campoData, setCampoData] = useState(() => isoParaBr(dataInicial(agenda, hoje)));
  const [seguintes, setSeguintes] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const titulo = tituloMes(agenda.ano, agenda.mes);
  const aPartir = brParaIso(campoData);
  const dentroDoMes = aPartir !== null && dataNoMes(aPartir, agenda.ano, agenda.mes);
  // Só reclama de uma data completa; enquanto digita, o botão apenas fica desabilitado.
  const erroData = campoData.length < 10 ? null : aPartir === null ? "Use uma data válida, dd/mm/aaaa." : !dentroDoMes ? `Escolha um dia de ${titulo.toLowerCase()}.` : null;
  const valida = dentroDoMes && aPartir !== null;

  const ajustesMantidos = valida ? agenda.ajustes.filter((a) => a.data >= aPartir).length : 0;
  const comSaldo = pessoasComSaldoAcumulado(agenda);
  const posteriores = meses.filter((m) => chaveMes(m.ano, m.mes) > chaveMes(agenda.ano, agenda.mes)).sort((a, b) => a.ano - b.ano || a.mes - b.mes);

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    if (!valida || ocupado) return;
    setOcupado(true);
    setErro(null);
    try {
      await onReequilibrar(aPartir, seguintes && posteriores.length > 0);
      onFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <Modal
      titulo="Reequilibrar horas"
      subtitulo={`Refaz o resto de ${titulo} mantendo o que você ajustou à mão.`}
      onFechar={ocupado ? () => undefined : onFechar}
      largura="media"
      rodape={
        <>
          <Botao onClick={onFechar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-reequilibrar" variante="primario" icone={RefreshCcwDot} carregando={ocupado} disabled={!valida}>
            Reequilibrar
          </Botao>
        </>
      }
    >
      <form id="form-reequilibrar" className="form-reequilibrar" onSubmit={(e) => void confirmar(e)} noValidate>
        <Campo id="reeq-data" rotulo="Reequilibrar a partir de" erro={erroData} dica={`Um dia de ${titulo.toLowerCase()}. Os dias anteriores ficam como estão.`} className="reeq-data">
          <CampoData id="reeq-data" valor={campoData} onMudar={setCampoData} invalido={erroData !== null} />
        </Campo>

        <ul className="reeq-resumo" aria-label="Resumo">
          <li>
            {valida ? (
              ajustesMantidos > 0 ? (
                <>
                  <strong>{pluralizar(ajustesMantidos, "dia ajustado à mão fica", "dias ajustados à mão ficam")}</strong> como {ajustesMantidos === 1 ? "está" : "estão"}.
                </>
              ) : (
                <>Nenhum dia ajustado à mão a partir desta data.</>
              )
            ) : (
              <>Escolha uma data para ver o que será mantido.</>
            )}
          </li>
          <li>
            {comSaldo > 0 ? (
              <>
                <strong>{pluralizar(comSaldo, "pessoa tem", "pessoas têm")}</strong> saldo de horas acumulado (a mais ou devendo), que o reequilíbrio tenta zerar.
              </>
            ) : (
              <>Ninguém tem saldo de horas acumulado agora.</>
            )}
          </li>
        </ul>

        <ul className="reeq-explica">
          <li>
            <strong>Fica como está:</strong> os dias antes da data escolhida e os dias que você mudou à mão no Quadro (turno, folga ou ausência).
          </li>
          <li>
            <strong>Muda:</strong> os demais dias são distribuídos de novo. Horas a mais viram folga extra ou turno mais curto; horas devendo viram um dia extra, se a regra permitir, ou
            turnos mais longos.
          </li>
          <li>
            <strong>Sem hora extra:</strong> nada passa do limite diário nem do semanal.
          </li>
        </ul>

        {posteriores.length > 0 && (
          <div className="campo">
            <CaixaMarcacao marcado={seguintes} onMudar={setSeguintes} desabilitado={ocupado}>
              Refazer também os meses seguintes já gerados
            </CaixaMarcacao>
            <p className="campo-dica reeq-dica-marca">
              Refaz {pluralizar(posteriores.length, "mês", "meses")} ({posteriores.map(rotuloMesCurto).join(", ")}) do dia 1, levando o saldo adiante. Os ajustes feitos à mão{" "}
              {posteriores.length === 1 ? "nele" : "neles"} também são mantidos.
            </p>
          </div>
        )}

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
      </form>
    </Modal>
  );
}
