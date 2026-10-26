import { useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { rolarParaVisivel, useCliqueFora, useFlutuante } from "./flutuante";

export interface OpcaoSelecao<T extends string | number> {
  valor: T;
  rotulo: string;
}

interface Props<T extends string | number> {
  id?: string;
  valor: T;
  opcoes: OpcaoSelecao<T>[];
  onMudar: (valor: T) => void;
  rotuloAria?: string;
  invalido?: boolean;
  desabilitado?: boolean;
  tamanho?: "md" | "p";
  className?: string;
}

/**
 * Lista de seleção desenhada pelo app (substitui o `<select>` nativo, que muda
 * de aparência entre macOS e Windows). Teclado: setas, Home/End, Enter, Esc e
 * digitação para pular para a opção.
 */
export function Selecao<T extends string | number>({ id, valor, opcoes, onMudar, rotuloAria, invalido, desabilitado, tamanho = "md", className }: Props<T>) {
  const idLista = useId();
  const gatilho = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLUListElement>(null);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const busca = useRef({ texto: "", ate: 0 });
  const estilo = useFlutuante(gatilho, aberto, { alturaMax: 280 });
  const fechar = useCallback(() => setAberto(false), []);
  useCliqueFora([gatilho, lista], aberto, fechar);

  const selecionada = opcoes.find((o) => o.valor === valor);

  function abrir() {
    const i = opcoes.findIndex((o) => o.valor === valor);
    setAtivo(i < 0 ? 0 : i);
    setAberto(true);
  }

  function mover(indice: number) {
    const i = Math.max(0, Math.min(opcoes.length - 1, indice));
    setAtivo(i);
    rolarParaVisivel(lista.current, i);
  }

  function escolher(indice: number) {
    const opcao = opcoes[indice];
    if (opcao) onMudar(opcao.valor);
    setAberto(false);
    gatilho.current?.focus();
  }

  function aoTeclar(e: KeyboardEvent<HTMLButtonElement>) {
    if (!aberto) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        abrir();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        mover(ativo + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        mover(ativo - 1);
        break;
      case "Home":
        e.preventDefault();
        mover(0);
        break;
      case "End":
        e.preventDefault();
        mover(opcoes.length - 1);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        escolher(ativo);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        setAberto(false);
        break;
      case "Tab":
        setAberto(false);
        break;
      default:
        if (e.key.length === 1) {
          const agora = Date.now();
          busca.current.texto = (agora < busca.current.ate ? busca.current.texto : "") + e.key.toLowerCase();
          busca.current.ate = agora + 700;
          const i = opcoes.findIndex((o) => o.rotulo.toLowerCase().startsWith(busca.current.texto));
          if (i >= 0) mover(i);
        }
    }
  }

  const classes = ["selecao", invalido && "entrada-invalida", tamanho === "p" && "entrada-p", aberto && "aberta", className].filter(Boolean).join(" ");

  return (
    <>
      <button
        ref={gatilho}
        id={id}
        type="button"
        className={classes}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={aberto ? idLista : undefined}
        aria-activedescendant={aberto ? `${idLista}-${ativo}` : undefined}
        aria-label={rotuloAria}
        aria-invalid={invalido || undefined}
        disabled={desabilitado}
        onClick={() => (aberto ? setAberto(false) : abrir())}
        onKeyDown={aoTeclar}
      >
        <span className="selecao-valor">{selecionada?.rotulo ?? "Selecione"}</span>
        <ChevronDown className="selecao-seta" size={16} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {aberto &&
        createPortal(
          <ul ref={lista} id={idLista} role="listbox" className="flutuante lista-opcoes" style={estilo} tabIndex={-1}>
            {opcoes.map((o, i) => (
              <li
                key={String(o.valor)}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={o.valor === valor}
                className={i === ativo ? "opcao ativa" : "opcao"}
                onMouseEnter={() => setAtivo(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => escolher(i)}
              >
                <span className="opcao-texto">{o.rotulo}</span>
                {o.valor === valor && <Check className="opcao-marca" size={15} strokeWidth={2.2} aria-hidden="true" />}
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
