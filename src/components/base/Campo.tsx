import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Search, X, type LucideIcon } from "lucide-react";

interface CampoProps {
  id: string;
  rotulo?: ReactNode;
  erro?: string | null;
  dica?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Rótulo + controle + mensagem (erro tem prioridade sobre a dica). */
export function Campo({ id, rotulo, erro, dica, children, className }: CampoProps) {
  return (
    <div className={className ? `campo ${className}` : "campo"}>
      {rotulo && (
        <label htmlFor={id} className="campo-rotulo">
          {rotulo}
        </label>
      )}
      {children}
      {erro ? (
        <p id={`${id}-erro`} className="campo-erro">
          {erro}
        </p>
      ) : (
        dica && <p className="campo-dica">{dica}</p>
      )}
    </div>
  );
}

interface EntradaProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  icone?: LucideIcon;
  sufixo?: ReactNode;
  invalido?: boolean;
  tamanho?: "md" | "p";
  /** Elemento extra à direita, dentro da caixa (ex.: botão de limpar). */
  acessorio?: ReactNode;
}

/** Caixa de texto padrão. O visual fica no contêiner para aceitar ícone e sufixo. */
export const Entrada = forwardRef<HTMLInputElement, EntradaProps>(function Entrada(
  { icone: Icone, sufixo, invalido = false, tamanho = "md", acessorio, className, type = "text", id, ...resto },
  ref,
) {
  const classes = ["entrada", invalido && "entrada-invalida", tamanho === "p" && "entrada-p", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {Icone && <Icone className="entrada-icone" size={16} strokeWidth={1.9} aria-hidden="true" />}
      <input
        ref={ref}
        id={id}
        type={type}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalido || undefined}
        aria-describedby={invalido && id ? `${id}-erro` : undefined}
        {...resto}
      />
      {sufixo && <span className="entrada-sufixo">{sufixo}</span>}
      {acessorio}
    </div>
  );
});

interface BuscaProps {
  id: string;
  valor: string;
  onMudar: (valor: string) => void;
  placeholder?: string;
  rotulo: string;
  className?: string;
}

/** Campo de busca com ícone e botão de limpar (sem o "x" nativo, que muda entre sistemas). */
export function Busca({ id, valor, onMudar, placeholder, rotulo, className }: BuscaProps) {
  return (
    <Entrada
      id={id}
      icone={Search}
      value={valor}
      placeholder={placeholder}
      aria-label={rotulo}
      className={className}
      onChange={(e) => onMudar(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && valor) {
          e.stopPropagation();
          onMudar("");
        }
      }}
      acessorio={
        valor ? (
          <button type="button" className="entrada-limpar" aria-label="Limpar busca" onClick={() => onMudar("")}>
            <X size={14} strokeWidth={2} aria-hidden="true" />
          </button>
        ) : null
      }
    />
  );
}
