import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";

export type VarianteBotao = "primario" | "secundario" | "fantasma" | "perigo" | "perigo-contorno";

interface BotaoProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variante?: VarianteBotao;
  tamanho?: "md" | "p";
  icone?: LucideIcon;
  carregando?: boolean;
  bloco?: boolean;
}

/** Botão com texto. Todas as variantes têm a mesma altura dos campos. */
export const Botao = forwardRef<HTMLButtonElement, BotaoProps>(function Botao(
  { variante = "secundario", tamanho = "md", icone: Icone, carregando = false, bloco = false, className, children, disabled, type = "button", ...resto },
  ref,
) {
  const classes = ["botao", `botao-${variante}`, tamanho === "p" && "botao-p", bloco && "botao-bloco", className].filter(Boolean).join(" ");
  return (
    <button ref={ref} type={type} className={classes} disabled={disabled || carregando} aria-busy={carregando || undefined} {...resto}>
      {carregando ? <span className="giro" aria-hidden="true" /> : Icone && <Icone size={tamanho === "p" ? 15 : 16} strokeWidth={1.9} aria-hidden="true" />}
      {children !== undefined && children !== null && <span className="botao-texto">{children}</span>}
    </button>
  );
});

interface BotaoIconeProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  icone: LucideIcon;
  /** Nome da ação: vira `aria-label` e a dica exibida ao passar o mouse. */
  rotulo: string;
  variante?: "fantasma" | "secundario" | "perigo";
  tamanho?: "md" | "p";
}

/** Botão só com ícone (editar, excluir, fechar...). Sempre tem rótulo acessível e dica. */
export const BotaoIcone = forwardRef<HTMLButtonElement, BotaoIconeProps>(function BotaoIcone(
  { icone: Icone, rotulo, variante = "fantasma", tamanho = "md", className, type = "button", ...resto },
  ref,
) {
  const classe = variante === "perigo" ? "botao-fantasma botao-icone-perigo" : `botao-${variante}`;
  const classes = ["botao", "botao-icone", classe, tamanho === "p" && "botao-p", className].filter(Boolean).join(" ");
  return (
    <button ref={ref} type={type} className={classes} aria-label={rotulo} data-dica={rotulo} {...resto}>
      <Icone size={tamanho === "p" ? 15 : 17} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
});
