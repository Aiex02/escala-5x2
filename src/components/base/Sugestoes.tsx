import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { normalizarTexto } from "../../util/formato";
import { rolarParaVisivel, useCliqueFora, useFlutuante } from "./flutuante";

export interface Sugestao {
  valor: string;
  /** Texto de apoio à direita (ex.: "3 pessoas"). */
  detalhe?: string;
}

interface Props {
  id: string;
  valor: string;
  onMudar: (valor: string) => void;
  sugestoes: readonly Sugestao[];
  maxLength?: number;
  placeholder?: string;
}

/**
 * Caixa de texto livre com sugestões abaixo (como um `datalist`, mas com a lista do app): digitar filtra,
 * setas e Enter escolhem, e o que for digitado vale mesmo sem escolher nada. Sem item destacado, Enter
 * segue para o formulário.
 */
export function CampoSugestoes({ id, valor, onMudar, sugestoes, maxLength, placeholder }: Props) {
  const idLista = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const [aberto, setAberto] = useState(false);
  // -1 = nenhum item destacado pelo teclado.
  const [ativo, setAtivo] = useState(-1);

  const filtradas = useMemo(() => {
    const termo = normalizarTexto(valor);
    return sugestoes.filter((s) => {
      const nome = normalizarTexto(s.valor);
      // Escrever a sugestão por inteiro dispensa a lista.
      return nome !== termo && (!termo || nome.includes(termo));
    });
  }, [sugestoes, valor]);

  const visivel = aberto && filtradas.length > 0;
  const estilo = useFlutuante(caixa, visivel, { alturaMax: 240 });

  const fechar = useCallback(() => {
    setAberto(false);
    setAtivo(-1);
  }, []);
  useCliqueFora([caixa, lista], aberto, fechar);

  function escolher(s: Sugestao | undefined) {
    if (!s) return;
    onMudar(s.valor);
    fechar();
  }

  function mover(indice: number) {
    const i = Math.max(0, Math.min(filtradas.length - 1, indice));
    setAtivo(i);
    rolarParaVisivel(lista.current, i);
  }

  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (!aberto) setAberto(true);
        else mover(ativo + 1);
        break;
      case "ArrowUp":
        if (visivel) {
          e.preventDefault();
          mover(ativo - 1);
        }
        break;
      case "Enter":
        if (visivel && ativo >= 0) {
          e.preventDefault();
          escolher(filtradas[ativo]);
        }
        break;
      case "Escape":
        if (visivel) {
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
    <div ref={caixa} className="entrada campo-sugestoes">
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visivel}
        aria-controls={visivel ? idLista : undefined}
        aria-activedescendant={visivel && ativo >= 0 ? `${idLista}-${ativo}` : undefined}
        spellCheck={false}
        autoComplete="off"
        value={valor}
        maxLength={maxLength}
        placeholder={placeholder}
        onFocus={() => setAberto(true)}
        onChange={(e) => {
          onMudar(e.target.value);
          setAberto(true);
          setAtivo(-1);
        }}
        onKeyDown={aoTeclar}
      />
      {visivel &&
        createPortal(
          <div ref={lista} id={idLista} role="listbox" className="flutuante lista-opcoes" style={estilo}>
            {filtradas.map((s, i) => (
              <div
                key={s.valor}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={i === ativo}
                className={i === ativo ? "opcao ativa" : "opcao"}
                onMouseEnter={() => setAtivo(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => escolher(s)}
              >
                <span className="opcao-texto">{s.valor}</span>
                {s.detalhe && <span className="opcao-detalhe">{s.detalhe}</span>}
              </div>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
