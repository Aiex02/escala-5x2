import type { ReactNode } from "react";
import { Check } from "lucide-react";

interface CaixaProps {
  marcado: boolean;
  onMudar: (marcado: boolean) => void;
  children?: ReactNode;
  rotuloAria?: string;
  desabilitado?: boolean;
}

/** Caixa de marcação desenhada pelo app (idêntica em macOS e Windows). */
export function CaixaMarcacao({ marcado, onMudar, children, rotuloAria, desabilitado }: CaixaProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={marcado}
      aria-label={rotuloAria}
      disabled={desabilitado}
      className="marcacao"
      onClick={() => onMudar(!marcado)}
    >
      <span className="marcacao-caixa" aria-hidden="true">
        {marcado && <Check size={13} strokeWidth={3} />}
      </span>
      {children && <span className="marcacao-texto">{children}</span>}
    </button>
  );
}

interface InterruptorProps {
  ligado: boolean;
  onMudar: (ligado: boolean) => void;
  rotuloAria: string;
  desabilitado?: boolean;
  children?: ReactNode;
}

export function Interruptor({ ligado, onMudar, rotuloAria, desabilitado, children }: InterruptorProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={children ? undefined : rotuloAria}
      disabled={desabilitado}
      className="interruptor"
      onClick={() => onMudar(!ligado)}
    >
      <span className="interruptor-trilho" aria-hidden="true">
        <span className="interruptor-botao" />
      </span>
      {children && <span className="marcacao-texto">{children}</span>}
    </button>
  );
}
