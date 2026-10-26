import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { mensagemErro } from "../api/client";
import { Botao, BotaoIcone } from "./base/Botao";
import { Alerta } from "./ui";

interface ModalProps {
  titulo: string;
  /** Linha de apoio abaixo do título. */
  subtitulo?: ReactNode;
  onFechar: () => void;
  children: ReactNode;
  rodape?: ReactNode;
  largura?: "estreita" | "media" | "larga";
}

const FOCAVEIS =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Diálogo modal acessível: foco preso, Esc fecha, devolve o foco ao fechar. */
export function Modal({ titulo, subtitulo, onFechar, children, rodape, largura = "media" }: ModalProps) {
  const idTitulo = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const aoFechar = useRef(onFechar);
  aoFechar.current = onFechar;

  useEffect(() => {
    const anterior = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = caixa.current;
    const inicial = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>("input, select, textarea") ?? el;
    inicial?.focus();

    function aoTeclar(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        aoFechar.current();
        return;
      }
      if (e.key !== "Tab" || !el) return;
      const focaveis = Array.from(el.querySelectorAll<HTMLElement>(FOCAVEIS));
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (!primeiro || !ultimo) {
        e.preventDefault();
      } else if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
    document.addEventListener("keydown", aoTeclar);
    return () => {
      document.removeEventListener("keydown", aoTeclar);
      anterior?.focus();
    };
  }, []);

  return createPortal(
    <div
      className="modal-fundo"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onFechar();
      }}
    >
      <div ref={caixa} className={`modal modal-${largura}`} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}>
        <header className="modal-cab">
          <div className="modal-titulos">
            <h2 id={idTitulo}>{titulo}</h2>
            {subtitulo && <p className="modal-subtitulo">{subtitulo}</p>}
          </div>
          <BotaoIcone icone={X} rotulo="Fechar" onClick={onFechar} />
        </header>
        <div className="modal-corpo">{children}</div>
        {rodape && <footer className="modal-rodape">{rodape}</footer>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmModalProps {
  titulo: string;
  children: ReactNode;
  rotuloConfirmar?: string;
  perigo?: boolean;
  /** Pode lançar: a mensagem de erro aparece no próprio diálogo e ele continua aberto. */
  onConfirmar: () => Promise<unknown> | void;
  onFechar: () => void;
}

export function ConfirmModal({ titulo, children, rotuloConfirmar = "Confirmar", perigo = false, onConfirmar, onFechar }: ConfirmModalProps) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar() {
    setOcupado(true);
    setErro(null);
    try {
      await onConfirmar();
      onFechar();
    } catch (e) {
      setErro(mensagemErro(e));
      setOcupado(false);
    }
  }

  return (
    <Modal
      titulo={titulo}
      onFechar={ocupado ? () => undefined : onFechar}
      largura="estreita"
      rodape={
        <>
          <Botao data-autofocus onClick={onFechar} disabled={ocupado}>
            Cancelar
          </Botao>
          <Botao variante={perigo ? "perigo" : "primario"} carregando={ocupado} onClick={() => void confirmar()}>
            {rotuloConfirmar}
          </Botao>
        </>
      }
    >
      <div className="texto-confirmacao">{children}</div>
      {erro && <Alerta tipo="erro">{erro}</Alerta>}
    </Modal>
  );
}
