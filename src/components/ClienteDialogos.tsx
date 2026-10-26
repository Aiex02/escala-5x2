import { useState, type FormEvent } from "react";
import { mensagemErro } from "../api/client";
import type { Cliente, DiaFuncionamento, ModeloFuncionamento } from "../api/types";
import { formatarNumero } from "../util/formato";
import { MODELO_PADRAO_ID } from "../util/modelosFuncionamento";
import { useModelos } from "../util/useModelos";
import { Botao } from "./base/Botao";
import { Campo, Entrada } from "./base/Campo";
import { resumoDias } from "./base/Escolhas";
import { Selecao } from "./base/Selecao";
import { ConfirmModal, Modal } from "./Modal";

export type DialogoCliente = "criar" | "renomear" | "excluir" | null;

interface Props {
  dialogo: DialogoCliente;
  cliente: Cliente | null;
  /** Nome já digitado na busca de clientes, para o diálogo de criação. */
  nomeSugerido?: string;
  onFechar: () => void;
  /** Cria o cliente já com o modelo de funcionamento escolhido (`null` = a lista de modelos não carregou: vale o padrão). */
  onCriar: (nome: string, modelo: ModeloFuncionamento | null) => Promise<void>;
  onRenomear: (nome: string) => Promise<void>;
  onExcluir: () => Promise<void>;
}

export function ClienteDialogos({ dialogo, cliente, nomeSugerido = "", onFechar, onCriar, onRenomear, onExcluir }: Props) {
  if (dialogo === "criar") {
    return (
      <FormularioNome
        titulo="Novo cliente"
        subtitulo="Os turnos são gerados a partir do horário de funcionamento; ajuste depois em Configurações."
        rotuloBotao="Criar cliente"
        nomeInicial={nomeSugerido}
        comModelo
        onSalvar={onCriar}
        onFechar={onFechar}
      />
    );
  }
  if (dialogo === "renomear" && cliente) {
    return (
      <FormularioNome titulo="Renomear cliente" rotuloBotao="Salvar" nomeInicial={cliente.nome} onSalvar={onRenomear} onFechar={onFechar} />
    );
  }
  if (dialogo === "excluir" && cliente) {
    return <ExclusaoCliente cliente={cliente} onExcluir={onExcluir} onFechar={onFechar} />;
  }
  return null;
}

interface FormularioNomeProps {
  titulo: string;
  subtitulo?: string;
  rotuloBotao: string;
  nomeInicial: string;
  /** Pergunta também o modelo de funcionamento (criação de cliente). */
  comModelo?: boolean;
  onSalvar: (nome: string, modelo: ModeloFuncionamento | null) => Promise<void>;
  onFechar: () => void;
}

/** "Seg a sáb 10:00–22:00 · dom 14:00–20:15 · jornada de 6h, 15 min de intervalo". */
function detalheModelo(m: ModeloFuncionamento): string {
  const minusculo = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const horario = (d: DiaFuncionamento) => (d.abre === d.fecha ? `24h, a partir das ${d.abre}` : `${d.abre}–${d.fecha}`);
  const porHorario = new Map<string, number[]>();
  for (const d of m.dias.filter((x) => x.aberto)) porHorario.set(horario(d), [...(porHorario.get(horario(d)) ?? []), d.dia]);
  const fechados = m.dias.filter((d) => !d.aberto).map((d) => d.dia);
  const partes = [...porHorario].map(([h, dias]) => `${resumoDias(dias)} ${h}`);
  if (fechados.length > 0) partes.push(`${resumoDias(fechados)} ${fechados.length > 1 ? "fechados" : "fechado"}`);
  const intervalo = m.intervaloMin > 0 ? `${m.intervaloMin} min de intervalo` : "sem intervalo";
  return `${partes.map((p, i) => (i === 0 ? p : minusculo(p))).join(" · ")} · jornada de ${formatarNumero(m.jornadaHoras)}h, ${intervalo}`;
}

function FormularioNome({ titulo, subtitulo, rotuloBotao, nomeInicial, comModelo = false, onSalvar, onFechar }: FormularioNomeProps) {
  const [nome, setNome] = useState(nomeInicial);
  // Os modelos vêm do backend; sem escolha, vale o padrão (ou o primeiro da lista).
  const modelos = useModelos();
  const [modeloId, setModeloId] = useState(MODELO_PADRAO_ID);
  const lista = modelos.dados ?? [];
  const modelo = lista.find((m) => m.id === modeloId) ?? lista[0] ?? null;
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const limpo = nome.trim();
    if (!limpo) {
      setErro("Informe o nome do cliente.");
      return;
    }
    setOcupado(true);
    setErro(null);
    try {
      await onSalvar(limpo, modelo);
      onFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setOcupado(false);
    }
  }

  return (
    <Modal
      titulo={titulo}
      subtitulo={subtitulo}
      onFechar={ocupado ? () => undefined : onFechar}
      largura="estreita"
      rodape={
        <>
          <Botao onClick={onFechar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-cliente" variante="primario" carregando={ocupado}>
            {rotuloBotao}
          </Botao>
        </>
      }
    >
      <form id="form-cliente" className="form-turno" onSubmit={(e) => void enviar(e)} noValidate>
        <Campo id="nome-cliente" rotulo="Nome do cliente" erro={erro}>
          <Entrada id="nome-cliente" value={nome} maxLength={80} invalido={erro !== null} onChange={(e) => setNome(e.target.value)} />
        </Campo>
        {comModelo && (
          <Campo
            id="modelo-cliente"
            rotulo="Modelo de funcionamento"
            erro={modelos.erro && !modelo ? `Não foi possível carregar os modelos. ${modelos.erro} O cliente será criado com o modelo padrão.` : null}
            dica={
              modelo ? (
                <>
                  {modelo.descricao}
                  <span className="campo-dica-linha">{detalheModelo(modelo)}</span>
                  <span className="campo-dica-linha">Horário, jornada e regras já seguem o fim da escala 6x1 (EC 141); ajuste depois em Configurações.</span>
                </>
              ) : (
                "Carregando modelos…"
              )
            }
          >
            <Selecao<string>
              id="modelo-cliente"
              valor={modelo?.id ?? ""}
              opcoes={lista.map((m) => ({ valor: m.id, rotulo: m.nome }))}
              desabilitado={ocupado || !modelo}
              onMudar={setModeloId}
            />
          </Campo>
        )}
      </form>
    </Modal>
  );
}

interface ExclusaoProps {
  cliente: Cliente;
  onExcluir: () => Promise<void>;
  onFechar: () => void;
}

function ExclusaoCliente({ cliente: inicial, onExcluir, onFechar }: ExclusaoProps) {
  // Guarda o cliente do momento da abertura: a lista muda assim que a exclusão termina.
  const [cliente] = useState(inicial);
  return (
    <ConfirmModal titulo="Excluir cliente" rotuloConfirmar="Excluir cliente" perigo onConfirmar={onExcluir} onFechar={onFechar}>
      <p>
        Excluir o cliente <strong>{cliente.nome}</strong>?
      </p>
      <p>
        Isso apaga também todos os funcionários, turnos, configurações, escalas e meses gerados deste cliente. A ação não pode ser desfeita.
      </p>
    </ConfirmModal>
  );
}
