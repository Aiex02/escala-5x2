import { useCallback, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { BotaoIcone } from "./Botao";
import { rolarParaVisivel, useCliqueFora, useFlutuante } from "./flutuante";

export interface ItemMenu {
  rotulo: string;
  icone: LucideIcon;
  aoEscolher: () => void;
  perigo?: boolean;
}

/** Botão "mais ações" (⋯) que abre um menu curto com ícones. */
export function MenuAcoes({ rotulo, itens }: { rotulo: string; itens: ItemMenu[] }) {
  const idMenu = useId();
  const gatilho = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const estilo = useFlutuante(gatilho, aberto, { largura: 180, alinhar: "fim" });
  const fechar = useCallback(() => setAberto(false), []);
  useCliqueFora([gatilho, menu], aberto, fechar);

  function escolher(i: number) {
    setAberto(false);
    gatilho.current?.focus();
    itens[i]?.aoEscolher();
  }

  function aoTeclar(e: KeyboardEvent) {
    if (!aberto) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setAtivo(0);
        setAberto(true);
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const i = (ativo + (e.key === "ArrowDown" ? 1 : itens.length - 1)) % itens.length;
      setAtivo(i);
      rolarParaVisivel(menu.current, i);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      escolher(ativo);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setAberto(false);
    } else if (e.key === "Tab") {
      setAberto(false);
    }
  }

  return (
    <>
      <BotaoIcone
        ref={gatilho}
        icone={MoreHorizontal}
        rotulo={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? idMenu : undefined}
        aria-activedescendant={aberto ? `${idMenu}-${ativo}` : undefined}
        onClick={() => {
          setAtivo(0);
          setAberto((a) => !a);
        }}
        onKeyDown={aoTeclar}
      />
      {aberto &&
        createPortal(
          <ul ref={menu} id={idMenu} role="menu" className="flutuante lista-opcoes menu" style={estilo}>
            {itens.map((item, i) => {
              const Icone = item.icone;
              const classes = ["opcao", i === ativo && "ativa", item.perigo && "opcao-perigo"].filter(Boolean).join(" ");
              return (
                <li
                  key={item.rotulo}
                  id={`${idMenu}-${i}`}
                  role="menuitem"
                  className={classes}
                  onMouseEnter={() => setAtivo(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => escolher(i)}
                >
                  <Icone size={15} strokeWidth={1.9} aria-hidden="true" />
                  <span className="opcao-texto">{item.rotulo}</span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </>
  );
}
