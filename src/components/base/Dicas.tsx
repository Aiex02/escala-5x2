import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface DicaVisivel {
  texto: string;
  x: number;
  y: number;
  abaixo: boolean;
}

const ATRASO_MS = 380;

/**
 * Camada única de dicas: qualquer elemento com `data-dica="..."` mostra a dica
 * ao passar o mouse ou receber foco pelo teclado. Substitui o `title` nativo,
 * cujo visual e atraso mudam entre macOS e Windows.
 */
export function CamadaDicas() {
  const [dica, setDica] = useState<DicaVisivel | null>(null);
  const temporizador = useRef<number | undefined>(undefined);
  const alvoAtual = useRef<Element | null>(null);

  useEffect(() => {
    function mostrar(el: Element) {
      const texto = el.getAttribute("data-dica");
      if (!texto) return;
      const r = el.getBoundingClientRect();
      const abaixo = r.top < 44;
      setDica({ texto, x: r.left + r.width / 2, y: abaixo ? r.bottom + 6 : r.top - 6, abaixo });
    }
    function entrar(e: Event) {
      const el = (e.target as Element | null)?.closest?.("[data-dica]") ?? null;
      if (el === alvoAtual.current) return;
      alvoAtual.current = el;
      window.clearTimeout(temporizador.current);
      setDica(null);
      if (el) temporizador.current = window.setTimeout(() => mostrar(el), e.type === "focusin" ? 0 : ATRASO_MS);
    }
    function sair(e: Event) {
      const relacionado = (e as MouseEvent | FocusEvent).relatedTarget as Element | null;
      if (alvoAtual.current && relacionado && alvoAtual.current.contains(relacionado)) return;
      alvoAtual.current = null;
      window.clearTimeout(temporizador.current);
      setDica(null);
    }
    function esconder() {
      alvoAtual.current = null;
      window.clearTimeout(temporizador.current);
      setDica(null);
    }
    document.addEventListener("pointerover", entrar);
    document.addEventListener("pointerout", sair);
    document.addEventListener("focusin", entrar);
    document.addEventListener("focusout", sair);
    document.addEventListener("pointerdown", esconder, true);
    window.addEventListener("scroll", esconder, true);
    return () => {
      document.removeEventListener("pointerover", entrar);
      document.removeEventListener("pointerout", sair);
      document.removeEventListener("focusin", entrar);
      document.removeEventListener("focusout", sair);
      document.removeEventListener("pointerdown", esconder, true);
      window.removeEventListener("scroll", esconder, true);
      window.clearTimeout(temporizador.current);
    };
  }, []);

  if (!dica) return null;
  return createPortal(
    <div
      className={dica.abaixo ? "dica dica-abaixo" : "dica"}
      role="tooltip"
      style={{ left: Math.max(8, Math.min(dica.x, window.innerWidth - 8)), top: dica.y }}
    >
      {dica.texto}
    </div>,
    document.body,
  );
}
