import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Search } from "lucide-react";
import { normalizarTexto } from "../../util/formato";
import { rolarParaVisivel, useCliqueFora, useFlutuante } from "./flutuante";

export interface ItemCombobox {
  id: number;
  rotulo: string;
}

interface Props {
  id: string;
  itens: ItemCombobox[];
  selecionadoId: number | null;
  onSelecionar: (id: number) => void;
  /** Se informado, oferece criar um item com o texto digitado. */
  onCriar?: (texto: string) => void;
  rotuloCriar?: (texto: string) => string;
  placeholder?: string;
  vazio?: string;
  rotuloAria?: string;
}

type Entrada = { tipo: "item"; item: ItemCombobox } | { tipo: "criar"; texto: string };

/**
 * Caixa de texto com lista abaixo: digite para filtrar, use as setas e Enter
 * para escolher. Fechada, mostra o item selecionado.
 */
export function Combobox({ id, itens, selecionadoId, onSelecionar, onCriar, rotuloCriar, placeholder = "Buscar…", vazio = "Nada encontrado.", rotuloAria }: Props) {
  const idLista = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [ativo, setAtivo] = useState(0);
  const estilo = useFlutuante(caixa, aberto, { alturaMax: 320 });

  const selecionado = itens.find((i) => i.id === selecionadoId) ?? null;

  const entradas = useMemo<Entrada[]>(() => {
    const termo = normalizarTexto(texto);
    const filtrados = itens.filter((i) => !termo || normalizarTexto(i.rotulo).includes(termo));
    const lista: Entrada[] = filtrados.map((item) => ({ tipo: "item", item }));
    const exato = itens.some((i) => normalizarTexto(i.rotulo) === termo);
    if (onCriar && texto.trim() && !exato) lista.push({ tipo: "criar", texto: texto.trim() });
    return lista;
  }, [itens, texto, onCriar]);

  const fechar = useCallback(() => {
    setAberto(false);
    setTexto("");
  }, []);
  useCliqueFora([caixa, lista], aberto, fechar);

  function abrir() {
    if (aberto) return;
    const i = itens.findIndex((x) => x.id === selecionadoId);
    setTexto("");
    setAtivo(i < 0 ? 0 : i);
    setAberto(true);
  }

  function mover(indice: number) {
    const i = Math.max(0, Math.min(entradas.length - 1, indice));
    setAtivo(i);
    rolarParaVisivel(lista.current, i);
  }

  function escolher(e: Entrada | undefined) {
    if (!e) return;
    if (e.tipo === "item") onSelecionar(e.item.id);
    else onCriar?.(e.texto);
    fechar();
    entrada.current?.blur();
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!aberto) abrir();
        else mover(ativo + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (aberto) mover(ativo - 1);
        break;
      case "Enter":
        if (aberto) {
          e.preventDefault();
          escolher(entradas[ativo]);
        }
        break;
      case "Escape":
        if (aberto) {
          e.preventDefault();
          e.stopPropagation();
          fechar();
        }
        break;
      case "Tab":
        fechar();
        break;
    }
  }

  return (
    <div ref={caixa} className={aberto ? "entrada combobox aberta" : "entrada combobox"}>
      <Search className="entrada-icone" size={16} strokeWidth={1.9} aria-hidden="true" />
      <input
        ref={entrada}
        id={id}
        type="text"
        role="combobox"
        aria-label={rotuloAria}
        aria-autocomplete="list"
        aria-expanded={aberto}
        aria-controls={aberto ? idLista : undefined}
        aria-activedescendant={aberto && entradas[ativo] ? `${idLista}-${ativo}` : undefined}
        spellCheck={false}
        autoComplete="off"
        value={aberto ? texto : (selecionado?.rotulo ?? "")}
        placeholder={aberto ? (selecionado?.rotulo ?? placeholder) : placeholder}
        onMouseDown={() => abrir()}
        onChange={(e) => {
          if (!aberto) setAberto(true);
          setTexto(e.target.value);
          setAtivo(0);
        }}
        onKeyDown={aoTeclar}
      />
      <button
        type="button"
        className="combobox-seta"
        tabIndex={-1}
        aria-label={aberto ? "Fechar lista" : "Abrir lista"}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (aberto) fechar();
          else {
            abrir();
            entrada.current?.focus();
          }
        }}
      >
        <ChevronDown size={16} strokeWidth={1.9} aria-hidden="true" />
      </button>
      {aberto &&
        createPortal(
          <div ref={lista} id={idLista} role="listbox" className="flutuante lista-opcoes" style={estilo}>
            {entradas.length === 0 && <p className="lista-vazia">{vazio}</p>}
            {entradas.map((en, i) => {
              const classe = i === ativo ? "opcao ativa" : "opcao";
              if (en.tipo === "criar") {
                return (
                  <div
                    key="__criar"
                    id={`${idLista}-${i}`}
                    role="option"
                    aria-selected={false}
                    className={`${classe} opcao-criar`}
                    onMouseEnter={() => setAtivo(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => escolher(en)}
                  >
                    <Plus size={15} strokeWidth={2} aria-hidden="true" />
                    <span className="opcao-texto">{rotuloCriar ? rotuloCriar(en.texto) : `Criar “${en.texto}”`}</span>
                  </div>
                );
              }
              const marcado = en.item.id === selecionadoId;
              return (
                <div
                  key={en.item.id}
                  id={`${idLista}-${i}`}
                  role="option"
                  aria-selected={marcado}
                  className={classe}
                  onMouseEnter={() => setAtivo(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(en)}
                >
                  <span className="opcao-texto">{en.item.rotulo}</span>
                  {marcado && <Check className="opcao-marca" size={15} strokeWidth={2.2} aria-hidden="true" />}
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
