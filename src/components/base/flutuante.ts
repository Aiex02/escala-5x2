// Posicionamento de camadas flutuantes (listas, menus, paletas) presas a um
// elemento-âncora. Ficam num portal com `position: fixed`, então nunca são
// cortadas por tabelas ou painéis com rolagem.

import { useEffect, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";

interface Opcoes {
  /** "ancora" = mesma largura do elemento; número = largura mínima em px. */
  largura?: "ancora" | number;
  alinhar?: "inicio" | "fim";
  alturaMax?: number;
}

const MARGEM = 8;

export function useFlutuante(ancora: RefObject<HTMLElement | null>, aberto: boolean, { largura = "ancora", alinhar = "inicio", alturaMax = 300 }: Opcoes = {}): CSSProperties {
  const [estilo, setEstilo] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });

  useLayoutEffect(() => {
    if (!aberto) return;
    function posicionar() {
      const el = ancora.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = largura === "ancora" ? r.width : Math.max(largura, r.width);
      const abaixo = window.innerHeight - r.bottom - MARGEM;
      const acima = r.top - MARGEM;
      const paraCima = abaixo < Math.min(alturaMax, 180) && acima > abaixo;
      const esquerda = Math.max(MARGEM, Math.min(alinhar === "fim" ? r.right - w : r.left, window.innerWidth - w - MARGEM));
      setEstilo({
        position: "fixed",
        left: esquerda,
        width: w,
        maxHeight: Math.max(120, Math.min(alturaMax, paraCima ? acima : abaixo)),
        ...(paraCima ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
      });
    }
    posicionar();
    window.addEventListener("resize", posicionar);
    window.addEventListener("scroll", posicionar, true);
    return () => {
      window.removeEventListener("resize", posicionar);
      window.removeEventListener("scroll", posicionar, true);
    };
  }, [aberto, ancora, largura, alinhar, alturaMax]);

  return estilo;
}

/** Chama `aoFechar` ao clicar fora de todos os elementos indicados. */
export function useCliqueFora(elementos: RefObject<HTMLElement | null>[], aberto: boolean, aoFechar: () => void) {
  useEffect(() => {
    if (!aberto) return;
    function aoPressionar(e: MouseEvent) {
      const alvo = e.target as Node;
      if (elementos.some((r) => r.current?.contains(alvo))) return;
      aoFechar();
    }
    document.addEventListener("mousedown", aoPressionar, true);
    return () => document.removeEventListener("mousedown", aoPressionar, true);
    // `elementos` são refs estáveis: só a abertura e o callback importam.
  }, [aberto, aoFechar]);
}

/** Mantém o item ativo de uma lista visível durante a navegação por teclado. */
export function rolarParaVisivel(lista: HTMLElement | null, indice: number) {
  const item = lista?.querySelectorAll<HTMLElement>("[role='option'], [role='menuitem']")[indice];
  item?.scrollIntoView({ block: "nearest" });
}
