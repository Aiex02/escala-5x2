import { useMemo, useState, type FormEvent } from "react";
import { Save } from "lucide-react";
import { api, mensagemErro } from "../api/client";
import type { Funcionario, Periodo } from "../api/types";
import { chaveFuncao, type FuncaoExistente } from "../util/funcoes";
import { formatarHoras, formatarNumero, pluralizar } from "../util/formato";
import { Botao } from "./base/Botao";
import { Campo } from "./base/Campo";
import { CampoNumero, lerNumero } from "./base/CampoNumero";
import { Segmentado } from "./base/Escolhas";
import { CampoSugestoes } from "./base/Sugestoes";
import { Modal } from "./Modal";
import { Alerta } from "./ui";

interface Props {
  clienteId: number;
  funcionario: Funcionario;
  limiteHoras: number;
  /** Funções que já existem no cadastro (sugeridas no campo Função, para não criar variações do mesmo cargo). */
  funcoes: readonly FuncaoExistente[];
  onSalvo: (f: Funcionario) => void;
  onFechar: () => void;
}

/** Valor do seletor de preferência; "nenhuma" = sem preferência (null no cadastro). */
type Preferencia = Periodo | "nenhuma";

/** Edita função, carga semanal e preferência de período. */
export function FuncionarioModal({ clienteId, funcionario, limiteHoras, funcoes, onSalvo, onFechar }: Props) {
  const [cargo, setCargo] = useState(funcionario.cargo ?? "");
  const [carga, setCarga] = useState(funcionario.cargaSemanalHoras === null ? "" : formatarNumero(funcionario.cargaSemanalHoras));
  const [preferencia, setPreferencia] = useState<Preferencia>(funcionario.preferencia ?? "nenhuma");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const sugestoes = useMemo(() => funcoes.map((f) => ({ valor: f.nome, detalhe: pluralizar(f.pessoas, "pessoa", "pessoas") })), [funcoes]);
  const cargoLimpo = cargo.trim();
  const igual = cargoLimpo ? funcoes.find((f) => f.chave === chaveFuncao(cargoLimpo)) : undefined;
  const dicaCargo = !cargoLimpo
    ? "Escolha uma função que já existe ou digite uma nova."
    : igual
      ? igual.nome === cargoLimpo
        ? `Função existente, com ${pluralizar(igual.pessoas, "pessoa", "pessoas")}.`
        : `Conta como a função “${igual.nome}” (${pluralizar(igual.pessoas, "pessoa", "pessoas")}).`
      : "Função nova: ainda não há ninguém com ela.";

  const cargaNumero = carga.trim() === "" ? null : lerNumero(carga);
  const erroCarga = cargaNumero !== null && !(cargaNumero > 0 && cargaNumero <= 168) ? "Use de 1 a 168 horas, ou deixe vazio." : null;

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (erroCarga) return;
    setSalvando(true);
    setErro(null);
    try {
      const salvo = await api.salvarFuncionario(clienteId, funcionario.id, {
        cargo: cargo.trim() || null,
        cargaSemanalHoras: cargaNumero,
        preferencia: preferencia === "nenhuma" ? null : preferencia,
      });
      onSalvo(salvo);
      onFechar();
    } catch (err) {
      setErro(mensagemErro(err));
      setSalvando(false);
    }
  }

  return (
    <Modal
      titulo={funcionario.nome}
      subtitulo={funcionario.ctps ? `CTPS ${funcionario.ctps}` : `Matrícula ${funcionario.matricula}`}
      onFechar={salvando ? () => undefined : onFechar}
      largura="media"
      rodape={
        <>
          <Botao onClick={onFechar} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao type="submit" form="form-funcionario" variante="primario" icone={Save} carregando={salvando}>
            Salvar
          </Botao>
        </>
      }
    >
      <form id="form-funcionario" className="form-turno" onSubmit={(e) => void salvar(e)} noValidate>
        <div className="form-linha form-linha-nome">
          <Campo id="func-cargo" rotulo="Função" dica={dicaCargo}>
            <CampoSugestoes id="func-cargo" valor={cargo} onMudar={setCargo} sugestoes={sugestoes} maxLength={60} />
          </Campo>
          <Campo id="func-carga" rotulo="Carga semanal" erro={erroCarga} dica={carga.trim() === "" ? `Vazio = limite do cliente (${formatarHoras(limiteHoras)})` : undefined}>
            <CampoNumero id="func-carga" valor={carga} onMudar={setCarga} decimais passo={1} max={168} sufixo="horas" invalido={!!erroCarga} />
          </Campo>
        </div>

        <div className="campo">
          <span className="campo-rotulo">Preferência de período</span>
          <Segmentado<Preferencia>
            rotulo="Preferência de período"
            valor={preferencia}
            onMudar={setPreferencia}
            opcoes={[
              { valor: "nenhuma", rotulo: "Sem preferência" },
              { valor: "manha", rotulo: "Manhã" },
              { valor: "tarde", rotulo: "Tarde" },
              { valor: "noite", rotulo: "Noite" },
            ]}
          />
          <p className="campo-dica">A escala atende a preferência quando houver vaga no período.</p>
        </div>

        {erro && <Alerta tipo="erro">{erro}</Alerta>}
      </form>
    </Modal>
  );
}
